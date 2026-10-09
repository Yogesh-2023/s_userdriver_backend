import { BookingStatus, Prisma } from "@prisma/client";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { errors } from "../../common/errors";
import { env } from "../../config/env";
import { prisma } from "../../database/prisma";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
  getRealtimeServer,
} from "../../infrastructure/realtime";
import { queues } from "../../infrastructure/queues";
import { redis } from "../../infrastructure/redis";
import { redisKeys } from "../../realtime/socket.constants";
import { DriverAvailabilityService } from "../driver/services/driver-availability.service";
import { NotificationsService } from "../notifications/service";

export class DispatchLockService {
  private readonly availability = new DriverAvailabilityService();
  private readonly notifications = new NotificationsService();

  async acceptRide(offerId: string, driverId: string) {
    let initial = await prisma.dispatchOffer.findUnique({
      where: { id: offerId },
      include: {
        assignment: true,
        booking: { select: { assignedDriverId: true, trip: true } },
      },
    });
    if (!initial) {
      initial = await prisma.dispatchOffer.findFirst({
        where: { bookingId: offerId, driverId, status: "OFFERED" },
        orderBy: { createdAt: "desc" },
        include: {
          assignment: true,
          booking: { select: { assignedDriverId: true, trip: true } },
        },
      });
    }
    if (!initial) throw errors.notFound("RIDE_REQUEST_NOT_FOUND");
    if (initial.driverId !== driverId) {
      throw errors.forbidden("RIDE_REQUEST_NOT_OWNED");
    }
    if (
      initial.status === "ACCEPTED" &&
      initial.assignment &&
      initial.booking.assignedDriverId === driverId &&
      initial.booking.trip
    ) {
      try {
        await this.afterAcceptance({
          assignmentId: initial.assignment.id,
          bookingId: initial.bookingId,
          tripId: initial.booking.trip.id,
          vehicleId: initial.vehicleId,
          driverId: initial.driverId,
          dispatchCycleId: initial.dispatchCycleId,
          attemptNumber: initial.attemptNumber,
        });
      } catch (_) {}
      return {
        assignmentId: initial.assignment.id,
        bookingId: initial.bookingId,
        tripId: initial.booking.trip.id,
        vehicleId: initial.vehicleId,
      };
    }
    if (initial.status !== "OFFERED" || initial.expiresAt <= new Date()) {
      throw errors.conflict("RIDE_REQUEST_EXPIRED");
    }

    const vehicleId = initial.vehicleId;
    const lockKey = redisKeys.bookingAcceptLock(initial.bookingId);
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) {
      return this.winningReplayOrThrow(initial.bookingId, driverId);
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const offer = await tx.dispatchOffer.findUniqueOrThrow({
            where: { id: offerId },
            include: { 
              driver: { select: { userId: true } },
              booking: { select: { type: true, scheduledAt: true } }
            },
          });
          if (
            offer.driverId !== driverId ||
            offer.status !== "OFFERED" ||
            offer.expiresAt <= new Date()
          ) {
            throw errors.conflict("RIDE_REQUEST_EXPIRED");
          }
          const bookingUpdate = await tx.booking.updateMany({
            where: {
              id: offer.bookingId,
              status: BookingStatus.SEARCHING_DRIVER,
              assignedDriverId: null,
              assignedVehicleId: null,
            },
            data: {
              status: BookingStatus.DRIVER_ASSIGNED,
              assignedDriverId: offer.driverId,
              assignedVehicleId: offer.vehicleId,
              version: { increment: 1 },
            },
          });
          const targetBooking = await tx.booking.findUnique({
            where: { id: offer.bookingId },
            select: { type: true, scheduledAt: true },
          });
          const isFutureScheduled =
            targetBooking?.type === "SCHEDULED" &&
            targetBooking?.scheduledAt &&
            targetBooking.scheduledAt.getTime() - Date.now() > 15 * 60_000;

          if (!isFutureScheduled) {
            const driverChanged = await tx.driverProfile.updateMany({
              where: { id: offer.driverId },
              data: { availability: "BUSY" },
            });
            await tx.vehicle.updateMany({
              where: { id: offer.vehicleId },
              data: { isAvailable: false },
            });
            if (driverChanged.count !== 1) {
              throw errors.conflict("DRIVER_NOT_AVAILABLE");
            }
          }
          const accepted = await tx.dispatchOffer.updateMany({
            where: { id: offer.id, status: "OFFERED" },
            data: { status: "ACCEPTED", respondedAt: new Date() },
          });
          if (accepted.count !== 1) {
            throw errors.conflict("RIDE_REQUEST_EXPIRED");
          }
          await tx.dispatchOffer.updateMany({
            where: {
              bookingId: offer.bookingId,
              id: { not: offer.id },
              status: "OFFERED",
            },
            data: { status: "INVALIDATED", respondedAt: new Date() },
          });
          const assignment = await tx.driverAssignment.create({
            data: {
              bookingId: offer.bookingId,
              driverId: offer.driverId,
              vehicleId: offer.vehicleId,
              dispatchOfferId: offer.id,
              batchNo: offer.attemptNumber,
              status: "ACTIVE",
              offeredAt: offer.offeredAt,
              expiresAt: offer.expiresAt,
              respondedAt: new Date(),
            },
          });
          await tx.bookingStatusHistory.create({
            data: {
              bookingId: offer.bookingId,
              fromStatus: BookingStatus.SEARCHING_DRIVER,
              toStatus: BookingStatus.DRIVER_ASSIGNED,
              actorUserId: offer.driver.userId,
            },
          });
          const existingTrip = await tx.trip.findUnique({
            where: { bookingId: offer.bookingId },
          });
          const trip = existingTrip
            ? await tx.trip.update({
                where: { id: existingTrip.id },
                data: {
                  driverId: offer.driverId,
                  vehicleId: offer.vehicleId,
                  status: "CREATED",
                  arrivedAt: null,
                  startedAt: null,
                  completedAt: null,
                  verificationOtpHash: null,
                  verificationOtpExpiresAt: null,
                  otpAttempts: 0,
                  statusHistory: {
                    create: {
                      fromStatus: existingTrip.status,
                      toStatus: "CREATED",
                    },
                  },
                },
              })
            : await tx.trip.create({
                data: {
                  bookingId: offer.bookingId,
                  driverId: offer.driverId,
                  vehicleId: offer.vehicleId,
                  status: "CREATED",
                  statusHistory: { create: { toStatus: "CREATED" } },
                },
              });
          await tx.dispatchCycle.updateMany({
            where: { id: offer.dispatchCycleId, status: "ACTIVE" },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
          return {
            assignmentId: assignment.id,
            bookingId: offer.bookingId,
            tripId: trip.id,
            vehicleId: offer.vehicleId,
            driverId: offer.driverId,
            dispatchCycleId: offer.dispatchCycleId,
            attemptNumber: offer.attemptNumber,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      try {
        await this.afterAcceptance(result);
      } catch (afterAcceptanceError) {
        console.error("[AFTER_ACCEPTANCE_NON_FATAL_ERROR]", afterAcceptanceError);
      }
      return {
        assignmentId: result.assignmentId,
        bookingId: result.bookingId,
        tripId: result.tripId,
        vehicleId: result.vehicleId,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return this.winningReplayOrThrow(initial.bookingId, driverId);
      }
      throw error;
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async rejectRide(offerId: string, driverId: string, reason?: string) {
    let offer = await prisma.dispatchOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer) {
      offer = await prisma.dispatchOffer.findFirst({
        where: { bookingId: offerId, driverId, status: "OFFERED" },
        orderBy: { createdAt: "desc" },
      });
    }
    if (!offer) throw errors.notFound("RIDE_REQUEST_NOT_FOUND");
    if (offer.driverId !== driverId) {
      throw errors.forbidden("RIDE_REQUEST_NOT_OWNED");
    }
    if (offer.status === "REJECTED") return offer;
    if (offer.status !== "OFFERED" || offer.expiresAt <= new Date()) {
      throw errors.conflict("RIDE_REQUEST_EXPIRED");
    }
    const changed = await prisma.dispatchOffer.updateMany({
      where: { id: offer.id, status: "OFFERED" },
      data: {
        status: "REJECTED",
        respondedAt: new Date(),
        rejectionReason: reason?.slice(0, 100),
      },
    });
    if (!changed.count) throw errors.conflict("RIDE_REQUEST_EXPIRED");
    await redis
      .pipeline()
      .del(redisKeys.dispatchOffer(offer.id))
      .srem(redisKeys.driverOffers(driverId), offer.id)
      .exec();
    emitDriver(driverId, "dispatch:rejected", {
      offerId,
      bookingId: offer.bookingId,
    });
    return offer;
  }

  private async winningReplayOrThrow(bookingId: string, driverId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        status: true,
        assignedDriverId: true,
        trip: { select: { id: true } },
      },
    });
    if (booking?.status === "CANCELLED") {
      throw errors.conflict("BOOKING_CANCELLED");
    }
    const assignment = await prisma.driverAssignment.findFirst({
      where: { bookingId, driverId, status: "ACTIVE" },
      include: { booking: { select: { trip: true } } },
    });
    if (!assignment?.booking.trip) {
      throw errors.conflict("OFFER_TAKEN");
    }
    return {
      assignmentId: assignment.id,
      bookingId,
      tripId: assignment.booking.trip.id,
      vehicleId: assignment.vehicleId,
    };
  }

  private async afterAcceptance(result: {
    assignmentId: string;
    bookingId: string;
    tripId: string;
    vehicleId: string;
    driverId: string;
    dispatchCycleId: string;
    attemptNumber: number;
  }) {
    const losingOffers = await prisma.dispatchOffer.findMany({
      where: {
        bookingId: result.bookingId,
        status: "INVALIDATED",
      },
      select: { id: true, driverId: true },
    });
    const pipeline = redis.pipeline();
    pipeline.del(
      redisKeys.dispatchState(result.bookingId),
      redisKeys.dispatchCycle(result.bookingId),
      redisKeys.dispatchOfferedDrivers(result.bookingId),
    );
    for (const offer of losingOffers) {
      pipeline.del(redisKeys.dispatchOffer(offer.id));
      pipeline.srem(redisKeys.driverOffers(offer.driverId), offer.id);
      emitDriver(offer.driverId, "dispatch:offer-cancelled", {
        offerId: offer.id,
        bookingId: result.bookingId,
        reason: "OFFER_TAKEN",
      });
      emitDriver(offer.driverId, "dispatch:offer-taken", {
        offerId: offer.id,
        bookingId: result.bookingId,
        reason: "OFFER_TAKEN",
      });
    }
    await pipeline.exec();

    const otp =
      env.NODE_ENV === "production"
        ? randomInt(1_000, 10_000).toString()
        : env.OTP_FIXED_CODE || "1234";
    const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1_000);
    const hmacHash = createHmac("sha256", env.COOKIE_SECRET)
      .update(`${result.tripId}:${otp}`)
      .digest("hex");

    await prisma.trip.update({
      where: { id: result.tripId },
      data: {
        verificationOtpHash: hmacHash,
        verificationOtpExpiresAt: expiresAt,
        otpAttempts: 0,
      },
    });
    await redis.set(`booking:otp:${result.bookingId}`, otp, "EX", 86400);

    const [driver, vehicleResult, booking] = await Promise.all([
      prisma.driverProfile.findUnique({
        where: { id: result.driverId },
        select: {
          averageRating: true,
          totalTrips: true,
          profileImageUrl: true,
          user: { select: { displayName: true } },
        },
      }).catch(() => null),
      prisma.vehicle.findUnique({
        where: { id: result.vehicleId },
        select: {
          make: true,
          model: true,
          year: true,
          color: true,
          registrationNo: true,
          categoryId: true,
          category: {
            select: {
              id: true,
              name: true,
              iconUrl: true,
              imageUrl: true,
            },
          },
        },
      }).catch(() => null),
      prisma.booking.findUnique({
        where: { id: result.bookingId },
        select: {
          type: true,
          scheduledAt: true,
          customer: {
            select: {
              id: true,
              userId: true,
              user: { select: { displayName: true, phone: true } },
            },
          },
          vehicleCategory: {
            select: {
              id: true,
              name: true,
              iconUrl: true,
              imageUrl: true,
            },
          },
        },
      }).catch(() => null),
    ]);

    const isFutureScheduled =
      booking?.type === "SCHEDULED" &&
      booking?.scheduledAt &&
      new Date(booking.scheduledAt).getTime() - Date.now() > 15 * 60_000;

    if (!isFutureScheduled) {
      await this.availability.markBusy(result.driverId);
    }

    let vehicle = vehicleResult;
    if (!vehicle && result.driverId) {
      vehicle = await prisma.vehicle.findFirst({
        where: { driverId: result.driverId },
        select: {
          make: true,
          model: true,
          year: true,
          color: true,
          registrationNo: true,
          categoryId: true,
          category: {
            select: {
              id: true,
              name: true,
              iconUrl: true,
              imageUrl: true,
            },
          },
        },
      }).catch(() => null);
    }

    const finalVehicle = vehicle || {
      make: "Standard",
      model: "Vehicle",
      year: null,
      color: "White",
      registrationNo: "N/A",
      categoryId: booking?.vehicleCategory?.id ?? null,
      category: booking?.vehicleCategory ?? null,
    };

    if (booking?.customer?.id) {
      getRealtimeServer()
        ?.in(`customer:${booking.customer.id}`)
        .socketsJoin(`booking:${result.bookingId}`);
    }
    getRealtimeServer()
      ?.in(`driver:${result.driverId}`)
      .socketsJoin(`booking:${result.bookingId}`);
    getRealtimeServer()
      ?.in(`booking:${result.bookingId}`)
      .socketsJoin(`trip:${result.tripId}`);

    const payload = {
      assignmentId: result.assignmentId,
      bookingId: result.bookingId,
      tripId: result.tripId,
      status: BookingStatus.DRIVER_ASSIGNED,
      driverId: result.driverId,
      timestamp: new Date().toISOString(),
      otp,
      rideStartOtp: otp,
      pickupOtp: otp,
      driver: {
        id: result.driverId,
        name: driver?.user?.displayName ?? "Driver",
        rating: Number(driver?.averageRating ?? 5.0),
        totalTrips: driver?.totalTrips ?? 0,
        imageUrl: driver?.profileImageUrl ?? null,
      },
      vehicle: finalVehicle,
      vehicleCategory: booking?.vehicleCategory ?? null,
      etaSeconds: null,
      customer: {
        id: booking?.customer?.id ?? "",
        name: booking?.customer?.user?.displayName ?? "Customer",
        phone: booking?.customer?.user?.phone ?? "",
      },
    };

    console.log(`
================================================================================
=== 🔑 PICKUP OTP GENERATED & ASSIGNED ===
--------------------------------------------------------------------------------
Driver Name : ${driver?.user?.displayName ?? "Driver"} (ID: ${result.driverId})
Booking ID  : ${result.bookingId}
Trip ID     : ${result.tripId}
PICKUP OTP  : 🔑 ${otp} 🔑
================================================================================
`);

    console.log("[DRIVER_ACCEPT]", {
      bookingId: result.bookingId,
      driverId: result.driverId,
      requestId: result.dispatchCycleId,
      previousStatus: BookingStatus.SEARCHING_DRIVER,
      newStatus: BookingStatus.DRIVER_ASSIGNED,
      otp,
    });

    console.log("[USER_NOTIFICATION]", {
      bookingId: result.bookingId,
      userId: booking?.customer?.userId,
      eventName: "booking:driver-assigned",
      otp,
    });

    emitBooking(result.bookingId, "booking:driver-assigned", payload, {
      dispatchCycleId: result.dispatchCycleId,
    });
    emitDriver(result.driverId, "dispatch:accepted", {
      assignmentId: result.assignmentId,
      bookingId: result.bookingId,
      tripId: result.tripId,
    });
    emitDriver(result.driverId, "booking:driver-assigned", payload);
    emitAdminRoom("dashboard", "admin:booking:driver-assigned", {
      assignmentId: result.assignmentId,
      bookingId: result.bookingId,
      tripId: result.tripId,
      driverId: result.driverId,
      vehicleId: result.vehicleId,
    });

    const timeout = await queues.dispatch.getJob(
      `booking-timeout-${result.bookingId}`,
    );
    await timeout?.remove();
    const offerTimeout = await queues.dispatch.getJob(
      `dispatch-timeout-${result.bookingId}-${result.dispatchCycleId}-${result.attemptNumber}`,
    );
    await offerTimeout?.remove();
    if (booking?.customer?.userId) {
      const isScheduled = booking?.type === "SCHEDULED";
      const driverName = driver?.user?.displayName ?? "Driver";
      const vehicleName = (finalVehicle as any)?.name || `${(finalVehicle as any)?.make || ''} ${(finalVehicle as any)?.model || ''}`.trim() || "Vehicle";
      const dateStr = booking?.scheduledAt
        ? new Date(booking.scheduledAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
        : '';
      const timeStr = booking?.scheduledAt
        ? new Date(booking.scheduledAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : '';

      const title = isScheduled ? "Driver Accepted Your Scheduled Ride" : "Driver Assigned";
      const body = isScheduled
        ? `Your scheduled ride has been accepted.\nDriver: ${driverName}\nVehicle: ${vehicleName}\nDate: ${dateStr}\nTime: ${timeStr}`
        : "A driver has been assigned to your ride.";

      await this.notifications.enqueue({
        userId: booking.customer.userId,
        bookingId: result.bookingId,
        channel: "PUSH",
        templateKey: isScheduled ? "SCHEDULED_RIDE_ACCEPTED" : "DRIVER_ASSIGNED",
        title,
        body,
        data: {
          type: isScheduled ? "SCHEDULED_DRIVER_ASSIGNED" : "BOOKING_ACCEPTED",
          entityType: "BOOKING",
          entityId: result.bookingId,
          bookingId: result.bookingId,
          scheduledAt: booking?.scheduledAt ? booking.scheduledAt.toISOString() : undefined,
          driverName,
          vehicleName,
          screen: isScheduled ? "scheduled_rides" : "ride_tracking",
          action: "OPEN_BOOKING",
          role: "USER",
        },
      });
    }
  }
}
