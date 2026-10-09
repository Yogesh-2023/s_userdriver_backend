import { BookingStatus, Prisma, TripStatus } from "@prisma/client";
import { errors } from "../../../common/errors";
import { isValidUUID } from "../admin.utils";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { redisKeys } from "../../../realtime/socket.constants";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
} from "../../../infrastructure/realtime";
import { PricingService } from "../../pricing/service";
import { DriverAvailabilityService } from "../../driver/services/driver-availability.service";
import {
  ACTIVE_TRIP_STATUSES,
  type AdminActionContext,
} from "../admin.constants";
import { AdminBookingService } from "./admin-booking.service";

const transitions: Record<TripStatus, readonly TripStatus[]> = {
  CREATED: [TripStatus.DRIVER_ARRIVING, TripStatus.CANCELLED],
  DRIVER_ARRIVING: [TripStatus.DRIVER_ARRIVED, TripStatus.CANCELLED],
  DRIVER_ARRIVED: [TripStatus.STARTED, TripStatus.CANCELLED],
  STARTED: [TripStatus.COMPLETED, TripStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export class AdminTripService {
  private readonly pricing = new PricingService();
  private readonly bookings = new AdminBookingService();
  private readonly availability = new DriverAvailabilityService();

  async list(input: {
    page: number;
    limit: number;
    status?: TripStatus;
    driverId?: string;
    vehicleId?: string;
    customerId?: string;
    from?: Date;
    to?: Date;
    activeOnly?: boolean;
    search?: string;
  }) {
    const where: Prisma.TripWhereInput = {
      status: input.activeOnly
        ? { in: [...ACTIVE_TRIP_STATUSES] }
        : input.status,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      booking: { customerId: input.customerId },
      createdAt: { gte: input.from, lte: input.to },
      ...(input.search
        ? {
            OR: [
              ...(isValidUUID(input.search)
                ? [{ id: { equals: input.search } }]
                : []),
              {
                driver: {
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
              {
                booking: {
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
              },
            ],
          }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.trip.findMany({
        where,
        include: {
          booking: { include: { customer: { include: { user: true } } } },
          driver: { include: { user: true } },
          vehicle: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.trip.count({ where }),
    ]);
    return { items, total };
  }

  async getPayment(tripId: string) {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || !trip.bookingId) return null;
    return prisma.payment.findFirst({
      where: { bookingId: trip.bookingId },
    });
  }

  async getGlobalLocations() {
    // In a real application, this would fetch from Redis or a live location tracking service.
    // For now, we'll return the last known locations of active trips.
    const activeTrips = await prisma.trip.findMany({
      where: { status: "STARTED" },
      select: {
        id: true,
        driverId: true,
        vehicleId: true,
        bookingId: true,
      },
    });
    return activeTrips;
  }

  async get(tripId: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        booking: {
          include: {
            customer: { include: { user: true } },
            payments: true,
            fareBreakdowns: true,
          },
        },
        driver: { include: { user: true } },
        vehicle: { include: { category: true } },
        statusHistory: { orderBy: { createdAt: "asc" } },
        invoice: true,
        ratings: { include: { review: true } },
      },
    });
    if (!trip) throw errors.notFound("Trip not found");
    const [location, notes] = await Promise.all([
      redis.get(redisKeys.driverLocation(trip.driverId)),
      prisma.adminNote.findMany({
        where: { entityType: "Trip", entityId: tripId },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      ...trip,
      liveLocation: location ? JSON.parse(location) : null,
      adminNotes: notes,
    };
  }

  timeline(tripId: string) {
    return prisma.tripStatusHistory.findMany({
      where: { tripId },
      orderBy: { createdAt: "asc" },
    });
  }

  async liveLocation(tripId: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { driverId: true },
    });
    if (!trip) throw errors.notFound("Trip not found");
    const current = await redis.get(redisKeys.driverLocation(trip.driverId));
    if (current) return { source: "redis", location: JSON.parse(current) };
    const location = await prisma.tripLocationHistory.findFirst({
      where: { tripId },
      orderBy: { recordedAt: "desc" },
    });
    return { source: "postgresql", location };
  }

  locationHistory(tripId: string, page: number, limit: number) {
    return prisma.$transaction([
      prisma.tripLocationHistory.findMany({
        where: { tripId },
        orderBy: { recordedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tripLocationHistory.count({ where: { tripId } }),
    ]);
  }

  async updateStatus(
    tripId: string,
    input: { status: TripStatus; reason: string },
    actor: AdminActionContext,
  ) {
    if (input.status === TripStatus.COMPLETED) {
      throw errors.badRequest("Use the force-complete operation");
    }
    if (input.status === TripStatus.CANCELLED) {
      return this.cancel(tripId, input.reason, actor);
    }
    const result = await prisma.$transaction(
      async (tx) => {
        const trip = await tx.trip.findUnique({
          where: { id: tripId },
          include: { booking: true },
        });
        if (!trip) throw errors.notFound("Trip not found");
        if (!transitions[trip.status].includes(input.status)) {
          throw errors.conflict("Invalid trip status transition");
        }
        const bookingStatus = this.bookingStatus(input.status);
        const changed = await tx.trip.updateMany({
          where: { id: tripId, status: trip.status },
          data: {
            status: input.status,
            startedAt:
              input.status === TripStatus.STARTED
                ? (trip.startedAt ?? new Date())
                : undefined,
          },
        });
        const bookingChanged = await tx.booking.updateMany({
          where: { id: trip.bookingId, version: trip.booking.version },
          data: {
            status: bookingStatus,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1 || bookingChanged.count !== 1) {
          throw errors.conflict("Trip changed; retry the request");
        }
        await tx.tripStatusHistory.create({
          data: {
            tripId,
            fromStatus: trip.status,
            toStatus: input.status,
            actorUserId: actor.userId,
            metadata: { reason: input.reason, adminOverride: true },
          },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: trip.bookingId,
            fromStatus: trip.booking.status,
            toStatus: bookingStatus,
            actorUserId: actor.userId,
            reason: input.reason,
            metadata: { adminOverride: true },
          },
        });
        await this.audit(tx, actor, tripId, "ADMIN_TRIP_STATUS_UPDATED", {
          before: { status: trip.status },
          after: { status: input.status },
          reason: input.reason,
        });
        return {
          tripId,
          bookingId: trip.bookingId,
          driverId: trip.driverId,
          status: input.status,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.emit(result);
    return result;
  }

  async cancel(tripId: string, reason: string, actor: AdminActionContext) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { bookingId: true },
    });
    if (!trip) throw errors.notFound("Trip not found");
    return this.bookings.cancel(trip.bookingId, reason, actor);
  }

  async forceComplete(
    tripId: string,
    input: {
      reason: string;
      finalDistanceMeters: number;
      finalDurationSeconds: number;
      waitingMinutes: number;
      tollCharge: number;
    },
    actor: AdminActionContext,
  ) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { booking: true },
    });
    if (!trip) throw errors.notFound("Trip not found");
    if (trip.status !== TripStatus.STARTED) {
      throw errors.conflict("Only a started trip can be force-completed");
    }
    const fare = await this.pricing.calculate({
      vehicleCategoryId: trip.booking.vehicleCategoryId,
      rideType: trip.booking.rideType,
      distanceMeters: input.finalDistanceMeters,
      durationSeconds: input.finalDurationSeconds,
      waitingMinutes: input.waitingMinutes,
      tollCharge: input.tollCharge,
      customerId: trip.booking.customerId,
    });
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.trip.findUniqueOrThrow({
          where: { id: tripId },
          include: { booking: true },
        });
        if (
          current.status !== TripStatus.STARTED ||
          current.booking.status !== BookingStatus.TRIP_STARTED
        ) {
          throw errors.conflict("Trip changed; retry the request");
        }
        const captured = await tx.payment.count({
          where: { bookingId: current.bookingId, status: "CAPTURED" },
        });
        const targetBookingStatus = captured
          ? BookingStatus.PAYMENT_COMPLETED
          : BookingStatus.PAYMENT_PENDING;
        const tripChanged = await tx.trip.updateMany({
          where: { id: tripId, status: TripStatus.STARTED },
          data: {
            status: TripStatus.COMPLETED,
            completedAt: new Date(),
            actualDistanceMeters: input.finalDistanceMeters,
            actualDurationSeconds: input.finalDurationSeconds,
          },
        });
        const bookingChanged = await tx.booking.updateMany({
          where: {
            id: current.bookingId,
            status: BookingStatus.TRIP_STARTED,
            version: current.booking.version,
          },
          data: {
            status: targetBookingStatus,
            finalFare: fare.total,
            version: { increment: 1 },
          },
        });
        if (tripChanged.count !== 1 || bookingChanged.count !== 1) {
          throw errors.conflict("Trip changed; retry the request");
        }
        await tx.tripStatusHistory.create({
          data: {
            tripId,
            fromStatus: TripStatus.STARTED,
            toStatus: TripStatus.COMPLETED,
            actorUserId: actor.userId,
            metadata: { reason: input.reason, adminOverride: true },
          },
        });
        await tx.bookingStatusHistory.createMany({
          data: [
            {
              bookingId: current.bookingId,
              fromStatus: BookingStatus.TRIP_STARTED,
              toStatus: BookingStatus.TRIP_COMPLETED,
              actorUserId: actor.userId,
              reason: input.reason,
              metadata: { adminOverride: true },
            },
            {
              bookingId: current.bookingId,
              fromStatus: BookingStatus.TRIP_COMPLETED,
              toStatus: targetBookingStatus,
              actorUserId: actor.userId,
              reason: input.reason,
              metadata: { adminOverride: true },
            },
          ],
        });
        await tx.fareBreakdown.upsert({
          where: { tripId },
          update: {
            baseFare: fare.baseFare,
            distanceCharge: fare.distanceCharge,
            timeCharge: fare.timeCharge,
            waitingCharge: fare.waitingCharge,
            tollCharge: fare.tollCharge,
            surgeMultiplier: fare.surgeMultiplier,
            surgeCharge: fare.surgeCharge,
            subtotal: fare.subtotal,
            discount: fare.discount,
            tax: fare.tax,
            total: fare.total,
            calculationSnapshot: fare.calculationSnapshot,
          },
          create: {
            bookingId: current.bookingId,
            tripId,
            kind: "FINAL",
            baseFare: fare.baseFare,
            distanceCharge: fare.distanceCharge,
            timeCharge: fare.timeCharge,
            waitingCharge: fare.waitingCharge,
            tollCharge: fare.tollCharge,
            surgeMultiplier: fare.surgeMultiplier,
            surgeCharge: fare.surgeCharge,
            subtotal: fare.subtotal,
            discount: fare.discount,
            tax: fare.tax,
            total: fare.total,
            calculationSnapshot: fare.calculationSnapshot,
          },
        });
        await Promise.all([
          tx.driverProfile.update({
            where: { id: current.driverId },
            data: { totalTrips: { increment: 1 } },
          }),
          tx.vehicle.update({
            where: { id: current.vehicleId },
            data: { isAvailable: true },
          }),
        ]);
        await this.audit(tx, actor, tripId, "ADMIN_TRIP_FORCE_COMPLETED", {
          before: { status: current.status },
          after: {
            status: TripStatus.COMPLETED,
            finalFare: fare.total,
            paymentStatus: targetBookingStatus,
          },
          reason: input.reason,
        });
        return {
          tripId,
          bookingId: current.bookingId,
          driverId: current.driverId,
          status: TripStatus.COMPLETED,
          finalFare: fare.total,
          paymentState: targetBookingStatus,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await redis.del(
      redisKeys.tripLive(tripId),
      redisKeys.tripLastLocation(tripId),
    );
    await this.availability.restoreAvailable(result.driverId);
    this.emit(result);
    return result;
  }

  async addNote(tripId: string, note: string, actor: AdminActionContext) {
    const exists = await prisma.trip.count({ where: { id: tripId } });
    if (!exists) throw errors.notFound("Trip not found");
    const created = await prisma.adminNote.create({
      data: {
        adminId: actor.adminId,
        entityType: "Trip",
        entityId: tripId,
        content: note,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_TRIP_NOTE_ADDED",
        entityType: "Trip",
        entityId: tripId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
    });
    return created;
  }

  async reportIncident(
    tripId: string,
    input: { type: string; description: string },
    actor: AdminActionContext,
  ) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { bookingId: true },
    });
    if (!trip) throw errors.notFound("Trip not found");
    const incident = await prisma.safetyIncident.create({
      data: {
        bookingId: trip.bookingId,
        reportedByUserId: actor.userId,
        type: input.type,
        description: input.description,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_TRIP_INCIDENT_REPORTED",
        entityType: "SafetyIncident",
        entityId: incident.id,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { tripId, type: input.type },
      },
    });
    return incident;
  }

  private bookingStatus(status: TripStatus) {
    const map: Partial<Record<TripStatus, BookingStatus>> = {
      DRIVER_ARRIVING: BookingStatus.DRIVER_ARRIVING,
      DRIVER_ARRIVED: BookingStatus.DRIVER_ARRIVED,
      STARTED: BookingStatus.TRIP_STARTED,
    };
    const value = map[status];
    if (!value) throw errors.badRequest("Unsupported trip status");
    return value;
  }

  private emit(result: {
    tripId: string;
    bookingId: string;
    driverId: string;
    status: TripStatus;
  }) {
    const event =
      result.status === TripStatus.COMPLETED
        ? "admin:trip:completed"
        : "admin:booking:status-updated";
    emitBooking(result.bookingId, event, result);
    emitDriver(result.driverId, event, result);
    emitAdminRoom("tracking", event, result);
    emitAdminRoom("dashboard", event, result);
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AdminActionContext,
    tripId: string,
    action: string,
    input: {
      before: Prisma.InputJsonObject;
      after: Prisma.InputJsonObject;
      reason: string;
    },
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action,
        entityType: "Trip",
        entityId: tripId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        reason: input.reason,
        before: input.before,
        after: input.after,
      },
    });
  }
}
