import { randomUUID } from "node:crypto";
import { BookingStatus, BookingType, Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { redisKeys } from "../../../realtime/socket.constants";
import { errors } from "../../../common/errors";
import { queues } from "../../../infrastructure/queues";
import { PricingService } from "../../pricing/service";
import { BookingsService } from "../../bookings/service";
import { CustomerLocationService } from "./customer-location.service";
import { getRoute } from "../../../integrations/maps";
import { env } from "../../../config/env";
import { distanceMeters } from "../../../common/geo";
import { CUSTOMER_LIMITS } from "../customer.constants";
import { DriverMatchingService } from "../../dispatch/driver-matching.service";
import { NotificationsService } from "../../notifications/service";

const formatDuration = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours} hr ${minutes} mins ${seconds} sec`;
};

const formatBookingDistanceAndDuration = (booking: any) => {
  const {
    distanceMeters: bookingDistanceMeters,
    durationSeconds,
    ...rest
  } = booking;
  return {
    ...rest,
    distanceKm: Number((Number(bookingDistanceMeters) / 1000).toFixed(2)),
    duration: formatDuration(Number(durationSeconds)),
  };
};

export class CustomerBookingService {
  private readonly pricing = new PricingService();
  private readonly bookings = new BookingsService();
  private readonly location = new CustomerLocationService();
  private readonly driverMatching = new DriverMatchingService();
  private readonly notifications = new NotificationsService();

  private async getCustomer(userId: string) {
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true, user: { select: { status: true } } },
    });
    if (!customer) throw errors.notFound("Customer profile not found");
    if (customer.user.status !== "ACTIVE") {
      throw errors.forbidden("Customer account is not active");
    }
    return customer;
  }

  async listCategories(userId: string, latitude?: number, longitude?: number) {
    await this.getCustomer(userId);
    let categoryIds: string[] = [];
    if (latitude != null && longitude != null && !isNaN(latitude) && !isNaN(longitude)) {
      const serviceability = await this.location.checkServiceability(
        latitude,
        longitude,
      );
      if (serviceability.isServiceable) {
        categoryIds = serviceability.availableCategoryIds;
      }
    }

    const categories = await prisma.vehicleCategory.findMany({
      where: {
        isActive: true,
        ...(categoryIds.length > 0 ? { id: { in: categoryIds } } : {}),
      },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        iconUrl: true,
        minPassengers: true,
        maxPassengers: true,
        pricingRules: {
          where: { rideType: "CITY" },
          select: { minimumFare: true },
        },
      },
    });

    // Decorate categories with safe UI elements and check driver availability
    const categoriesWithAvailability = await Promise.all(
      categories.map(async (c) => {
        const isAvailable = (latitude != null && longitude != null && !isNaN(latitude) && !isNaN(longitude))
          ? await this.driverMatching.isAnyDriverAvailable(
              c.id,
              longitude,
              latitude,
              10000, // 10km radius
            )
          : true;
        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          imageUrl: c.imageUrl,
          iconUrl: c.iconUrl,
          minPassengers: c.minPassengers,
          maxPassengers: c.maxPassengers,
          minimumFare: Number(c.pricingRules[0]?.minimumFare ?? 50),
          estimatedPickupTime: "5 mins", // Standard fallback UI estimation
          availability: isAvailable ? "AVAILABLE" : "UNAVAILABLE",
        };
      }),
    );

    // Return all categories so customer app displays vehicle options & fares
    return categoriesWithAvailability;
  }

  async estimateFare(userId: string, input: any) {
    const customer = await this.getCustomer(userId);
    const serviceArea = await this.location.findServiceArea(
      input.pickup.latitude,
      input.pickup.longitude,
    );
    const serviceAreaId = serviceArea?.id ?? "default-service-area";

    const serviceability = await this.location.checkServiceability(
      input.pickup.latitude,
      input.pickup.longitude,
    );
    if (!serviceability.isServiceable) {
      throw errors.badRequest("Service is not available here");
    }

    let route;
    if (!env.GOOGLE_MAPS_API_KEY) {
      // Return mock route details for local testing if maps key is missing
      route = {
        distanceMeters: 7500,
        durationSeconds: 900,
        encodedPolyline: "mock_polyline",
        provider: "mock",
      };
    } else {
      route = await getRoute(input.pickup, input.drop);
    }

    const requestedCategoryIds = input.categoryId
      ? [input.categoryId]
      : serviceability.availableCategoryIds;

    // Filter categories to only those with active/online drivers within a 10km radius via Redis GEOSEARCH
    const availableCategoryIds: string[] = [];
    for (const catId of requestedCategoryIds) {
      const hasDriver = await this.driverMatching.hasOnlineDriverInRadius(
        catId,
        input.pickup.longitude,
        input.pickup.latitude,
        10000, // 10km radius
      );
      if (hasDriver) {
        availableCategoryIds.push(catId);
      }
    }

    if (availableCategoryIds.length === 0) {
      throw errors.badRequest(
        input.categoryId 
          ? "No drivers available in your area for this vehicle type."
          : "No drivers available in your area at the moment."
      );
    }

    const estimates = await Promise.all(
      availableCategoryIds.map(async (categoryId) => {
        try {
          const fare = await this.pricing.calculate({
            vehicleCategoryId: categoryId,
            rideType: input.rideType || "CITY",
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            couponCode: input.couponCode,
            customerId: customer.id,
          });

          const estimateId = randomUUID();
          const estimatePayload = {
            estimateId,
            categoryId,
            distance: route.distanceMeters,
            duration: route.durationSeconds,
            routePolyline: route.encodedPolyline,
            pickupServiceAreaId: serviceAreaId,
            dropServiceAreaId: serviceAreaId,
            ...fare,
            expiresAt: new Date(
              Date.now() +
                CUSTOMER_LIMITS.FARE_ESTIMATE_EXPIRY_MINUTES * 60_000,
            ).toISOString(),
          };

          // Store in Redis with TTL
          await redis.setex(
            `customer:fare-estimate:${estimateId}`,
            CUSTOMER_LIMITS.FARE_ESTIMATE_EXPIRY_MINUTES * 60,
            JSON.stringify(estimatePayload),
          );

          return estimatePayload;
        } catch (e) {
          console.warn(
            `Failed to calculate fare for category ${categoryId}:`,
            e,
          );
          return null;
        }
      }),
    );

    const validEstimates = estimates.filter(
      (e): e is NonNullable<typeof e> => e !== null,
    );
    if (validEstimates.length === 0) {
      throw errors.badRequest("No drivers available in your area at the moment.");
    }
    return input.categoryId ? validEstimates[0] || null : validEstimates;
  }

  async createBookingImmediate(
    userId: string,
    input: any,
    idempotencyKey: string,
  ) {
    const customer = await this.getCustomer(userId);

    // Auto-cleanup any previous unassigned / stale booking sessions for this customer
    await prisma.booking.updateMany({
      where: {
        customerId: customer.id,
        assignedDriverId: null,
        status: {
          in: [BookingStatus.PENDING, BookingStatus.SEARCHING_DRIVER],
        },
      },
      data: {
        status: BookingStatus.CANCELLED,
      },
    });

    // Validate no conflicting active bookings (assigned or in-progress)
    const active = await prisma.booking.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: [
            BookingStatus.DRIVER_ASSIGNED,
            BookingStatus.DRIVER_ARRIVING,
            BookingStatus.DRIVER_ARRIVED,
            BookingStatus.TRIP_STARTED,
            BookingStatus.PAYMENT_PENDING,
          ],
        },
      },
    });
    if (active) {
      throw errors.conflict("You already have an active booking session.");
    }

    // Verify fare estimate
    if (input.fareEstimateId) {
      const stored = await redis.get(
        `customer:fare-estimate:${input.fareEstimateId}`,
      );
      if (!stored) {
        throw errors.conflict(
          "Fare estimate has expired or is invalid. Please request a new estimate.",
        );
      }
      const estimate = JSON.parse(stored);
      if (estimate.categoryId !== input.categoryId) {
        throw errors.conflict(
          "Vehicle category mismatch from original estimate",
        );
      }
    }

    const booking = await this.bookings.create(userId, idempotencyKey, {
      vehicleCategoryId: input.categoryId,
      type: BookingType.IMMEDIATE,
      rideType: input.rideType || "CITY",
      pickup: input.pickup,
      drop: input.drop,
      couponCode: input.couponCode,
      customerNote: input.notes,
      passengerCount: input.passengerCount,
      luggageCount: input.luggageCount,
      bookingFor: input.bookingFor,
      specialRequirements: input.specialRequirements,
      paymentMethod: input.paymentMethod || "CASH",
    });

    await this.notifications.enqueue({
      userId,
      bookingId: booking.id,
      channel: "PUSH",
      templateKey: "BOOKING_CREATED",
      title: "Booking Created",
      body: "Your ride request has been created.",
      data: {
        type: "BOOKING_CREATED",
        entityType: "BOOKING",
        entityId: booking.id,
        bookingId: booking.id,
        screen: "ride_status",
        action: "OPEN_BOOKING",
        role: "USER",
      },
    });

    return formatBookingDistanceAndDuration(booking);
  }

  async createBookingScheduled(
    userId: string,
    input: any,
    idempotencyKey: string,
  ) {
    const customer = await this.getCustomer(userId);

    // Validate scheduled time
    const scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt.getTime() < Date.now() + 15 * 60_000) {
      throw errors.badRequest(
        "Scheduled bookings must be at least 15 minutes in advance",
      );
    }

    const booking = await this.bookings.create(userId, idempotencyKey, {
      vehicleCategoryId: input.categoryId,
      type: BookingType.SCHEDULED,
      rideType: input.rideType || "CITY",
      pickup: input.pickup,
      drop: input.drop,
      scheduledAt: input.scheduledAt,
      couponCode: input.couponCode,
      customerNote: input.notes,
      passengerCount: input.passengerCount,
      luggageCount: input.luggageCount,
      bookingFor: input.bookingFor,
      specialRequirements: input.specialRequirements,
      paymentMethod: input.paymentMethod || "CASH",
    });

    await this.notifications.enqueue({
      userId,
      bookingId: booking.id,
      channel: "PUSH",
      templateKey: "BOOKING_SCHEDULED",
      title: "Booking Scheduled",
      body: "Your ride request has been created and scheduled.",
      data: {
        type: "BOOKING_CREATED",
        entityType: "BOOKING",
        entityId: booking.id,
        bookingId: booking.id,
        screen: "ride_status",
        action: "OPEN_BOOKING",
        role: "USER",
      },
    });

    return formatBookingDistanceAndDuration(booking);
  }

  async rescheduleBooking(
    userId: string,
    bookingId: string,
    scheduledAt: string,
  ) {
    const customer = await this.getCustomer(userId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { scheduledBooking: true },
    });
    if (!booking || booking.customerId !== customer.id) {
      throw errors.notFound("Booking not found");
    }
    if (
      booking.type !== BookingType.SCHEDULED ||
      booking.status !== BookingStatus.PENDING
    ) {
      throw errors.conflict(
        "Only pending scheduled bookings can be rescheduled",
      );
    }

    // Must not reschedule after cutoff (e.g. less than 15 minutes before the ride)
    const currentScheduled = booking.scheduledAt
      ? new Date(booking.scheduledAt).getTime()
      : 0;
    if (currentScheduled > 0 && currentScheduled - Date.now() < 15 * 60_000) {
      throw errors.conflict(
        "Cannot reschedule booking less than 15 minutes before the ride starts",
      );
    }

    const updatedDate = new Date(scheduledAt);
    if (updatedDate.getTime() < Date.now() + 15 * 60_000) {
      throw errors.badRequest(
        "Rescheduled bookings must be at least 15 minutes in advance",
      );
    }

    const newVersion = (booking.scheduledBooking?.version || 1) + 1;
    const reminderAt = new Date(updatedDate.getTime() - 30 * 60_000);
    const activationAt = new Date(updatedDate.getTime() - 15 * 60_000);
    const newReminderJobId = `scheduled-reminder-${bookingId}-v${newVersion}`;
    const newActivationJobId = `scheduled-activate-${bookingId}-v${newVersion}`;

    // Remove old jobs to prevent them from firing at the old time
    if (booking.scheduledBooking?.reminderJobId) {
      const oldReminder = await queues.scheduledRides.getJob(
        booking.scheduledBooking.reminderJobId,
      );
      if (oldReminder) await oldReminder.remove();
    }
    if (booking.scheduledBooking?.activationJobId) {
      const oldActivation = await queues.scheduledRides.getJob(
        booking.scheduledBooking.activationJobId,
      );
      if (oldActivation) await oldActivation.remove();
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { scheduledAt: updatedDate },
      });
      await tx.scheduledBooking.update({
        where: { bookingId },
        data: {
          scheduledAt: updatedDate,
          reminderAt,
          activationAt,
          version: newVersion,
          reminderJobId: newReminderJobId,
          activationJobId: newActivationJobId,
          rescheduleCount: { increment: 1 },
          lastRescheduledAt: new Date(),
        },
      });
    });

    await queues.scheduledRides.add(
      "reminder",
      { bookingId, version: newVersion },
      {
        jobId: newReminderJobId,
        delay: Math.max(0, reminderAt.getTime() - Date.now()),
      },
    );
    await queues.scheduledRides.add(
      "activate",
      { bookingId, version: newVersion },
      {
        jobId: newActivationJobId,
        delay: Math.max(0, activationAt.getTime() - Date.now()),
      },
    );

    return { success: true };
  }

  async getActiveBooking(userId: string) {
    const customer = await this.getCustomer(userId);
    const booking = await prisma.booking.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.SEARCHING_DRIVER,
            BookingStatus.DRIVER_ASSIGNED,
            BookingStatus.DRIVER_ARRIVING,
            BookingStatus.DRIVER_ARRIVED,
            BookingStatus.TRIP_STARTED,
            BookingStatus.PAYMENT_PENDING,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        vehicleCategory: {
          select: {
            id: true,
            name: true,
            iconUrl: true,
            imageUrl: true,
          },
        },
        assignedDriver: {
          select: {
            id: true,
            profileImageUrl: true,
            averageRating: true,
            user: { select: { displayName: true, phone: true } },
          },
        },
        assignedVehicle: {
          select: {
            id: true,
            make: true,
            model: true,
            color: true,
            registrationNo: true,
            category: {
              select: {
                id: true,
                name: true,
                iconUrl: true,
                imageUrl: true,
              },
            },
          },
        },
        trip: true,
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!booking) throw errors.notFound("No active booking session found");
    const rawOtp = await redis.get(`booking:otp:${booking.id}`);
    const otp = rawOtp || ((booking as any).trip ? "1234" : null);
    return {
      ...booking,
      hasOngoingTrip: true,
      booking,
      otp,
      rideStartOtp: otp,
      pickupOtp: otp,
    };
  }

  async getTimeline(userId: string, bookingId: string) {
    const customer = await this.getCustomer(userId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!booking || booking.customerId !== customer.id) {
      throw errors.notFound("Booking not found");
    }
    return booking.statusHistory;
  }

  async getDriverDetails(userId: string, bookingId: string) {
    const customer = await this.getCustomer(userId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        assignedDriver: {
          select: {
            id: true,
            profileImageUrl: true,
            averageRating: true,
            totalTrips: true,
            user: { select: { displayName: true } },
          },
        },
        assignedVehicle: {
          select: {
            id: true,
            make: true,
            model: true,
            color: true,
            registrationNo: true,
            category: { select: { name: true, imageUrl: true } },
          },
        },
      },
    });
    if (!booking || booking.customerId !== customer.id) {
      throw errors.notFound("Booking not found");
    }
    if (!booking.assignedDriverId) {
      throw errors.conflict("Driver is not assigned yet");
    }

    let etaMinutes: number | null = null;
    let distanceToPickupMeters: number | null = null;
    const rawLocation = await redis.get(
      `location:driver:${booking.assignedDriverId}`,
    );
    if (rawLocation) {
      const loc = JSON.parse(rawLocation);
      distanceToPickupMeters = distanceMeters(
        { latitude: loc.latitude, longitude: loc.longitude },
        {
          latitude: Number(booking.pickupLatitude),
          longitude: Number(booking.pickupLongitude),
        },
      );
      etaMinutes = Math.ceil(distanceToPickupMeters / 11 / 60);
    }

    const dropOffTime =
      etaMinutes === null
        ? null
        : new Date(
            Date.now() + (etaMinutes * 60 + booking.durationSeconds) * 1000,
          ).toISOString();

    return {
      driver: booking.assignedDriver,
      vehicle: booking.assignedVehicle
        ? {
            ...booking.assignedVehicle,
            name: `${booking.assignedVehicle.make} ${booking.assignedVehicle.model}`,
            number: booking.assignedVehicle.registrationNo,
          }
        : null,
      etaMinutes,
      distanceToPickupMeters,
      dropOffTime,
    };
  }

  async getFareDetails(userId: string, bookingId: string) {
    const customer = await this.getCustomer(userId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { fareBreakdowns: true },
    });
    if (!booking || booking.customerId !== customer.id) {
      throw errors.notFound("Booking not found");
    }
    return booking.fareBreakdowns;
  }

  async getPaymentDetails(userId: string, bookingId: string) {
    const customer = await this.getCustomer(userId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payments: true },
    });
    if (!booking || booking.customerId !== customer.id) {
      throw errors.notFound("Booking not found");
    }
    return booking.payments;
  }

  async getNearbyDriversForBooking(userId: string, bookingId: string) {
    await this.getCustomer(userId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        vehicleCategoryId: true,
        pickupLatitude: true,
        pickupLongitude: true,
        status: true,
        type: true,
      },
    });
    if (!booking) return [];

    try {
      const eligibleDrivers = await this.driverMatching.getEligibleDrivers(
        booking as any,
        10000,
        20,
      );

      const drivers = await Promise.all(
        eligibleDrivers.map(async ({ id: driverId }) => {
          const locationRaw = await redis.get(redisKeys.driverLocation(driverId));
          if (locationRaw) {
            try {
              const loc = JSON.parse(locationRaw);
              return {
                driverId,
                latitude: Number(loc.latitude),
                longitude: Number(loc.longitude),
                heading: Number(loc.heading || 0),
                vehicleCategoryId: booking.vehicleCategoryId,
              };
            } catch {}
          }
          return null;
        }),
      );

      return drivers.filter((d): d is NonNullable<typeof d> => d !== null);
    } catch (e) {
      console.error(`[CUSTOMER_BOOKING] Error getting nearby drivers for booking ${bookingId}:`, e);
      return [];
    }
  }

  async getNearbyDrivers(userId: string, bookingId: string) {
    return this.getNearbyDriversForBooking(userId, bookingId);
  }

  async getLiveDriverLocation(userId: string, bookingId: string) {
    const customer = await this.getCustomer(userId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || booking.customerId !== customer.id) {
      throw errors.notFound("Booking not found");
    }
    if (!booking.assignedDriverId) {
      throw errors.conflict("Driver is not assigned yet");
    }

    const locationKey = `location:driver:${booking.assignedDriverId}`;
    const rawLocation = await redis.get(locationKey);
    if (!rawLocation) {
      return {
        latitude: null,
        longitude: null,
        heading: null,
        etaMinutes: null,
        distanceMeters: null,
        stale: true,
      };
    }

    const loc = JSON.parse(rawLocation);
    // Calculate simple mock ETA & distance based on coordinates
    const distance = distanceMeters(
      { latitude: loc.latitude, longitude: loc.longitude },
      {
        latitude: Number(booking.pickupLatitude),
        longitude: Number(booking.pickupLongitude),
      },
    );
    const speed = 11; // ~40 km/h in m/s
    const etaMinutes = Math.ceil(distance / speed / 60);

    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      heading: loc.heading ?? null,
      etaMinutes,
      distanceMeters: distance,
      stale: false,
      lastSeenAt: loc.timestamp,
    };
  }

  async cancel(userId: string, bookingId: string, input: any) {
    const customer = await this.getCustomer(userId);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || booking.customerId !== customer.id) {
      throw errors.notFound("Booking not found");
    }

    const result = await this.bookings.cancel(
      bookingId,
      userId,
      ["CUSTOMER"],
      input,
    );
    return result;
  }
}
