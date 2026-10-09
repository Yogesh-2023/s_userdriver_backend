import {
  BookingStatus,
  PaymentMethod,
  Prisma,
  TripStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { errors } from "../../../common/errors";
import { distanceMeters } from "../../../common/geo";
import { env } from "../../../config/env";
import { prisma } from "../../../database/prisma";
import { RideChatService } from "../../bookings/ride-chat.service";
import { redis } from "../../../infrastructure/redis";
import { getRoute } from "../../../integrations/maps";
import { redisKeys } from "../../../realtime/socket.constants";
import { PaymentsService } from "../../payments/service";
import { TripsService } from "../../trips/service";
import { DriverAvailabilityService } from "./driver-availability.service";
import { DriverLocationService } from "./driver-location.service";
import { DriverSafetyService } from "./driver-safety.service";
import { DriverTripHistoryService } from "./driver-trip-history.service";

const activeStatuses: BookingStatus[] = [
  BookingStatus.DRIVER_ASSIGNED,
  BookingStatus.DRIVER_ARRIVING,
  BookingStatus.DRIVER_ARRIVED,
  BookingStatus.TRIP_STARTED,
  BookingStatus.PAYMENT_PENDING,
];

type BookingListFilters = {
  status?: BookingStatus;
  startDate?: Date;
  endDate?: Date;
  vehicleCategoryId?: string;
  paymentMethod?: PaymentMethod;
  limit?: number;
  offset?: number;
};

type SafetyType =
  | "UNSAFE_CUSTOMER"
  | "CUSTOMER_MISCONDUCT"
  | "ACCIDENT"
  | "VEHICLE_BREAKDOWN"
  | "ROUTE_SAFETY"
  | "MEDICAL_EMERGENCY"
  | "OTHER";

export class DriverBookingJourneyService {
  private readonly trips = new TripsService();
  private readonly locations = new DriverLocationService();
  private readonly availability = new DriverAvailabilityService();
  private readonly payments = new PaymentsService();
  private readonly safety = new DriverSafetyService();
  private readonly history = new DriverTripHistoryService();
  private readonly chat = new RideChatService();

  async listBookings(userId: string, filters: BookingListFilters) {
    const driver = await this.getDriver(userId);
    const where: Prisma.BookingWhereInput = {
      OR: [{ assignedDriverId: driver.id }, { trip: { driverId: driver.id } }],
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.vehicleCategoryId
        ? { vehicleCategoryId: filters.vehicleCategoryId }
        : {}),
      ...(filters.startDate || filters.endDate
        ? {
            createdAt: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
            },
          }
        : {}),
      ...(filters.paymentMethod
        ? { payments: { some: { method: filters.paymentMethod } } }
        : {}),
    };
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: this.bookingInclude(),
        orderBy: { createdAt: "desc" },
        take: filters.limit ?? 20,
        skip: filters.offset ?? 0,
      }),
      prisma.booking.count({ where }),
    ]);
    return {
      items: bookings.map((booking) => this.toDriverBooking(booking)),
      total,
      limit: filters.limit ?? 20,
      offset: filters.offset ?? 0,
    };
  }

  async getActiveBooking(userId: string) {
    const driver = await this.getDriver(userId);
    const booking = await prisma.booking.findFirst({
      where: {
        OR: [
          { assignedDriverId: driver.id },
          { trip: { driverId: driver.id } },
        ],
        status: { in: activeStatuses },
      },
      include: this.bookingInclude(),
      orderBy: { updatedAt: "desc" },
    });
    return booking ? this.toDriverBooking(booking) : null;
  }

  async getBooking(userId: string, bookingId: string) {
    return this.toDriverBooking(await this.getOwnedBooking(userId, bookingId));
  }

  async getPickupRoute(userId: string, bookingId: string) {
    const { booking, driver } = await this.getActiveOwnedBooking(
      userId,
      bookingId,
    );
    const location = await this.locations.getFreshByDriverId(
      driver.id,
    );
    const route = await getRoute(location, {
      latitude: Number(booking.pickupLatitude),
      longitude: Number(booking.pickupLongitude),
    });
    return {
      bookingId,
      origin: location,
      destination: {
        address: booking.pickupAddress,
        latitude: Number(booking.pickupLatitude),
        longitude: Number(booking.pickupLongitude),
      },
      ...route,
    };
  }

  async getPickupEta(userId: string, bookingId: string) {
    const route = await this.getPickupRoute(userId, bookingId);
    return {
      bookingId,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      etaAt: new Date(Date.now() + route.durationSeconds * 1_000),
      provider: route.provider,
    };
  }

  async navigate(userId: string, bookingId: string) {
    await this.getActiveOwnedBooking(userId, bookingId);
    return this.trips.arrivingByBooking(bookingId, userId);
  }

  async getMessages(userId: string, bookingId: string) {
    await this.getActiveOwnedBooking(userId, bookingId);
    return prisma.chatMessage.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        senderId: true,
        senderType: true,
        content: true,
        createdAt: true,
      },
    });
  }

  async sendMessage(
    userId: string,
    bookingId: string,
    message: string,
    _attachments?: unknown[],
  ) {
    const { driver } = await this.getActiveOwnedBooking(userId, bookingId);
    return this.chat.send({
      userId,
      bookingId,
      message,
      senderType: "DRIVER",
      driverId: driver.id,
    });
  }

  async callCustomer(userId: string, bookingId: string) {
    const { booking } = await this.getActiveOwnedBooking(userId, bookingId);
    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorRole: "DRIVER",
        action: "DRIVER_CUSTOMER_CALL_REQUESTED",
        entityType: "BOOKING",
        entityId: bookingId,
        metadata: { channel: "MASKED_CALL" },
      },
    });
    return {
      bookingId,
      customerPhone: this.maskPhone(booking.customer.user.phone),
      available: false,
      reason: "Masked calling provider is not configured",
    };
  }

  async verifyPickupOtp(userId: string, bookingId: string, otp: string) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    return this.trips.verifyPickupOtp(booking.trip.id, otp, userId);
  }

  async startTrip(userId: string, bookingId: string, otp?: string) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    if (otp && otp.trim().length > 0) {
      return this.trips.start(booking.trip.id, otp.trim(), userId);
    }
    return this.trips.startVerified(booking.trip.id, userId);
  }

  async getTripRoute(userId: string, bookingId: string) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    if (
      !([TripStatus.STARTED, TripStatus.COMPLETED] as TripStatus[]).includes(
        booking.trip.status,
      )
    ) {
      throw errors.conflict("Trip route is not available yet");
    }
    return {
      bookingId,
      tripId: booking.trip.id,
      origin: {
        address: booking.pickupAddress,
        latitude: Number(booking.pickupLatitude),
        longitude: Number(booking.pickupLongitude),
      },
      destination: {
        address: booking.dropAddress,
        latitude: Number(booking.dropLatitude),
        longitude: Number(booking.dropLongitude),
      },
      distanceMeters:
        booking.trip.actualDistanceMeters ?? booking.distanceMeters,
      durationSeconds:
        booking.trip.actualDurationSeconds ?? booking.durationSeconds,
      encodedPolyline: booking.routePolyline,
    };
  }

  async getStops(userId: string, bookingId: string) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    const events = await prisma.auditLog.findMany({
      where: {
        entityType: "TRIP_STOP",
        entityId: `${booking.trip.id}:destination`,
        action: { in: ["TRIP_STOP_ARRIVED", "TRIP_STOP_COMPLETED"] },
      },
      orderBy: { createdAt: "asc" },
    });
    const arrived = events.find(
      (event) => event.action === "TRIP_STOP_ARRIVED",
    );
    const completed = events.find(
      (event) => event.action === "TRIP_STOP_COMPLETED",
    );
    return [
      {
        id: "destination",
        order: 1,
        kind: "DESTINATION",
        address: booking.dropAddress,
        latitude: Number(booking.dropLatitude),
        longitude: Number(booking.dropLongitude),
        arrivedAt: arrived?.createdAt ?? null,
        completedAt: completed?.createdAt ?? null,
        status: completed ? "COMPLETED" : arrived ? "ARRIVED" : "PENDING",
      },
    ];
  }

  async arriveAtStop(userId: string, bookingId: string, stopId: string) {
    return this.recordStopEvent(userId, bookingId, stopId, "TRIP_STOP_ARRIVED");
  }

  async completeStop(userId: string, bookingId: string, stopId: string) {
    return this.recordStopEvent(
      userId,
      bookingId,
      stopId,
      "TRIP_STOP_COMPLETED",
    );
  }

  async getLiveStatus(userId: string, bookingId: string) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    const location =
      (await this.locations.getByDriverId(booking.trip.driverId)) ??
      this.parseLocation(
        await redis.get(redisKeys.tripLastLocation(booking.trip.id)),
      );
    return {
      bookingId,
      tripId: booking.trip.id,
      bookingStatus: booking.status,
      tripStatus: booking.trip.status,
      driverLocation: location,
      startedAt: booking.trip.startedAt,
      elapsedSeconds: booking.trip.startedAt
        ? Math.max(
            0,
            Math.round(
              ((booking.trip.completedAt?.getTime() ?? Date.now()) -
                booking.trip.startedAt.getTime()) /
                1_000,
            ),
          )
        : 0,
      destination: {
        address: booking.dropAddress,
        latitude: Number(booking.dropLatitude),
        longitude: Number(booking.dropLongitude),
      },
    };
  }

  async customerNoShow(userId: string, bookingId: string, note?: string) {
    const { booking, driver } = await this.getActiveOwnedBooking(
      userId,
      bookingId,
    );
    if (
      booking.status !== BookingStatus.DRIVER_ARRIVED ||
      booking.trip?.status !== TripStatus.DRIVER_ARRIVED ||
      !booking.trip.arrivedAt
    ) {
      throw errors.conflict("Customer no-show can be reported after arrival");
    }
    if (Date.now() - booking.trip.arrivedAt.getTime() < 5 * 60_000) {
      throw errors.conflict("Minimum waiting period has not completed");
    }
    const location = await this.locations.getFreshByDriverId(
      driver.id,
    );
    if (
      distanceMeters(location, {
        latitude: Number(booking.pickupLatitude),
        longitude: Number(booking.pickupLongitude),
      }) > env.PICKUP_RADIUS_METERS
    ) {
      throw errors.conflict("Driver must remain near the pickup");
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const changed = await tx.booking.updateMany({
          where: {
            id: bookingId,
            assignedDriverId: driver.id,
            status: BookingStatus.DRIVER_ARRIVED,
          },
          data: {
            status: BookingStatus.CANCELLED,
            assignedDriverId: null,
            assignedVehicleId: null,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw errors.conflict("Booking state changed");
        await tx.trip.update({
          where: { id: booking.trip!.id },
          data: { status: TripStatus.CANCELLED },
        });
        await tx.bookingCancellation.create({
          data: {
            bookingId,
            cancelledByUserId: userId,
            reasonCode: "CUSTOMER_NO_SHOW",
            reason: note?.trim(),
            fee: 0,
          },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: BookingStatus.DRIVER_ARRIVED,
            toStatus: BookingStatus.CANCELLED,
            actorUserId: userId,
            reason: "CUSTOMER_NO_SHOW",
            metadata: { note: note?.trim() ?? null, location },
          },
        });
        await tx.tripStatusHistory.create({
          data: {
            tripId: booking.trip!.id,
            fromStatus: TripStatus.DRIVER_ARRIVED,
            toStatus: TripStatus.CANCELLED,
            actorUserId: userId,
          },
        });
        await tx.driverAssignment.updateMany({
          where: { bookingId, driverId: driver.id, status: "ACTIVE" },
          data: {
            status: "CANCELLED",
            releasedAt: new Date(),
            releaseReason: "CUSTOMER_NO_SHOW",
          },
        });
        await tx.driverProfile.update({
          where: { id: driver.id },
          data: { availability: "ONLINE" },
        });
        if (booking.trip?.vehicleId) {
          await tx.vehicle.update({
            where: { id: booking.trip.vehicleId },
            data: { isAvailable: true },
          });
        }
        return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.availability.restoreAvailable(driver.id);
    return result;
  }

  async raiseSos(
    userId: string,
    bookingId: string,
    input: {
      latitude: number;
      longitude: number;
      message?: string;
    },
  ) {
    const { booking, driver } = await this.getActiveOwnedBooking(
      userId,
      bookingId,
    );
    if (!booking.trip) throw errors.notFound("Trip not found");
    return this.safety.raiseSos(driver.id, {
      tripId: booking.trip.id,
      ...input,
    });
  }

  async reportSafetyIssue(
    userId: string,
    bookingId: string,
    type: SafetyType,
    description: string,
  ) {
    await this.getOwnedBooking(userId, bookingId);
    return prisma.safetyIncident.create({
      data: {
        bookingId,
        reportedByUserId: userId,
        type,
        description,
        status: "OPEN",
      },
    });
  }

  async completeTrip(userId: string, bookingId: string) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    return this.trips.complete(booking.trip.id, userId, {});
  }

  async confirmCashPayment(
    userId: string,
    bookingId: string,
    idempotencyKey: string,
  ) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    const payment = await this.payments.create(
      userId,
      ["DRIVER"],
      idempotencyKey,
      { bookingId, method: PaymentMethod.CASH },
    );
    if (payment.status === "CAPTURED") {
      await prisma.driverEarning.updateMany({
        where: { tripId: booking.trip.id, cashCollected: 0 },
        data: {
          cashCollected: payment.amountPaid,
          status: "CASH_COLLECTED",
        },
      });
    }
    return payment;
  }

  async getPaymentStatus(userId: string, bookingId: string) {
    await this.getOwnedBooking(userId, bookingId);
    const payment = await prisma.payment.findFirst({
      where: { bookingId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        method: true,
        status: true,
        amount: true,
        amountPaid: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, type: true, createdAt: true },
        },
      },
    });
    return {
      bookingId,
      status: payment?.status ?? "PENDING",
      payment,
    };
  }

  async rateCustomer(
    userId: string,
    bookingId: string,
    rating: number,
    comment?: string,
  ) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    return this.history.rateCustomer(
      booking.trip.driverId,
      booking.trip.id,
      rating,
      comment,
    );
  }

  async getCustomerRating(userId: string, bookingId: string) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip) throw errors.notFound("Trip not found");
    return prisma.rating.findFirst({
      where: {
        tripId: booking.trip.id,
        authorUserId: userId,
        subjectType: "CUSTOMER",
      },
      include: { review: true },
    });
  }

  private async recordStopEvent(
    userId: string,
    bookingId: string,
    stopId: string,
    action: "TRIP_STOP_ARRIVED" | "TRIP_STOP_COMPLETED",
  ) {
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!booking.trip || booking.trip.status !== TripStatus.STARTED) {
      throw errors.conflict("Trip is not active");
    }
    if (stopId !== "destination") {
      throw errors.notFound("Trip stop not found");
    }
    const entityId = `${booking.trip.id}:${stopId}`;
    const existing = await prisma.auditLog.findFirst({
      where: { entityType: "TRIP_STOP", entityId, action },
    });
    if (existing) return existing;
    if (action === "TRIP_STOP_COMPLETED") {
      const arrived = await prisma.auditLog.findFirst({
        where: {
          entityType: "TRIP_STOP",
          entityId,
          action: "TRIP_STOP_ARRIVED",
        },
      });
      if (!arrived) throw errors.conflict("Stop must be reached first");
    }
    const location = await this.locations.getFreshByDriverId(
      booking.trip.driverId,
    );
    return prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorRole: "DRIVER",
        action,
        entityType: "TRIP_STOP",
        entityId,
        metadata: { bookingId, tripId: booking.trip.id, stopId, location },
      },
    });
  }

  private async getDriver(userId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true, userId: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    return driver;
  }

  private async getActiveOwnedBooking(userId: string, bookingId: string) {
    const driver = await this.getDriver(userId);
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        OR: [
          { assignedDriverId: driver.id },
          { trip: { driverId: driver.id } },
        ],
        status: { in: activeStatuses },
      },
      include: this.bookingInclude(),
    });
    if (!booking) throw errors.notFound("Active booking not found");
    return { booking, driver };
  }

  private async getOwnedBooking(userId: string, bookingId: string) {
    const driver = await this.getDriver(userId);
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        OR: [
          { assignedDriverId: driver.id },
          { trip: { driverId: driver.id } },
        ],
      },
      include: this.bookingInclude(),
    });
    if (!booking) throw errors.notFound("Booking not found");
    return booking;
  }

  private bookingInclude() {
    return {
      customer: {
        include: {
          user: {
            select: { id: true, displayName: true, phone: true },
          },
        },
      },
      vehicleCategory: {
        select: { id: true, name: true, slug: true },
      },
      assignedVehicle: true,
      trip: {
        include: {
          driverEarning: true,
          ratings: { include: { review: true } },
        },
      },
      payments: {
        orderBy: { createdAt: "desc" as const },
      },
      cancellation: true,
    };
  }

  private toDriverBooking(
    booking: Awaited<
      ReturnType<DriverBookingJourneyService["getOwnedBooking"]>
    >,
  ) {
    const latestPayment = booking.payments[0] ?? null;
    return {
      ...booking,
      payment: latestPayment,
      latestPayment,
      paymentMethod: latestPayment?.method ?? null,
      paymentStatus: latestPayment?.status ?? null,
      customer: {
        id: booking.customer.id,
        displayName: booking.customer.user.displayName,
        maskedPhone: this.maskPhone(booking.customer.user.phone),
      },
    };
  }

  private maskPhone(phone: string) {
    if (phone.length <= 4) return "*".repeat(phone.length);
    return `${phone.slice(0, 2)}${"*".repeat(phone.length - 4)}${phone.slice(-2)}`;
  }

  private parseLocation(raw: string | null) {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
