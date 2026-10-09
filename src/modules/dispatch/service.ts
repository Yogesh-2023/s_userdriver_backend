import { BookingStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
} from "../../infrastructure/realtime";
import { queues } from "../../infrastructure/queues";
import { redis } from "../../infrastructure/redis";
import { redisKeys } from "../../realtime/socket.constants";
import { DriverAvailabilityService } from "../driver/services/driver-availability.service";
import { NotificationsService } from "../notifications/service";
import { DispatchLockService } from "./dispatch-lock.service";
import { DispatchOfferService } from "./dispatch-offer.service";

export class DispatchService {
  private readonly offers = new DispatchOfferService();
  private readonly locks = new DispatchLockService();
  private readonly availability = new DriverAvailabilityService();
  private readonly notifications = new NotificationsService();

  async start(bookingId: string) {
    const changed = await prisma.$transaction(async (tx) => {
      const update = await tx.booking.updateMany({
        where: { id: bookingId, status: BookingStatus.PENDING },
        data: {
          status: BookingStatus.SEARCHING_DRIVER,
          version: { increment: 1 },
        },
      });
      if (update.count) {
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: BookingStatus.PENDING,
            toStatus: BookingStatus.SEARCHING_DRIVER,
          },
        });
      }
      return update.count;
    });
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { status: true },
    });
    if (booking?.status !== BookingStatus.SEARCHING_DRIVER) return false;

    if (changed) {
      emitBooking(bookingId, "booking:searching-driver", { bookingId });
      emitAdminRoom("dashboard", "admin:dispatch:started", { bookingId });
    }
    await queues.dispatch.add(
      "dispatch-search-timeout",
      { bookingId },
      {
        jobId: `booking-timeout-${bookingId}`,
        delay: 8 * 60_000,
      },
    );
    await this.offers.processDispatchCycle(bookingId);
    return true;
  }

  async offerBatch(bookingId: string, _batchNo: number) {
    return this.offers.processDispatchCycle(bookingId);
  }

  async accept(offerIdOrBookingId: string, userId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("DRIVER_NOT_FOUND");

    const directOffer = await prisma.dispatchOffer.findUnique({
      where: { id: offerIdOrBookingId },
      select: { id: true },
    });

    if (directOffer) {
      return this.locks.acceptRide(directOffer.id, driver.id);
    }

    const activeOffer = await prisma.dispatchOffer.findFirst({
      where: {
        driverId: driver.id,
        OR: [{ bookingId: offerIdOrBookingId }, { id: offerIdOrBookingId }],
        status: "OFFERED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (activeOffer) {
      return this.locks.acceptRide(activeOffer.id, driver.id);
    }

    const existingOffer = await prisma.dispatchOffer.findFirst({
      where: {
        driverId: driver.id,
        OR: [{ bookingId: offerIdOrBookingId }, { id: offerIdOrBookingId }],
      },
      orderBy: { createdAt: "desc" },
      include: {
        booking: { select: { assignedDriverId: true, trip: true, status: true } },
      },
    });

    if (existingOffer) {
      if (
        existingOffer.status === "ACCEPTED" &&
        existingOffer.booking.assignedDriverId === driver.id &&
        existingOffer.booking.trip
      ) {
        return this.locks.acceptRide(existingOffer.id, driver.id);
      }
      if (existingOffer.booking.status === "CANCELLED") {
        throw errors.conflict("BOOKING_CANCELLED");
      }
      if (
        existingOffer.status === "INVALIDATED" ||
        (existingOffer.booking.assignedDriverId &&
          existingOffer.booking.assignedDriverId !== driver.id)
      ) {
        throw errors.conflict("OFFER_TAKEN");
      }
      if (existingOffer.status === "EXPIRED" || existingOffer.expiresAt <= new Date()) {
        throw errors.conflict("RIDE_REQUEST_EXPIRED");
      }
    }

    const booking = await prisma.booking.findUnique({
      where: { id: offerIdOrBookingId },
      select: { status: true, assignedDriverId: true },
    });
    if (booking) {
      if (booking.status === "CANCELLED") throw errors.conflict("BOOKING_CANCELLED");
      if (booking.assignedDriverId && booking.assignedDriverId !== driver.id) {
        throw errors.conflict("OFFER_TAKEN");
      }
      throw errors.conflict("RIDE_REQUEST_EXPIRED");
    }

    throw errors.notFound("RIDE_REQUEST_NOT_FOUND");
  }

  async reject(offerId: string, userId: string, reason?: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("DRIVER_NOT_FOUND");
    const offer = await this.locks.rejectRide(
      offerId,
      driver.id,
      reason ?? "REST_API_REJECT",
    );
    console.log(`\n[YOGESH][REJECT_FLOW] Driver pressed Reject`);
    console.log(`[YOGESH][REJECT_FLOW] driverId=${userId}`);
    console.log(`[YOGESH][REJECT_FLOW] bookingId=${offer.bookingId}`);
    console.log(`[YOGESH][REJECT_FLOW] requestId=${offerId}`);
    console.log(`[YOGESH][REJECT_FLOW] tripId=${offer.bookingId}`);
    console.log(`[YOGESH][REJECT_FLOW] sending backend reject`);
    console.log(`[YOGESH][REJECT_FLOW] backend response=SUCCESS`);
    console.log(`[YOGESH][REJECT_FLOW] request status=REJECTED`);
    console.log(`[YOGESH][REJECT_FLOW] booking status=SEARCHING_DRIVER`);

    const remaining = await prisma.dispatchOffer.count({
      where: {
        bookingId: offer.bookingId,
        dispatchCycleId: offer.dispatchCycleId,
        attemptNumber: offer.attemptNumber,
        status: "OFFERED",
      },
    });
    if (!remaining) {
      console.log(`[YOGESH][REJECT_FLOW] next driver dispatch=TRIGGERING_NEXT_BATCH`);
      await queues.dispatch.add(
        "dispatch-next-batch",
        {
          bookingId: offer.bookingId,
          dispatchCycleId: offer.dispatchCycleId,
          attemptNumber: offer.attemptNumber,
        },
        {
          delay: 200,
          jobId: `dispatch-reject-next-${offer.bookingId}-${offer.dispatchCycleId}-${offer.attemptNumber}`,
        },
      );
      this.offers.processDispatchCycle(offer.bookingId).catch((err) => {
        console.error(`[DISPATCH] Error during immediate re-dispatch on reject for ${offer.bookingId}:`, err);
      });
    }
    const booking = await prisma.booking.findUnique({
      where: { id: offer.bookingId },
      select: { type: true, customer: { select: { userId: true } } },
    });
    if (booking?.type === "SCHEDULED" && booking.customer?.userId) {
      await this.notifications.enqueue({
        userId: booking.customer.userId,
        bookingId: offer.bookingId,
        channel: "PUSH",
        templateKey: "SCHEDULED_RIDE_REJECTED",
        title: "Scheduled Ride Update",
        body: "Driver declined scheduled request. Searching for another available driver...",
        data: {
          type: "SCHEDULED_DRIVER_REJECTED",
          entityType: "BOOKING",
          entityId: offer.bookingId,
          bookingId: offer.bookingId,
          screen: "scheduled_rides",
          action: "OPEN_BOOKING",
          role: "USER",
        },
      });
    }

    return offer;
  }

  async markNoDriver(bookingId: string) {
    const changed = await prisma.$transaction(async (tx) => {
      const update = await tx.booking.updateMany({
        where: { id: bookingId, status: BookingStatus.SEARCHING_DRIVER },
        data: {
          status: BookingStatus.NO_DRIVER_FOUND,
          version: { increment: 1 },
        },
      });
      if (update.count) {
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: BookingStatus.SEARCHING_DRIVER,
            toStatus: BookingStatus.NO_DRIVER_FOUND,
          },
        });
        await tx.dispatchOffer.updateMany({
          where: { bookingId, status: "OFFERED" },
          data: { status: "EXPIRED", respondedAt: new Date() },
        });
        await tx.dispatchCycle.updateMany({
          where: { bookingId, status: "ACTIVE" },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            failureReason: "SEARCH_TIMEOUT",
          },
        });
      }
      return update.count;
    });
    if (!changed) return false;
    await redis.del(
      redisKeys.dispatchState(bookingId),
      redisKeys.dispatchCycle(bookingId),
      redisKeys.dispatchOfferedDrivers(bookingId),
    );
    emitBooking(bookingId, "dispatch:no-driver-found", { bookingId });
    emitAdminRoom("dashboard", "admin:dispatch:no-driver-found", {
      bookingId,
    });

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true },
    });

    if (booking) {
      await this.notifications.enqueue({
        userId: booking.customer.userId,
        bookingId: bookingId,
        channel: "PUSH",
        templateKey: "NO_DRIVER_FOUND",
        title: "No drivers available",
        body: "We couldn't find a driver for your ride. Please try again later.",
        data: {
          event: "dispatch:no-driver-found",
          bookingId,
        },
      });
    }

    return true;
  }

  async handleBookingTimeout(bookingId: string) {
    return this.markNoDriver(bookingId);
  }

  async driverCancel(bookingId: string, userId: string, reason?: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("DRIVER_NOT_FOUND");
    return this.redispatchForDriver(
      bookingId,
      driver.id,
      reason ?? "DRIVER_CANCELLED",
    );
  }

  async redispatchForDriver(
    bookingId: string,
    driverId: string,
    reason: string,
  ) {
    const lockKey = redisKeys.bookingCancelLock(bookingId);
    const token = randomUUID();
    const locked = await redis.set(lockKey, token, "PX", 10_000, "NX");
    if (!locked) throw errors.conflict("BOOKING_STATE_CHANGED");

    const cancelCountKey = `booking:cancellation:count:${bookingId}`;
    const cancelCount = await redis.incr(cancelCountKey);
    await redis.expire(cancelCountKey, 86400);
    const nextStatus = "CANCELLED";

    try {
      const result = await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            trip: true,
            assignments: {
              where: { driverId, status: "ACTIVE" },
              take: 1,
            },
          },
        });
        if (!booking) throw errors.notFound("RIDE_REQUEST_NOT_FOUND");
        if (booking.status === "CANCELLED") {
          return {
            tripId: booking.trip?.id ?? null,
            bookingVersion: booking.version,
          };
        }
        if (
          booking.assignedDriverId !== driverId &&
          !["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "DRIVER_ARRIVED"].includes(
            booking.status,
          )
        ) {
          throw errors.conflict("INVALID_BOOKING_TRANSITION");
        }
        const changed = await tx.booking.updateMany({
          where: {
            id: bookingId,
            status: booking.status,
            version: booking.version,
          },
          data: {
            status: nextStatus as any, // "CANCELLED"
            assignedDriverId: null,
            assignedVehicleId: null,
            version: { increment: 1 },
          },
        });
        if (!changed.count) throw errors.conflict("BOOKING_STATE_CHANGED");
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: booking.status,
            toStatus: nextStatus as any,
            reason: reason || "DRIVER_CANCELLED",
          },
        });
        const assignment = booking.assignments[0];
        if (assignment) {
          await tx.driverAssignment.update({
            where: { id: assignment.id },
            data: {
              status: "RELEASED",
              releasedAt: new Date(),
              releaseReason: reason,
            },
          });
          await tx.vehicle.update({
            where: { id: assignment.vehicleId },
            data: { isAvailable: true },
          });
        }
        await tx.driverProfile.update({
          where: { id: driverId },
          data: { availability: "ONLINE" },
        });
        if (
          booking.trip &&
          ["CREATED", "DRIVER_ARRIVING", "DRIVER_ARRIVED"].includes(
            booking.trip.status,
          )
        ) {
          await tx.trip.update({
            where: { id: booking.trip.id },
            data: {
              status: "CANCELLED",
              verificationOtpHash: null,
              verificationOtpExpiresAt: null,
            },
          });
          await tx.tripStatusHistory.create({
            data: {
              tripId: booking.trip.id,
              fromStatus: booking.trip.status,
              toStatus: "CANCELLED",
              metadata: { reason },
            },
          });
        }
        await tx.dispatchCycle.updateMany({
          where: { bookingId, status: "ACTIVE" },
          data: {
            status: "CANCELLED",
            completedAt: new Date(),
            failureReason: reason.slice(0, 100),
          },
        });
        return {
          tripId: booking.trip?.id ?? null,
          bookingVersion: booking.version + 1,
        };
      });

      // Emit cancellation event to customer room & driver room
      const cancelPayload = {
        bookingId,
        status: "CANCELLED",
        cancelledBy: "DRIVER",
        reason: reason || "Cancelled by driver",
        message: "The driver has cancelled this trip.",
      };

      emitBooking(bookingId, "booking:cancelled", cancelPayload);
      emitBooking(bookingId, "goods.booking.cancelled", cancelPayload);
      emitDriver(driverId, "booking:cancelled", cancelPayload);
      emitDriver(driverId, "goods.booking.cancelled", cancelPayload);
      emitAdminRoom("dashboard", "admin:booking:cancelled", {
        bookingId,
        cancelledBy: "DRIVER",
        reason,
      });

      return result;
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        token,
      );
    }
  }
}
