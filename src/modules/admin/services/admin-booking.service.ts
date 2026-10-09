import { isValidUUID } from "../admin.utils";
import { BookingStatus, DispatchOfferStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
} from "../../../infrastructure/realtime";
import { canTransition } from "../../bookings/enums/status";
import { NotificationsService } from "../../notifications/service";
import { redisKeys } from "../../../realtime/socket.constants";
import {
  ACTIVE_TRIP_STATUSES,
  REQUIRED_VEHICLE_DOCUMENTS,
  type AdminActionContext,
} from "../admin.constants";
import { getRoute } from "../../../integrations/maps";
import { PricingService } from "../../pricing/service";

export class AdminBookingService {
  private readonly notifications = new NotificationsService();
  private readonly pricing = new PricingService();

  async list(input: {
    page: number;
    limit: number;
    bookingId?: string;
    customerId?: string;
    driverId?: string;
    vehicleId?: string;
    categoryId?: string;
    status?: BookingStatus;
    paymentStatus?: string;
    type?: "IMMEDIATE" | "SCHEDULED";
    pickup?: string;
    drop?: string;
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const where: Prisma.BookingWhereInput = {
      id: input.bookingId,
      customerId: input.customerId,
      vehicleCategoryId: input.categoryId,
      status: input.status,
      ...(input.search
        ? {
            OR: [
              ...(isValidUUID(input.search)
                ? [{ id: { equals: input.search } }]
                : []),
              {
                pickupAddress: {
                  contains: input.search,
                  mode: "insensitive" as const,
                },
              },
              {
                dropAddress: {
                  contains: input.search,
                  mode: "insensitive" as const,
                },
              },
              {
                customer: {
                  user: {
                    OR: [
                      {
                        displayName: {
                          contains: input.search,
                          mode: "insensitive" as const,
                        },
                      },
                      { phone: { contains: input.search } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
      type: input.type,
      createdAt: { gte: input.from, lte: input.to },
      pickupAddress: input.pickup
        ? { contains: input.pickup, mode: "insensitive" }
        : undefined,
      dropAddress: input.drop
        ? { contains: input.drop, mode: "insensitive" }
        : undefined,
      dispatchOffers:
        input.driverId || input.vehicleId
          ? {
              some: {
                driverId: input.driverId,
                vehicleId: input.vehicleId,
                status: "ACCEPTED",
              },
            }
          : undefined,
      payments: input.paymentStatus
        ? { some: { status: input.paymentStatus as never } }
        : undefined,
    };
    const [items, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        include: {
          customer: { include: { user: true } },
          vehicleCategory: true,
          assignedDriver: { include: { user: true } },
          assignedVehicle: true,
          dispatchOffers: {
            where: { status: "ACCEPTED" },
            include: { driver: { include: { user: true } }, vehicle: true },
          },
          trip: {
            include: {
              driver: { include: { user: true } },
              vehicle: true,
            },
          },
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.booking.count({ where }),
    ]);
    return { items, total };
  }

  async get(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: { include: { user: true } },
        vehicleCategory: true,
        assignedDriver: { include: { user: true } },
        assignedVehicle: true,
        coupon: true,
        fareBreakdowns: { orderBy: { createdAt: "asc" } },
        dispatchOffers: {
          orderBy: { createdAt: "asc" },
          include: { driver: { include: { user: true } }, vehicle: true },
        },
        trip: {
          include: {
            driver: { include: { user: true } },
            vehicle: true,
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          include: { transactions: true, refunds: true },
        },
        cancellation: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!booking) throw errors.notFound("Booking not found");
    const notes = await prisma.adminNote.findMany({
      where: { entityType: "Booking", entityId: bookingId },
      orderBy: { createdAt: "desc" },
    });
    const liveLocation = booking.trip
      ? await redis.get(redisKeys.driverLocation(booking.trip.driverId))
      : null;
    return {
      ...booking,
      adminNotes: notes,
      liveLocation: liveLocation ? JSON.parse(liveLocation) : null,
    };
  }

  timeline(bookingId: string) {
    return prisma.bookingStatusHistory.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(data: any, _actor: AdminActionContext) {
    let estimatedFare = data.estimatedFare;
    let distanceMeters = 0;
    let durationSeconds = 0;

    if (
      !estimatedFare &&
      data.vehicleCategoryId &&
      data.pickupLocation &&
      data.dropoffLocation
    ) {
      try {
        const route = await getRoute(
          {
            latitude: data.pickupLocation.latitude,
            longitude: data.pickupLocation.longitude,
          },
          {
            latitude: data.dropoffLocation.latitude,
            longitude: data.dropoffLocation.longitude,
          },
        );
        distanceMeters = route.distanceMeters;
        durationSeconds = route.durationSeconds;

        const fare = await this.pricing.calculate({
          vehicleCategoryId: data.vehicleCategoryId,
          rideType: "CITY",
          distanceMeters,
          durationSeconds,
          customerId: data.customerId,
        });
        estimatedFare = fare.subtotal; // Subtotal represents the estimated fare
      } catch (err) {
        console.error(
          "Failed to calculate fare for admin booking creation:",
          err,
        );
        // Fallback to 0 if calculation fails
        estimatedFare = 0;
      }
    }

    return prisma.booking.create({
      data: {
        customerId: data.customerId,
        vehicleCategoryId: data.vehicleCategoryId,
        pickupAddress: data.pickupLocation.address,
        pickupLatitude: data.pickupLocation.latitude,
        pickupLongitude: data.pickupLocation.longitude,
        dropAddress: data.dropoffLocation.address,
        dropLatitude: data.dropoffLocation.latitude,
        dropLongitude: data.dropoffLocation.longitude,
        distanceMeters,
        durationSeconds,
        scheduledAt: data.scheduledAt,
        estimatedFare: estimatedFare || 0,
        status: "PENDING",
        idempotencyKey: Math.random().toString(36).substring(7),
      },
    });
  }

  async update(bookingId: string, data: any, _actor: AdminActionContext) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw errors.notFound("Booking not found");
    return prisma.booking.update({
      where: { id: bookingId },
      data,
    });
  }

  async delete(bookingId: string, actor: AdminActionContext) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw errors.notFound("Booking not found");
    // Soft delete or just update status to cancelled
    return this.cancel(bookingId, "Deleted by admin", actor);
  }

  async getInvoice(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw errors.notFound("Booking not found");
    const trip = await prisma.trip.findFirst({ where: { bookingId } });
    if (!trip) return null;
    return prisma.invoice.findFirst({
      where: { tripId: trip.id },
    });
  }

  async updatePaymentStatus(
    bookingId: string,
    data: any,
    _actor: AdminActionContext,
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw errors.notFound("Booking not found");

    const payment = await prisma.payment.findFirst({
      where: { bookingId },
    });
    if (!payment) {
      return prisma.payment.create({
        data: {
          bookingId,
          amount: booking.estimatedFare || 0,
          method: "CASH", // placeholder
          status: data.status,
          providerPaymentId: data.transactionId,
          provider: "MANUAL",
          idempotencyKey: Math.random().toString(36).substring(7),
        },
      });
    }

    return prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: data.status,
        providerPaymentId: data.transactionId,
      },
    });
  }

  async assign(
    bookingId: string,
    input: { driverId: string; vehicleId?: string; reason: string },
    actor: AdminActionContext,
    reassign = false,
  ) {
    const keys = [
      `lock:booking-assignment:${bookingId}`,
      `lock:driver-assignment:${input.driverId}`,
    ];
    if (input.vehicleId)
      keys.push(`lock:vehicle-assignment:${input.vehicleId}`);
    keys.sort();

    const lockToken = randomUUID();
    const lockedKeys: string[] = [];

    for (const key of keys) {
      const locked = await redis.set(key, lockToken, "PX", 15_000, "NX");
      if (!locked) {
        for (const acquired of lockedKeys) {
          await redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            acquired,
            lockToken,
          );
        }
        throw errors.conflict(
          "Assignment is in progress for booking, driver, or vehicle",
        );
      }
      lockedKeys.push(key);
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const booking = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
              trip: true,
              dispatchOffers: {
                where: { status: "ACCEPTED" },
                include: { driver: true },
              },
            },
          });
          if (!booking) throw errors.notFound("Booking not found");
          const allowed = reassign
            ? booking.status === BookingStatus.DRIVER_ASSIGNED &&
              (!booking.trip || booking.trip.status === "CREATED")
            : booking.status === BookingStatus.PENDING ||
              booking.status === BookingStatus.SEARCHING_DRIVER;
          if (!allowed) {
            throw errors.conflict(
              "Booking cannot be assigned in its current state",
            );
          }
          const driver = await tx.driverProfile.findUnique({
            where: { id: input.driverId },
            include: {
              user: true,
              vehicleAssignments: {
                where: {
                  isActive: true,
                  vehicleId: input.vehicleId,
                },
                include: { vehicle: { include: { documents: true } } },
                take: 1,
              },
            },
          });
          const assignment = driver?.vehicleAssignments[0];
          if (
            !driver ||
            !assignment ||
            driver.user.status !== "ACTIVE" ||
            driver.verificationStatus !== "VERIFIED" ||
            driver.availability === "BUSY"
          ) {
            throw errors.conflict("Driver is not eligible for this booking");
          }
          const vehicle = assignment.vehicle;
          if (
            vehicle.categoryId !== booking.vehicleCategoryId ||
            vehicle.status !== "ACTIVE" ||
            vehicle.verificationStatus !== "APPROVED" ||
            !vehicle.isAvailable
          ) {
            throw errors.conflict("Assigned vehicle is not eligible");
          }
          this.assertDocuments(vehicle.documents);
          const [driverTrip, vehicleTrip] = await Promise.all([
            tx.trip.count({
              where: {
                driverId: driver.id,
                status: { in: [...ACTIVE_TRIP_STATUSES] },
              },
            }),
            tx.trip.count({
              where: {
                vehicleId: vehicle.id,
                status: { in: [...ACTIVE_TRIP_STATUSES] },
              },
            }),
          ]);
          if (driverTrip || vehicleTrip) {
            throw errors.conflict("Driver or vehicle has an active trip");
          }
          for (const old of booking.dispatchOffers) {
            await tx.driverProfile.update({
              where: { id: old.driverId },
              data: { availability: "ONLINE" },
            });
            await tx.vehicle.update({
              where: { id: old.vehicleId },
              data: { isAvailable: true },
            });
          }
          await tx.dispatchOffer.updateMany({
            where: {
              bookingId,
              status: {
                in: [DispatchOfferStatus.OFFERED, DispatchOfferStatus.ACCEPTED],
              },
            },
            data: { status: DispatchOfferStatus.CANCELLED },
          });
          const lastCycle = await tx.dispatchCycle.findFirst({
            where: { bookingId },
            orderBy: { cycleNumber: "desc" },
            select: { cycleNumber: true },
          });
          const cycle = await tx.dispatchCycle.create({
            data: {
              bookingId,
              cycleNumber: (lastCycle?.cycleNumber ?? 0) + 1,
              attemptNumber: 0,
              radiusMeters: 0,
              status: "COMPLETED",
              completedAt: new Date(),
            },
          });
          const accepted = await tx.dispatchOffer.create({
            data: {
              bookingId,
              dispatchCycleId: cycle.id,
              driverId: driver.id,
              vehicleId: vehicle.id,
              attemptNumber: 0,
              status: "ACCEPTED",
              respondedAt: new Date(),
              expiresAt: new Date(Date.now() + 60_000),
            },
          });
          const changed = await tx.booking.updateMany({
            where: { id: bookingId, version: booking.version },
            data: {
              status: BookingStatus.DRIVER_ASSIGNED,
              assignedDriverId: driver.id,
              assignedVehicleId: vehicle.id,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) {
            throw errors.conflict("Booking changed; retry assignment");
          }
          await tx.driverProfile.update({
            where: { id: driver.id },
            data: { availability: "BUSY" },
          });
          await tx.vehicle.update({
            where: { id: vehicle.id },
            data: { isAvailable: false },
          });
          const durableAssignment = await tx.driverAssignment.create({
            data: {
              bookingId,
              driverId: driver.id,
              vehicleId: vehicle.id,
              dispatchOfferId: accepted.id,
              status: "ACTIVE",
              batchNo: 0,
              expiresAt: accepted.expiresAt,
              respondedAt: accepted.respondedAt,
            },
          });
          const trip = booking.trip
            ? await tx.trip.update({
                where: { id: booking.trip.id },
                data: { driverId: driver.id, vehicleId: vehicle.id },
              })
            : await tx.trip.create({
                data: {
                  bookingId,
                  driverId: driver.id,
                  vehicleId: vehicle.id,
                  statusHistory: { create: { toStatus: "CREATED" } },
                },
              });
          await tx.bookingStatusHistory.create({
            data: {
              bookingId,
              fromStatus: booking.status,
              toStatus: BookingStatus.DRIVER_ASSIGNED,
              actorUserId: actor.userId,
              reason: input.reason,
              metadata: {
                adminOverride: true,
                reassign,
                driverId: driver.id,
                vehicleId: vehicle.id,
              },
            },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: actor.userId,
              actorRole: actor.role,
              action: reassign
                ? "ADMIN_BOOKING_REASSIGNED"
                : "ADMIN_BOOKING_ASSIGNED",
              entityType: "Booking",
              entityId: bookingId,
              requestId: actor.requestId,
              ipAddress: actor.ipAddress,
              userAgent: actor.userAgent,
              reason: input.reason,
              before: {
                driverIds: booking.dispatchOffers.map(
                  ({ driverId }) => driverId,
                ),
              },
              after: { driverId: driver.id, vehicleId: vehicle.id },
            },
          });
          return {
            bookingId,
            tripId: trip.id,
            driverId: driver.id,
            driverUserId: driver.userId,
            customerUserId: (
              await tx.customerProfile.findUniqueOrThrow({
                where: { id: booking.customerId },
              })
            ).userId,
            vehicleId: vehicle.id,
            assignmentId: durableAssignment.id,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      emitBooking(bookingId, "admin:booking:status-updated", result);
      emitDriver(result.driverId, "booking:accepted", result);
      emitAdminRoom("dashboard", "admin:booking:status-updated", result);
      await Promise.all([
        this.notifications.enqueue({
          userId: result.customerUserId,
          bookingId,
          channel: "IN_APP",
          templateKey: reassign
            ? "ADMIN_BOOKING_REASSIGNED"
            : "ADMIN_BOOKING_ASSIGNED",
          title: "Driver assigned",
          body: "A driver has been assigned to your booking.",
        }),
        this.notifications.enqueue({
          userId: result.driverUserId,
          bookingId,
          channel: "IN_APP",
          templateKey: "ADMIN_DRIVER_ASSIGNMENT",
          title: "Ride assigned",
          body: "An administrator assigned a ride to you.",
        }),
      ]);
      return result;
    } finally {
      for (const key of lockedKeys) {
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          lockToken,
        );
      }
    }
  }

  async cancel(bookingId: string, reason: string, actor: AdminActionContext) {
    const result = await prisma.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            customer: true,
            dispatchOffers: {
              where: { status: "ACCEPTED" },
              include: { driver: true },
            },
            trip: true,
          },
        });
        if (!booking) throw errors.notFound("Booking not found");
        if (!canTransition(booking.status, BookingStatus.CANCELLED)) {
          throw errors.conflict("Booking cannot be cancelled");
        }
        const fareRule = await tx.pricingRule.findFirst({
          where: {
            vehicleCategoryId: booking.vehicleCategoryId,
            rideType: booking.rideType,
            isActive: true,
            effectiveFrom: { lte: booking.createdAt },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gt: booking.createdAt } },
            ],
          },
          orderBy: { effectiveFrom: "desc" },
        });
        const fee =
          booking.status === BookingStatus.PENDING
            ? 0
            : (fareRule?.cancellationFee ?? 0);
        const changed = await tx.booking.updateMany({
          where: {
            id: bookingId,
            version: booking.version,
            status: booking.status,
          },
          data: { status: "CANCELLED", version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw errors.conflict("Booking changed; retry");
        await tx.bookingCancellation.create({
          data: {
            bookingId,
            cancelledByUserId: actor.userId,
            reasonCode: "ADMIN_OVERRIDE",
            reason,
            fee,
          },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: booking.status,
            toStatus: "CANCELLED",
            actorUserId: actor.userId,
            reason,
            metadata: { adminOverride: true, cancellationFee: fee },
          },
        });
        await tx.dispatchOffer.updateMany({
          where: {
            bookingId,
            status: { in: ["OFFERED", "ACCEPTED"] },
          },
          data: { status: "CANCELLED" },
        });
        for (const assignment of booking.dispatchOffers) {
          await tx.driverProfile.update({
            where: { id: assignment.driverId },
            data: { availability: "ONLINE" },
          });
          await tx.vehicle.update({
            where: { id: assignment.vehicleId },
            data: { isAvailable: true },
          });
        }
        if (booking.trip) {
          await tx.trip.update({
            where: { id: booking.trip.id },
            data: {
              status: "CANCELLED",
              statusHistory: {
                create: {
                  fromStatus: booking.trip.status,
                  toStatus: "CANCELLED",
                  actorUserId: actor.userId,
                  metadata: { reason, adminOverride: true },
                },
              },
            },
          });
        }
        await tx.auditLog.create({
          data: {
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: "ADMIN_BOOKING_CANCELLED",
            entityType: "Booking",
            entityId: bookingId,
            requestId: actor.requestId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
            reason,
            before: { status: booking.status },
            after: { status: "CANCELLED", fee },
          },
        });
        return {
          bookingId,
          customerUserId: booking.customer.userId,
          driverIds: booking.dispatchOffers.map(({ driverId }) => driverId),
          fee,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    emitBooking(bookingId, "admin:booking:status-updated", {
      bookingId,
      status: "CANCELLED",
      fee: result.fee,
    });
    emitAdminRoom("dashboard", "admin:booking:status-updated", {
      bookingId,
      status: "CANCELLED",
    });
    await this.notifications.enqueue({
      userId: result.customerUserId,
      bookingId,
      channel: "IN_APP",
      templateKey: "ADMIN_BOOKING_CANCELLED",
      title: "Booking cancelled",
      body: "Your booking was cancelled by operations.",
    });
    return result;
  }

  async updateStatus(
    bookingId: string,
    input: { status: BookingStatus; reason: string },
    actor: AdminActionContext,
  ) {
    if (
      (
        [
          BookingStatus.DRIVER_ARRIVING,
          BookingStatus.DRIVER_ARRIVED,
          BookingStatus.TRIP_STARTED,
          BookingStatus.TRIP_COMPLETED,
          BookingStatus.PAYMENT_PENDING,
          BookingStatus.PAYMENT_COMPLETED,
          BookingStatus.CANCELLED,
        ] as readonly BookingStatus[]
      ).includes(input.status)
    ) {
      throw errors.conflict(
        "Use the dedicated trip, cancellation, or payment operation for this status",
      );
    }
    const updated = await prisma.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
        });
        if (!booking) throw errors.notFound("Booking not found");
        if (!canTransition(booking.status, input.status)) {
          throw errors.conflict("Invalid booking status transition");
        }
        if (
          input.status === BookingStatus.DRIVER_ASSIGNED &&
          !(await tx.dispatchOffer.count({
            where: { bookingId, status: "ACCEPTED" },
          }))
        ) {
          throw errors.conflict("Assign a driver before changing this status");
        }
        const changed = await tx.booking.updateMany({
          where: {
            id: bookingId,
            status: booking.status,
            version: booking.version,
          },
          data: { status: input.status, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw errors.conflict("Booking changed; retry");
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: booking.status,
            toStatus: input.status,
            actorUserId: actor.userId,
            reason: input.reason,
            metadata: { adminOverride: true },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: "ADMIN_BOOKING_STATUS_UPDATED",
            entityType: "Booking",
            entityId: bookingId,
            requestId: actor.requestId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
            reason: input.reason,
            before: { status: booking.status },
            after: { status: input.status },
          },
        });
        return tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    emitBooking(bookingId, "admin:booking:status-updated", updated);
    emitAdminRoom("dashboard", "admin:booking:status-updated", updated);
    return updated;
  }

  locationHistory(bookingId: string, page: number, limit: number) {
    return prisma.$transaction([
      prisma.tripLocationHistory.findMany({
        where: { trip: { bookingId } },
        orderBy: { recordedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tripLocationHistory.count({ where: { trip: { bookingId } } }),
    ]);
  }

  payment(bookingId: string) {
    return prisma.payment.findMany({
      where: { bookingId },
      include: { transactions: true, refunds: true, invoice: true },
      orderBy: { createdAt: "desc" },
    });
  }

  bids(bookingId: string) {
    return prisma.dispatchOffer.findMany({
      where: { bookingId },
      include: { driver: { include: { user: true } }, vehicle: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async matchingLogs(bookingId: string) {
    return prisma.dispatchCycle.findMany({
      where: { bookingId },
      include: { offers: true },
      orderBy: { cycleNumber: "asc" },
    });
  }

  async listScheduled(input: {
    page: number;
    limit: number;
    status?: string;
    customerId?: string;
    driverId?: string;
    vehicleId?: string;
    search?: string;
    from?: Date;
    to?: Date;
  }) {
    const bookingWhere: Prisma.BookingWhereInput = {
      ...(input.status ? { status: input.status as BookingStatus } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
    };
    const assignmentFilters: Prisma.BookingWhereInput[] = [
      ...(input.driverId ? [{ assignedDriverId: input.driverId }] : []),
      ...(input.vehicleId ? [{ assignedVehicleId: input.vehicleId }] : []),
    ];
    if (assignmentFilters.length > 0) {
      bookingWhere.OR = assignmentFilters;
    }
    if (input.search) {
      const search = input.search.trim();
      const searchFilters: Prisma.BookingWhereInput[] = [
        ...(isValidUUID(search) ? [{ id: search }] : []),
        { pickupAddress: { contains: search, mode: "insensitive" } },
        { dropAddress: { contains: search, mode: "insensitive" } },
        {
          customer: {
            user: {
              OR: [
                { displayName: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
              ],
            },
          },
        },
      ];
      bookingWhere.AND = [{ OR: searchFilters }];
    }

    const where: Prisma.ScheduledBookingWhereInput = {
      scheduledAt: { gte: input.from, lte: input.to },
      booking: bookingWhere,
    };
    const [items, total] = await prisma.$transaction([
      prisma.scheduledBooking.findMany({
        where,
        include: {
          booking: {
            include: {
              customer: { include: { user: true } },
              vehicleCategory: { select: { id: true, name: true } },
              assignedDriver: {
                select: {
                  id: true,
                  user: { select: { displayName: true, phone: true } },
                },
              },
              assignedVehicle: {
                select: {
                  id: true,
                  registrationNo: true,
                  category: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { scheduledAt: "asc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.scheduledBooking.count({ where }),
    ]);
    return { items, total };
  }

  async getScheduled(id: string) {
    const item = await prisma.scheduledBooking.findUnique({
      where: { id },
      include: {
        booking: {
          include: {
            customer: { include: { user: true } },
            vehicleCategory: true,
            statusHistory: true,
            dispatchOffers: { include: { driver: true } },
          },
        },
      },
    });
    if (!item) throw errors.notFound("Scheduled booking not found");
    return item;
  }

  async updateScheduledStatus(
    id: string,
    status: BookingStatus,
    reason: string,
    actor: AdminActionContext,
  ) {
    const item = await prisma.scheduledBooking.findUnique({
      where: { id },
      select: { bookingId: true },
    });
    if (!item) throw errors.notFound("Scheduled booking not found");
    return this.updateStatus(item.bookingId, { status, reason }, actor);
  }

  async assignScheduledDriver(
    id: string,
    input: { driverId: string; vehicleId?: string; reason: string },
    actor: AdminActionContext,
  ) {
    const item = await prisma.scheduledBooking.findUnique({
      where: { id },
      select: { bookingId: true },
    });
    if (!item) throw errors.notFound("Scheduled booking not found");
    return this.assign(item.bookingId, input, actor, false);
  }

  private assertDocuments(
    documents: Array<{ type: string; status: string; expiresAt: Date | null }>,
  ) {
    const now = new Date();
    const valid = new Set(
      documents
        .filter(
          (document) =>
            document.status === "VERIFIED" &&
            (!document.expiresAt || document.expiresAt > now),
        )
        .map(({ type }) => type),
    );
    if (!REQUIRED_VEHICLE_DOCUMENTS.every((type) => valid.has(type))) {
      throw errors.conflict("Vehicle documents are incomplete or expired");
    }
  }
}
