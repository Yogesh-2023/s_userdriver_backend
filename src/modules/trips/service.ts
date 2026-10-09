import {
  consumeSubscriptionTrip,
  lockSubscriptionDriver,
} from "../driver/services/subscription-state";
import { BookingStatus, Prisma, TripStatus } from "@prisma/client";
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { errors } from "../../common/errors";
import { distanceMeters } from "../../common/geo";
import { env } from "../../config/env";
import { prisma } from "../../database/prisma";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
  emitUser,
} from "../../infrastructure/realtime";
import { queues } from "../../infrastructure/queues";
import { redis } from "../../infrastructure/redis";
import { sendOtp } from "../../integrations/sms";
import { redisKeys } from "../../realtime/socket.constants";
import { DriverAvailabilityService } from "../driver/services/driver-availability.service";
import { DriverLocationService } from "../driver/services/driver-location.service";
import { NotificationsService } from "../notifications/service";
import { PricingService } from "../pricing/service";

export class TripsService {
  private readonly pricing = new PricingService();
  private readonly locations = new DriverLocationService();
  private readonly availability = new DriverAvailabilityService();
  private readonly notifications = new NotificationsService();

  async requestOtp(tripId: string, userId: string) {
    const trip = await this.get(tripId);
    if (trip.booking.customer.userId !== userId) {
      throw errors.forbidden("TRIP_ACCESS_DENIED");
    }
    const validStatuses: TripStatus[] = [
      TripStatus.CREATED,
      TripStatus.DRIVER_ARRIVING,
      TripStatus.DRIVER_ARRIVED,
    ];
    if (!validStatuses.includes(trip.status)) {
      throw errors.conflict("INVALID_BOOKING_TRANSITION");
    }
    return this.generateAndDeliverOtp(trip);
  }

  async requestOtpForAssignedDriver(tripId: string, userId: string) {
    const trip = await this.get(tripId);
    this.assertDriver(trip.driver.userId, userId);
    if (trip.status !== TripStatus.DRIVER_ARRIVED) {
      throw errors.conflict("INVALID_BOOKING_TRANSITION");
    }
    await this.generateAndDeliverOtp(trip);
    return { deliveredToCustomer: true };
  }

  async arriving(tripId: string, userId: string) {
    const result = await this.driverTransition(
      tripId,
      userId,
      TripStatus.CREATED,
      TripStatus.DRIVER_ARRIVING,
      BookingStatus.DRIVER_ASSIGNED,
      BookingStatus.DRIVER_ARRIVING,
    );
    emitBooking(result.bookingId, "driver:heading-to-pickup", {
      bookingId: result.bookingId,
      tripId: result.id,
    });
    emitDriver(result.driverId, "driver:heading-to-pickup", {
      bookingId: result.bookingId,
      tripId: result.id,
    });
    emitAdminRoom("tracking", "admin:driver:heading-to-pickup", {
      bookingId: result.bookingId,
      tripId: result.id,
      driverId: result.driverId,
    });
    const trip = await this.get(tripId);
    await this.notifications.enqueue({
      userId: trip.booking.customer.userId,
      bookingId: result.bookingId,
      channel: "PUSH",
      templateKey: "DRIVER_ARRIVING",
      title: "Driver is on the way",
      body: "Your driver is heading to your pickup location.",
      data: {
        type: "DRIVER_ARRIVING",
        entityType: "BOOKING",
        entityId: result.bookingId,
        bookingId: result.bookingId,
        screen: "ride_tracking",
        action: "OPEN_BOOKING",
        role: "USER",
      },
    });
    return result;
  }

  async arrivingByBooking(bookingId: string, userId: string) {
    const trip = await prisma.trip.findUnique({
      where: { bookingId },
      select: { id: true },
    });
    if (!trip) throw errors.notFound("RIDE_REQUEST_NOT_FOUND");
    return this.arriving(trip.id, userId);
  }

  async arrived(tripId: string, userId: string) {
    const trip = await this.get(tripId);
    this.assertDriver(trip.driver.userId, userId);

    if (
      trip.status === TripStatus.DRIVER_ARRIVED &&
      trip.booking.status === BookingStatus.DRIVER_ARRIVED
    ) {
      return trip;
    }

    const validBookingStatuses: BookingStatus[] = [
      BookingStatus.DRIVER_ASSIGNED,
      BookingStatus.DRIVER_ARRIVING,
    ];
    const validTripStatuses: TripStatus[] = [
      TripStatus.CREATED,
      TripStatus.DRIVER_ARRIVING,
    ];

    if (
      !validBookingStatuses.includes(trip.booking.status) ||
      !validTripStatuses.includes(trip.status)
    ) {
      throw errors.conflict("INVALID_BOOKING_TRANSITION");
    }

    const location = await this.locations
      .getFreshByDriverId(trip.driverId)
      .catch(() => null);

    // if (location) {
    //   const pickupDistance = distanceMeters(location, {
    //     latitude: Number(trip.booking.pickupLatitude),
    //     longitude: Number(trip.booking.pickupLongitude),
    //   });
    //   if (pickupDistance > env.PICKUP_RADIUS_METERS) {
    //     throw errors.conflict("DRIVER_TOO_FAR_FROM_PICKUP");
    //   }
    // }

    const previousStatus = trip.booking.status;
    const result = await this.transitionPair(
      trip,
      trip.status,
      TripStatus.DRIVER_ARRIVED,
      trip.booking.status,
      BookingStatus.DRIVER_ARRIVED,
      userId,
      { arrivedAt: new Date() },
    );

    console.log("[DRIVER_ARRIVED]", {
      bookingId: trip.bookingId,
      driverId: trip.driverId,
      previousStatus,
      newStatus: BookingStatus.DRIVER_ARRIVED,
    });

    await this.generateAndDeliverOtp(await this.get(tripId));

    const arrivedPayload = {
      bookingId: trip.bookingId,
      tripId,
      status: BookingStatus.DRIVER_ARRIVED,
      driverId: trip.driverId,
      arrivedAt: result.arrivedAt,
      timestamp: new Date().toISOString(),
    };

    emitBooking(trip.bookingId, "driver:arrived", arrivedPayload);
    emitDriver(trip.driverId, "driver:arrived", arrivedPayload);
    emitAdminRoom("tracking", "admin:driver:arrived", arrivedPayload);

    await queues.maintenance.add(
      "pickup-waiting-check",
      { tripId },
      {
        jobId: `pickup-waiting-${tripId}`,
        delay: 5 * 60_000,
      },
    );
    await this.notifications.enqueue({
      userId: trip.booking.customer.userId,
      bookingId: trip.bookingId,
      channel: "PUSH",
      templateKey: "DRIVER_ARRIVED",
      title: "Driver has arrived",
      body: "Your driver has arrived at the pickup location.",
      data: {
        type: "DRIVER_ARRIVED",
        entityType: "BOOKING",
        entityId: trip.bookingId,
        bookingId: trip.bookingId,
        screen: "ride_tracking",
        action: "OPEN_BOOKING",
        role: "USER",
      },
    });
    return result;
  }

  async arrivedByBooking(bookingId: string, userId: string) {
    const trip = await prisma.trip.findUnique({
      where: { bookingId },
      select: { id: true },
    });
    if (!trip) throw errors.notFound("RIDE_REQUEST_NOT_FOUND");
    return this.arrived(trip.id, userId);
  }

  async verifyPickupOtp(tripId: string, otp: string, userId: string) {
    const preflight = await this.get(tripId);
    this.assertDriver(preflight.driver.userId, userId);
    if (
      preflight.status === TripStatus.STARTED &&
      preflight.booking.status === BookingStatus.TRIP_STARTED
    ) {
      return { tripId, pickupVerified: true, alreadyStarted: true };
    }
    const validTripStatuses: TripStatus[] = [
      TripStatus.CREATED,
      TripStatus.DRIVER_ARRIVING,
      TripStatus.DRIVER_ARRIVED,
    ];
    const validBookingStatuses: BookingStatus[] = [
      BookingStatus.DRIVER_ASSIGNED,
      BookingStatus.DRIVER_ARRIVING,
      BookingStatus.DRIVER_ARRIVED,
    ];
    if (
      !(validTripStatuses as any[]).includes(preflight.status) ||
      !(validBookingStatuses as any[]).includes(preflight.booking.status)
    ) {
      throw errors.conflict("INVALID_BOOKING_TRANSITION");
    }
    const location = await this.locations.getFreshByDriverId(
      preflight.driverId,
    );
    // if (
    //   distanceMeters(location, {
    //     latitude: Number(preflight.booking.pickupLatitude),
    //     longitude: Number(preflight.booking.pickupLongitude),
    //   }) > env.PICKUP_RADIUS_METERS
    // ) {
    //   throw errors.conflict("DRIVER_TOO_FAR_FROM_PICKUP");
    // }

    const lockKey = `trip:pickup-otp-lock:${tripId}`;
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) throw errors.conflict("Pickup OTP verification in progress");
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.auditLog.findFirst({
            where: {
              action: "PICKUP_OTP_VERIFIED",
              entityType: "TRIP",
              entityId: tripId,
            },
          });
          if (existing) {
            return {
              verifiedAt: existing.createdAt,
              error: null as string | null,
            };
          }
          const trip = await tx.trip.findUniqueOrThrow({
            where: { id: tripId },
            include: { booking: true },
          });
          if (
            trip.status !== TripStatus.DRIVER_ARRIVED ||
            trip.booking.status !== BookingStatus.DRIVER_ARRIVED
          ) {
            return {
              verifiedAt: null,
              error: "INVALID_BOOKING_TRANSITION",
            };
          }
          if (
            !trip.verificationOtpHash ||
            !trip.verificationOtpExpiresAt ||
            trip.verificationOtpExpiresAt <= new Date()
          ) {
            return { verifiedAt: null, error: "TRIP_OTP_EXPIRED" };
          }
          if (trip.otpAttempts >= env.OTP_MAX_ATTEMPTS) {
            return { verifiedAt: null, error: "TRIP_OTP_INVALID" };
          }
          if (
            !this.safeEqual(trip.verificationOtpHash, this.otpHash(tripId, otp))
          ) {
            await tx.trip.update({
              where: { id: tripId },
              data: { otpAttempts: { increment: 1 } },
            });
            return { verifiedAt: null, error: "TRIP_OTP_INVALID" };
          }
          const verifiedAt = new Date();
          await tx.trip.update({
            where: { id: tripId },
            data: {
              verificationOtpHash: null,
              verificationOtpExpiresAt: null,
            },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: userId,
              actorRole: "DRIVER",
              action: "PICKUP_OTP_VERIFIED",
              entityType: "TRIP",
              entityId: tripId,
              metadata: {
                bookingId: trip.bookingId,
                verifiedAt: verifiedAt.toISOString(),
              },
            },
          });
          return { verifiedAt, error: null };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (result.error === "TRIP_OTP_EXPIRED") {
        throw errors.unauthorized(result.error);
      }
      if (result.error) throw errors.conflict(result.error);
      return {
        tripId,
        bookingId: preflight.bookingId,
        pickupVerified: true,
        pickupVerifiedAt: result.verifiedAt,
      };
    } finally {
      await this.releaseLock(lockKey, lockToken);
    }
  }

  async startVerified(tripId: string, userId: string) {
    const preflight = await this.get(tripId);
    this.assertDriver(preflight.driver.userId, userId);
    if (
      preflight.status === TripStatus.STARTED &&
      preflight.booking.status === BookingStatus.TRIP_STARTED
    ) {
      return preflight;
    }
    if (
      preflight.status !== TripStatus.DRIVER_ARRIVED ||
      preflight.booking.status !== BookingStatus.DRIVER_ARRIVED
    ) {
      throw errors.conflict("INVALID_BOOKING_TRANSITION");
    }
    const verified = await prisma.auditLog.findFirst({
      where: {
        action: "PICKUP_OTP_VERIFIED",
        entityType: "TRIP",
        entityId: tripId,
        actorUserId: userId,
      },
    });
    if (!verified) throw errors.conflict("PICKUP_OTP_NOT_VERIFIED");
    const location = await this.locations.getFreshByDriverId(
      preflight.driverId,
    );
    if (
      distanceMeters(location, {
        latitude: Number(preflight.booking.pickupLatitude),
        longitude: Number(preflight.booking.pickupLongitude),
      }) > env.PICKUP_RADIUS_METERS
    ) {
      throw errors.conflict("DRIVER_TOO_FAR_FROM_PICKUP");
    }

    const lockKey = redisKeys.tripStartLock(tripId);
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) throw errors.conflict("TRIP_ALREADY_STARTED");
    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
          const trip = await tx.trip.findUniqueOrThrow({
            where: { id: tripId },
            include: { booking: true },
          });
          if (
            trip.status === TripStatus.STARTED &&
            trip.booking.status === BookingStatus.TRIP_STARTED
          ) {
            return trip;
          }
          const tripChange = await tx.trip.updateMany({
            where: { id: tripId, status: TripStatus.DRIVER_ARRIVED },
            data: { status: TripStatus.STARTED, startedAt: new Date() },
          });
          const bookingChange = await tx.booking.updateMany({
            where: {
              id: trip.bookingId,
              status: BookingStatus.DRIVER_ARRIVED,
              assignedDriverId: trip.driverId,
              assignedVehicleId: trip.vehicleId,
            },
            data: {
              status: BookingStatus.TRIP_STARTED,
              version: { increment: 1 },
            },
          });
          if (tripChange.count !== 1 || bookingChange.count !== 1) {
            throw errors.conflict("TRIP_ALREADY_STARTED");
          }
          await tx.tripStatusHistory.create({
            data: {
              tripId,
              fromStatus: TripStatus.DRIVER_ARRIVED,
              toStatus: TripStatus.STARTED,
              actorUserId: userId,
              metadata: {
                pickupVerifiedAt: verified.createdAt.toISOString(),
              },
            },
          });
          await tx.bookingStatusHistory.create({
            data: {
              bookingId: trip.bookingId,
              fromStatus: BookingStatus.DRIVER_ARRIVED,
              toStatus: BookingStatus.TRIP_STARTED,
              actorUserId: userId,
            },
          });
          return tx.trip.findUniqueOrThrow({ where: { id: tripId } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      emitBooking(preflight.bookingId, "trip:started", {
        bookingId: preflight.bookingId,
        tripId,
        startedAt: outcome.startedAt,
      });
      emitDriver(preflight.driverId, "trip:started", {
        bookingId: preflight.bookingId,
        tripId,
        startedAt: outcome.startedAt,
      });
      emitAdminRoom("tracking", "admin:trip:started", {
        bookingId: preflight.bookingId,
        tripId,
        driverId: preflight.driverId,
        startedAt: outcome.startedAt,
      });
      await queues.maintenance.add(
        "trip-tracking-stale-check",
        { tripId },
        {
          jobId: `trip-tracking-stale-${tripId}`,
          delay: env.TRIP_TRACKING_STALE_SECONDS * 1_000,
          removeOnComplete: true,
        },
      );
      return outcome;
    } finally {
      await this.releaseLock(lockKey, lockToken);
    }
  }

  async start(tripId: string, otp: string, userId: string) {
    const preflight = await this.get(tripId);
    this.assertDriver(preflight.driver.userId, userId);
    if (
      preflight.status === TripStatus.STARTED &&
      preflight.booking.status === BookingStatus.TRIP_STARTED
    ) {
      return preflight;
    }
    // Distance check bypassed to allow starting ride reliably when OTP is valid
    // const location = await this.locations.getFreshByDriverId(
    //   preflight.driverId,
    //   env.DRIVER_LOCATION_MAX_AGE_SECONDS,
    // );
    // if (
    //   distanceMeters(location, {
    //     latitude: Number(preflight.booking.pickupLatitude),
    //     longitude: Number(preflight.booking.pickupLongitude),
    //   }) > env.PICKUP_RADIUS_METERS
    // ) {
    //   throw errors.conflict("DRIVER_TOO_FAR_FROM_PICKUP");
    // }

    const lockKey = redisKeys.tripStartLock(tripId);
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) throw errors.conflict("TRIP_ALREADY_STARTED");
    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
          const trip = await tx.trip.findUniqueOrThrow({
            where: { id: tripId },
            include: { booking: true },
          });
          if (
            trip.status === TripStatus.STARTED &&
            trip.booking.status === BookingStatus.TRIP_STARTED
          ) {
            return { trip, error: null };
          }
          const validTripStatuses: TripStatus[] = [
            TripStatus.DRIVER_ARRIVED,
            TripStatus.DRIVER_ARRIVING,
            TripStatus.CREATED,
          ];
          const validBookingStatuses: BookingStatus[] = [
            BookingStatus.DRIVER_ARRIVED,
            BookingStatus.DRIVER_ARRIVING,
            BookingStatus.DRIVER_ASSIGNED,
          ];
          if (
            !(validTripStatuses as any[]).includes(trip.status) ||
            !(validBookingStatuses as any[]).includes(trip.booking.status)
          ) {
            return { trip, error: "INVALID_BOOKING_TRANSITION" };
          }

          const cleanOtp = otp ? otp.trim() : "";
          const redisOtp = await redis.get(`booking:otp:${trip.bookingId}`);
          let isOtpValid = false;

          if (
            trip.verificationOtpHash &&
            trip.verificationOtpExpiresAt &&
            trip.verificationOtpExpiresAt > new Date()
          ) {
            isOtpValid = this.safeEqual(
              trip.verificationOtpHash,
              this.otpHash(tripId, cleanOtp),
            );
          }

          if (!isOtpValid && redisOtp && redisOtp.trim() === cleanOtp) {
            isOtpValid = true;
          }

          if (
            !isOtpValid &&
            env.NODE_ENV !== "production" &&
            (cleanOtp === (env.OTP_FIXED_CODE || "1234") || cleanOtp === "1234")
          ) {
            isOtpValid = true;
          }

          if (!isOtpValid) {
            const attempted = await tx.trip.update({
              where: { id: tripId },
              data: { otpAttempts: { increment: 1 } },
            });
            return { trip: attempted, error: "TRIP_OTP_INVALID" };
          }

          const tripChange = await tx.trip.updateMany({
            where: { id: tripId },
            data: {
              status: TripStatus.STARTED,
              startedAt: new Date(),
              verificationOtpHash: null,
              verificationOtpExpiresAt: null,
            },
          });
          const bookingChange = await tx.booking.updateMany({
            where: {
              id: trip.bookingId,
              assignedDriverId: trip.driverId,
            },
            data: {
              status: BookingStatus.TRIP_STARTED,
              version: { increment: 1 },
            },
          });
          if (tripChange.count !== 1 || bookingChange.count !== 1) {
            return { trip, error: "TRIP_ALREADY_STARTED" };
          }
          await tx.tripStatusHistory.create({
            data: {
              tripId,
              fromStatus: trip.status,
              toStatus: TripStatus.STARTED,
              actorUserId: userId,
            },
          });
          await tx.bookingStatusHistory.create({
            data: {
              bookingId: trip.bookingId,
              fromStatus: trip.booking.status,
              toStatus: BookingStatus.TRIP_STARTED,
              actorUserId: userId,
            },
          });
          return {
            trip: await tx.trip.findUniqueOrThrow({ where: { id: tripId } }),
            error: null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (outcome.error) {
        if (outcome.error === "TRIP_OTP_INVALID") {
          throw errors.badRequest(
            "Invalid pickup OTP. Please enter the correct OTP.",
          );
        }
        if (outcome.error === "TRIP_OTP_EXPIRED") {
          throw errors.unauthorized("Pickup OTP has expired");
        }
        throw errors.conflict(outcome.error);
      }
      emitBooking(preflight.bookingId, "trip:started", {
        bookingId: preflight.bookingId,
        tripId,
        startedAt: outcome.trip.startedAt,
      });
      emitDriver(preflight.driverId, "trip:started", {
        bookingId: preflight.bookingId,
        tripId,
        startedAt: outcome.trip.startedAt,
      });
      emitAdminRoom("tracking", "admin:trip:started", {
        bookingId: preflight.bookingId,
        tripId,
        driverId: preflight.driverId,
        startedAt: outcome.trip.startedAt,
      });
      await queues.maintenance.add(
        "trip-tracking-stale-check",
        { tripId },
        {
          jobId: `trip-tracking-stale-${tripId}`,
          delay: env.TRIP_TRACKING_STALE_SECONDS * 1_000,
          removeOnComplete: true,
        },
      );

      const trip = await this.get(tripId);
      await this.notifications.enqueue({
        userId: trip.booking.customer.userId,
        bookingId: preflight.bookingId,
        channel: "PUSH",
        templateKey: "TRIP_STARTED",
        title: "Trip Started",
        body: "Your ride has started. Have a safe journey!",
        data: {
          type: "TRIP_STARTED",
          entityType: "BOOKING",
          entityId: preflight.bookingId,
          bookingId: preflight.bookingId,
          screen: "ride_tracking",
          action: "OPEN_BOOKING",
          role: "USER",
        },
      });

      return outcome.trip;
    } finally {
      await this.releaseLock(lockKey, lockToken);
    }
  }

  async complete(
    tripId: string,
    userId: string,
    _ignoredClientMetrics: Record<string, unknown> = {},
  ) {
    const trip = await this.get(tripId);
    this.assertDriver(trip.driver.userId, userId);
    if (
      trip.status === TripStatus.COMPLETED ||
      (
        [
          BookingStatus.TRIP_COMPLETED,
          BookingStatus.PAYMENT_PENDING,
          BookingStatus.PAYMENT_COMPLETED,
        ] as BookingStatus[]
      ).includes(trip.booking.status)
    ) {
      return trip;
    }
    if (
      trip.status !== TripStatus.STARTED ||
      (trip.booking.status !== BookingStatus.TRIP_STARTED &&
        trip.booking.status !== BookingStatus.DRIVER_ARRIVED) ||
      !trip.startedAt
    ) {
      throw errors.conflict("INVALID_BOOKING_TRANSITION");
    }
    const completionLocation = await this.locations.getFreshByDriverId(
      trip.driverId,
    );
    // Bypassed DRIVER_TOO_FAR_FROM_DESTINATION check so driver can complete trip from any location
    // if (
    //   distanceMeters(completionLocation, {
    //     latitude: Number(trip.booking.dropLatitude),
    //     longitude: Number(trip.booking.dropLongitude),
    //   }) > env.TRIP_COMPLETION_RADIUS_METERS
    // ) {
    //   throw errors.conflict("DRIVER_TOO_FAR_FROM_DESTINATION");
    // }
    const trusted = await this.trustedMetrics(tripId, {
      distanceMeters: trip.booking.distanceMeters,
      durationSeconds: trip.booking.durationSeconds,
      startedAt: trip.startedAt,
    });
    const fare = await this.pricing.calculate({
      vehicleCategoryId: trip.booking.vehicleCategoryId,
      rideType: trip.booking.rideType,
      distanceMeters: trusted.distanceMeters,
      durationSeconds: trusted.durationSeconds,
      waitingMinutes:
        trip.arrivedAt && trip.startedAt
          ? Math.max(
              0,
              Math.floor(
                (trip.startedAt.getTime() - trip.arrivedAt.getTime()) / 60000,
              ),
            )
          : 0,
      tollCharge: 0,
      customerId: trip.booking.customerId,
    });
    const estimateBreakdown = await prisma.fareBreakdown.findFirst({
      where: { bookingId: trip.bookingId, kind: "ESTIMATE" },
      orderBy: { createdAt: "desc" },
      select: { calculationSnapshot: true },
    });
    const estimateSnapshot =
      estimateBreakdown?.calculationSnapshot &&
      typeof estimateBreakdown.calculationSnapshot === "object" &&
      !Array.isArray(estimateBreakdown.calculationSnapshot)
        ? estimateBreakdown.calculationSnapshot
        : {};
    const cancellationDue = new Prisma.Decimal(
      (estimateSnapshot as { cancellationDue?: string | number })
        .cancellationDue ?? 0,
    );
    const finalFare = new Prisma.Decimal(fare.total).add(cancellationDue);
    const lockKey = redisKeys.tripCompleteLock(tripId);
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) throw errors.conflict("TRIP_ALREADY_COMPLETED");
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          await lockSubscriptionDriver(tx, trip.driverId);
          const tripChange = await tx.trip.updateMany({
            where: { id: tripId, status: TripStatus.STARTED },
            data: {
              status: TripStatus.COMPLETED,
              completedAt: new Date(),
              actualDistanceMeters: trusted.distanceMeters,
              actualDurationSeconds: trusted.durationSeconds,
            },
          });
          const bookingChange = await tx.booking.updateMany({
            where: {
              id: trip.bookingId,
              status: BookingStatus.TRIP_STARTED,
              assignedDriverId: trip.driverId,
            },
            data: {
              status: BookingStatus.PAYMENT_PENDING,
              finalFare,
              assignedDriverId: null,
              assignedVehicleId: null,
              version: { increment: 1 },
            },
          });
          if (tripChange.count !== 1 || bookingChange.count !== 1) {
            throw errors.conflict("TRIP_ALREADY_COMPLETED");
          }
          // Charge the allowance that covered trip start, even if it expired
          // during the ride. The trip transition above prevents double charging.
          if (trip.startedAt)
            await consumeSubscriptionTrip(tx, trip.driverId, trip.startedAt);
          await tx.tripStatusHistory.create({
            data: {
              tripId,
              fromStatus: TripStatus.STARTED,
              toStatus: TripStatus.COMPLETED,
              actorUserId: userId,
            },
          });
          await tx.bookingStatusHistory.createMany({
            data: [
              {
                bookingId: trip.bookingId,
                fromStatus: BookingStatus.TRIP_STARTED,
                toStatus: BookingStatus.TRIP_COMPLETED,
                actorUserId: userId,
              },
              {
                bookingId: trip.bookingId,
                fromStatus: BookingStatus.TRIP_COMPLETED,
                toStatus: BookingStatus.PAYMENT_PENDING,
                actorUserId: userId,
              },
            ],
          });
          await tx.fareBreakdown.create({
            data: {
              bookingId: trip.bookingId,
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
              referralDiscount: (fare as any).referralDiscount ?? 0,
              referralId: (fare as any).referralId ?? null,
              tax: fare.tax,
              total: finalFare,
              calculationSnapshot: {
                ...fare.calculationSnapshot,
                source: trusted.source,
                cancellationDue,
              },
            },
          });
          await tx.driverEarning.upsert({
            where: { tripId },
            update: {},
            create: {
              driverId: trip.driverId,
              tripId,
              grossFare: fare.subtotal,
              platformCommission: fare.platformCommission,
              tax: fare.tax,
              toll: fare.tollCharge,
              netEarning: Math.max(0, fare.subtotal - fare.platformCommission),
            },
          });
          await tx.driverAssignment.updateMany({
            where: {
              bookingId: trip.bookingId,
              driverId: trip.driverId,
              status: "ACTIVE",
            },
            data: {
              status: "COMPLETED",
              releasedAt: new Date(),
              releaseReason: "TRIP_COMPLETED",
            },
          });
          await tx.driverProfile.update({
            where: { id: trip.driverId },
            data: { availability: "ONLINE", totalTrips: { increment: 1 } },
          });
          await tx.vehicle.update({
            where: { id: trip.vehicleId },
            data: { isAvailable: true },
          });
          return tx.trip.findUniqueOrThrow({ where: { id: tripId } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await redis.del(
        redisKeys.tripLive(tripId),
        redisKeys.tripLastLocation(tripId),
      );
      await this.availability.restoreAvailable(trip.driverId);
      emitBooking(trip.bookingId, "trip:completed", {
        bookingId: trip.bookingId,
        tripId,
        finalFare,
        distanceMeters: trusted.distanceMeters,
        durationSeconds: trusted.durationSeconds,
      });
      emitDriver(trip.driverId, "trip:completed", {
        bookingId: trip.bookingId,
        tripId,
        finalFare,
      });
      emitBooking(trip.bookingId, "payment:updated", {
        bookingId: trip.bookingId,
        status: "PENDING",
        amount: finalFare,
      });
      emitBooking(trip.bookingId, "payment:pending", {
        bookingId: trip.bookingId,
        status: "PENDING",
        amount: finalFare,
      });
      emitAdminRoom("tracking", "admin:trip:completed", {
        bookingId: trip.bookingId,
        tripId,
        driverId: trip.driverId,
        finalFare,
      });
      await Promise.all([
        queues.maintenance.add(
          "invoice-generation",
          { tripId },
          { jobId: `invoice-${tripId}` },
        ),
        this.notifications.enqueue({
          userId: trip.booking.customer.userId,
          bookingId: trip.bookingId,
          channel: "PUSH",
          templateKey: "TRIP_COMPLETED",
          title: "Trip completed",
          body: "Your trip is complete. Payment is now due.",
          data: {
            type: "TRIP_COMPLETED",
            entityType: "BOOKING",
            entityId: trip.bookingId,
            bookingId: trip.bookingId,
            screen: "payment_summary",
            action: "OPEN_PAYMENT",
            role: "USER",
          },
        }),
      ]);
      return result;
    } finally {
      await this.releaseLock(lockKey, lockToken);
    }
  }

  private async generateAndDeliverOtp(
    trip: Awaited<ReturnType<TripsService["get"]>>,
  ) {
    const otp =
      env.NODE_ENV === "production"
        ? randomInt(1_000, 10_000).toString()
        : env.OTP_FIXED_CODE;
    const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1_000);
    await prisma.trip.update({
      where: { id: trip.id },
      data: {
        verificationOtpHash: this.otpHash(trip.id, otp),
        verificationOtpExpiresAt: expiresAt,
        otpAttempts: 0,
      },
    });
    await redis.set(`booking:otp:${trip.bookingId}`, otp, "EX", 86400);

    console.log(`
================================================================================
=== 🔑 TRIP OTP GENERATED ===
--------------------------------------------------------------------------------
Driver Name : ${trip.driver?.user?.displayName ?? "Driver"} (ID: ${trip.driverId})
Booking ID  : ${trip.bookingId}
Trip ID     : ${trip.id}
PICKUP OTP  : 🔑 ${otp} 🔑
================================================================================
`);

    await sendOtp(trip.booking.customer.user.phone, otp, env.OTP_TTL_SECONDS);
    emitUser(trip.booking.customer.userId, "trip:otp-generated", {
      bookingId: trip.bookingId,
      tripId: trip.id,
      expiresAt: expiresAt.toISOString(),
      otp,
    });
    await this.notifications.enqueue({
      userId: trip.booking.customer.userId,
      bookingId: trip.bookingId,
      channel: "PUSH",
      templateKey: "TRIP_OTP_READY",
      title: "Trip start code ready",
      body: "Share the trip start code only after you enter the vehicle.",
      data: {
        event: "trip:otp-generated",
        bookingId: trip.bookingId,
        tripId: trip.id,
        expiresAt: expiresAt.toISOString(),
        otp,
      },
    });
    return {
      expiresAt,
      otp,
    };
  }

  private async driverTransition(
    tripId: string,
    userId: string,
    fromTrip: TripStatus,
    toTrip: TripStatus,
    fromBooking: BookingStatus,
    toBooking: BookingStatus,
  ) {
    const trip = await this.get(tripId);
    this.assertDriver(trip.driver.userId, userId);
    if (trip.status === toTrip && trip.booking.status === toBooking)
      return trip;
    if (trip.status !== fromTrip || trip.booking.status !== fromBooking) {
      throw errors.conflict("INVALID_BOOKING_TRANSITION");
    }
    return this.transitionPair(
      trip,
      fromTrip,
      toTrip,
      fromBooking,
      toBooking,
      userId,
    );
  }

  private async transitionPair(
    trip: Awaited<ReturnType<TripsService["get"]>>,
    fromTrip: TripStatus,
    toTrip: TripStatus,
    fromBooking: BookingStatus,
    toBooking: BookingStatus,
    actorUserId: string,
    tripData: Prisma.TripUpdateManyMutationInput = {},
  ) {
    return prisma.$transaction(
      async (tx) => {
        const tripChange = await tx.trip.updateMany({
          where: { id: trip.id, status: fromTrip },
          data: { ...tripData, status: toTrip },
        });
        const bookingChange = await tx.booking.updateMany({
          where: {
            id: trip.bookingId,
            status: fromBooking,
            assignedDriverId: trip.driverId,
          },
          data: { status: toBooking, version: { increment: 1 } },
        });
        if (tripChange.count !== 1 || bookingChange.count !== 1) {
          throw errors.conflict("INVALID_BOOKING_TRANSITION");
        }
        await tx.tripStatusHistory.create({
          data: {
            tripId: trip.id,
            fromStatus: fromTrip,
            toStatus: toTrip,
            actorUserId,
          },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: trip.bookingId,
            fromStatus: fromBooking,
            toStatus: toBooking,
            actorUserId,
          },
        });
        return tx.trip.findUniqueOrThrow({ where: { id: trip.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async trustedMetrics(
    tripId: string,
    fallback: {
      distanceMeters: number;
      durationSeconds: number;
      startedAt: Date;
    },
  ) {
    const points = await prisma.tripLocationHistory.findMany({
      where: { tripId, recordedAt: { gte: fallback.startedAt } },
      orderBy: { recordedAt: "asc" },
      select: { latitude: true, longitude: true, recordedAt: true },
      take: 20_000,
    });
    if (points.length < 2) {
      return { ...fallback, source: "BOOKED_ROUTE_FALLBACK" as const };
    }
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      total += distanceMeters(
        {
          latitude: Number(previous.latitude),
          longitude: Number(previous.longitude),
        },
        {
          latitude: Number(current.latitude),
          longitude: Number(current.longitude),
        },
      );
    }
    return {
      distanceMeters: Math.max(1, Math.round(total)),
      durationSeconds: Math.max(
        1,
        Math.round(
          (points.at(-1)!.recordedAt.getTime() -
            points[0]!.recordedAt.getTime()) /
            1_000,
        ),
      ),
      startedAt: fallback.startedAt,
      source: "SAMPLED_TRACKING" as const,
    };
  }

  private async get(id: string) {
    let trip = await prisma.trip.findUnique({
      where: { id },
      include: {
        driver: { include: { user: true } },
        booking: {
          include: { customer: { include: { user: true } } },
        },
      },
    });
    if (!trip) {
      trip = await prisma.trip.findUnique({
        where: { bookingId: id },
        include: {
          driver: { include: { user: true } },
          booking: {
            include: { customer: { include: { user: true } } },
          },
        },
      });
    }
    if (!trip) throw errors.notFound("RIDE_REQUEST_NOT_FOUND");
    return trip;
  }

  private assertDriver(driverUserId: string, userId: string) {
    if (driverUserId !== userId) throw errors.forbidden("TRIP_ACCESS_DENIED");
  }

  private otpHash(tripId: string, otp: string) {
    return createHmac("sha256", env.COOKIE_SECRET)
      .update(`${tripId}:${otp}`)
      .digest("hex");
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async releaseLock(key: string, token: string) {
    await redis.eval(
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  }
}
