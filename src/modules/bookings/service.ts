import {
  BookingStatus,
  BookingType,
  CouponDiscountType,
  Prisma,
  RideType,
  PaymentMethod,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import { queues } from "../../infrastructure/queues";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
  getRealtimeServer,
} from "../../infrastructure/realtime";
import { redis } from "../../infrastructure/redis";
import { redisKeys } from "../../realtime/socket.constants";
import { getRoute } from "../../integrations/maps";
import { PricingService } from "../pricing/service";
import { canTransition } from "./enums/status";
import { DriverAvailabilityService } from "../driver/services/driver-availability.service";
import { NotificationsService } from "../notifications/service";
import { DriverMatchingService } from "../dispatch/driver-matching.service";
import { DispatchService } from "../dispatch/service";

const cancellationChargeMarker = (bookingId: string) =>
  `[charged_to_booking:${bookingId}]`;

export class BookingsService {
  private readonly pricing = new PricingService();
  private readonly availability = new DriverAvailabilityService();
  private readonly notifications = new NotificationsService();
  private readonly dispatch = new DispatchService();
  private readonly matching = new DriverMatchingService();

  async create(
    userId: string,
    idempotencyKey: string,
    input: {
      vehicleCategoryId: string;
      type: BookingType;
      rideType: RideType;
      tripType?: "ONE_WAY" | "RETURN";
      pickup: { address: string; latitude: number; longitude: number };
      drop: { address: string; latitude: number; longitude: number };
      scheduledAt?: string;
      returnDateTime?: string;
      couponCode?: string;
      customerNote?: string;
      passengerCount?: number;
      luggageCount?: number;
      bookingFor?: any;
      specialRequirements?: string[];
      paymentMethod: PaymentMethod;
    },
  ) {
    if (!idempotencyKey || idempotencyKey.length > 100) {
      throw errors.badRequest("A valid x-idempotency-key header is required");
    }
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { displayName: true, phone: true, status: true } },
      },
    });
    if (!customer) throw errors.forbidden("Customer profile required");
    if (customer.user.status !== "ACTIVE") {
      throw errors.forbidden("Customer account is not active");
    }

    const lockKey = `booking:create:lock:${customer.id}`;
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 15000, "NX");
    if (!locked) {
      throw errors.conflict("A booking request is already being processed");
    }

    try {
      const replay = await prisma.booking.findUnique({
        where: {
          customerId_idempotencyKey: {
            customerId: customer.id,
            idempotencyKey,
          },
        },
        include: { fareBreakdowns: true, payments: true },
      });
      if (replay) {
        // unlock if returning early
        await redis.eval(
          "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
          1,
          lockKey,
          lockToken,
        );
        return replay;
      }

      const scheduledAt = input.scheduledAt
        ? new Date(input.scheduledAt)
        : undefined;

      if (input.type === BookingType.SCHEDULED) {
        if (!scheduledAt || scheduledAt.getTime() < Date.now() + 15 * 60_000) {
          throw errors.badRequest(
            "Scheduled rides must be at least 15 minutes ahead",
          );
        }
      }

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.vehicleCategoryId,
        );
      let category = await prisma.vehicleCategory.findFirst({
        where: isUuid
          ? { id: input.vehicleCategoryId }
          : {
              OR: [
                { name: { equals: input.vehicleCategoryId, mode: "insensitive" } },
                { slug: { equals: input.vehicleCategoryId, mode: "insensitive" } },
              ],
            },
      });

      if (!category) {
        category = await prisma.vehicleCategory.findFirst({
          where: { isActive: true },
        });
      }

      if (!category) throw errors.notFound("VEHICLE_CATEGORY_NOT_FOUND");
      if (!category.isActive)
        throw errors.badRequest("VEHICLE_CATEGORY_INACTIVE");

      // Use actual database category ID
      input.vehicleCategoryId = category.id;

      if (input.type === BookingType.IMMEDIATE) {
        const matchingService = new DriverMatchingService();
        const isDriverAvailable = await matchingService.isAnyDriverAvailable(
          category.id,
          input.pickup.longitude,
          input.pickup.latitude,
          10000, // 10km radius
        );
        if (!isDriverAvailable) {
          throw errors.conflict(
            "No drivers are currently available for this category nearby.",
          );
        }
      }
      const route = await getRoute(input.pickup, input.drop);
      const fare = await this.pricing.calculate({
        vehicleCategoryId: category.id,
        rideType: input.rideType,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        couponCode: input.couponCode,
        customerId: customer.id,
      });

      let returnRoute: Awaited<ReturnType<typeof getRoute>> | null = null;
      let returnFare: Awaited<
        ReturnType<typeof this.pricing.calculate>
      > | null = null;
      if (input.tripType === "RETURN") {
        if (!input.returnDateTime) {
          throw errors.badRequest(
            "returnDateTime is required for return trips",
          );
        }
        const returnScheduledAt = new Date(input.returnDateTime);
        if (
          returnScheduledAt.getTime() <=
          (scheduledAt ? scheduledAt.getTime() : Date.now())
        ) {
          throw errors.badRequest(
            "Return time must be after the outbound time",
          );
        }
        returnRoute = await getRoute(input.drop, input.pickup);
        returnFare = await this.pricing.calculate({
          vehicleCategoryId: category.id,
          rideType: input.rideType,
          distanceMeters: returnRoute.distanceMeters,
          durationSeconds: returnRoute.durationSeconds,
          couponCode: input.couponCode,
          customerId: customer.id,
        });
      }

      let bookingData: any;
      try {
        bookingData = await prisma.$transaction(async (tx) => {
          if (fare.couponId) {
            const [coupon] = await tx.$queryRaw<
              Array<{
                id: string;
                isActive: boolean;
                validFrom: Date;
                validUntil: Date;
                discountType: CouponDiscountType;
                discountValue: Prisma.Decimal;
                maxDiscount: Prisma.Decimal | null;
                minimumFare: Prisma.Decimal;
                maxUses: number | null;
                maxUsesPerUser: number;
                categoryId: string | null;
                newUsersOnly: boolean;
              }>
            >(Prisma.sql`
            SELECT
              "id", "isActive", "validFrom", "validUntil", "discountType",
              "discountValue", "maxDiscount", "minimumFare", "maxUses",
              "maxUsesPerUser", "categoryId", "newUsersOnly"
            FROM "Coupon"
            WHERE "id" = ${fare.couponId}::uuid
            FOR UPDATE
          `);
            const now = new Date();

            let isNewUserEligible = true;
            if (coupon?.newUsersOnly) {
              const priorBookingsCount = await tx.booking.count({
                where: { customerId: customer.id },
              });
              isNewUserEligible = priorBookingsCount === 0;
            }

            if (
              !coupon ||
              !coupon.isActive ||
              coupon.validFrom > now ||
              coupon.validUntil <= now ||
              coupon.minimumFare.greaterThan(fare.subtotal) ||
              (coupon.categoryId &&
                coupon.categoryId !== input.vehicleCategoryId) ||
              !isNewUserEligible
            ) {
              throw errors.conflict("Coupon is no longer applicable");
            }
            const [totalUses, userUses] = await Promise.all([
              tx.couponUsage.count({ where: { couponId: coupon.id } }),
              tx.couponUsage.count({
                where: { couponId: coupon.id, customerId: customer.id },
              }),
            ]);
            if (
              (coupon.maxUses !== null && totalUses >= coupon.maxUses) ||
              userUses >= coupon.maxUsesPerUser
            ) {
              throw errors.conflict("Coupon usage limit reached");
            }
            let currentDiscount =
              coupon.discountType === CouponDiscountType.FIXED
                ? coupon.discountValue
                : new Prisma.Decimal(fare.subtotal)
                    .mul(coupon.discountValue)
                    .div(100);
            if (
              coupon.maxDiscount &&
              currentDiscount.greaterThan(coupon.maxDiscount)
            ) {
              currentDiscount = coupon.maxDiscount;
            }
            if (currentDiscount.isNegative()) {
              currentDiscount = new Prisma.Decimal(0);
            }
            if (currentDiscount.greaterThan(fare.subtotal)) {
              currentDiscount = new Prisma.Decimal(fare.subtotal);
            }
            if (!currentDiscount.equals(fare.discount)) {
              throw errors.conflict(
                "Coupon terms changed; recalculate the fare",
              );
            }
          }
          const pendingCancellationFees = await tx.bookingCancellation.findMany(
            {
              where: {
                fee: { gt: 0 },
                booking: { customerId: customer.id },
                OR: [
                  { reason: null },
                  { NOT: { reason: { contains: "[charged_to_booking:" } } },
                ],
              },
              select: { id: true, fee: true, reason: true },
            },
          );
          const cancellationDue = pendingCancellationFees.reduce(
            (total, item) => total.add(item.fee),
            new Prisma.Decimal(0),
          );
          const bookingTotal = new Prisma.Decimal(fare.total).add(
            cancellationDue,
          );

          const created = await tx.booking.create({
            data: {
              customerId: customer.id,
              vehicleCategoryId: input.vehicleCategoryId,
              type: input.type,
              rideType: input.rideType,
              tripType: input.tripType || "ONE_WAY",
              tripLeg: input.tripType === "RETURN" ? "OUTBOUND" : null,
              returnDateTime:
                input.tripType === "RETURN" && input.returnDateTime
                  ? new Date(input.returnDateTime)
                  : null,
              pickupAddress: input.pickup.address,
              pickupLatitude: input.pickup.latitude,
              pickupLongitude: input.pickup.longitude,
              dropAddress: input.drop.address,
              dropLatitude: input.drop.latitude,
              dropLongitude: input.drop.longitude,
              distanceMeters: route.distanceMeters,
              durationSeconds: route.durationSeconds,
              routePolyline: route.encodedPolyline,
              scheduledAt,
              couponId: fare.couponId,
              estimatedFare: bookingTotal,
              customerNote: input.customerNote,
              idempotencyKey,
              passengerCount: input.passengerCount,
              luggageCount: input.luggageCount,
              bookingFor: input.bookingFor ? input.bookingFor : Prisma.DbNull,
              specialRequirements: input.specialRequirements || [],
              statusHistory: { create: { toStatus: BookingStatus.PENDING } },
              fareBreakdowns: {
                create: {
                  kind: "ESTIMATE",
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
                  total: bookingTotal,
                  calculationSnapshot: {
                    ...fare.calculationSnapshot,
                    cancellationDue,
                    cancellationFeeIds: pendingCancellationFees.map(
                      ({ id }) => id,
                    ),
                  },
                },
              },
              payments: {
                create: {
                  method: input.paymentMethod,
                  amount: bookingTotal,
                  idempotencyKey: `payment:${idempotencyKey}`,
                  provider: "SYSTEM",
                },
              },
            },
          });
          for (const item of pendingCancellationFees) {
            await tx.bookingCancellation.update({
              where: { id: item.id },
              data: {
                reason: `${item.reason ? `${item.reason}\n` : ""}${cancellationChargeMarker(created.id)}`,
              },
            });
          }
          if (fare.couponId) {
            await tx.couponUsage.create({
              data: {
                couponId: fare.couponId,
                customerId: customer.id,
                bookingId: created.id,
                discount: fare.discount,
              },
            });
          }
          if (input.type === BookingType.SCHEDULED && scheduledAt) {
            const reminderAt = new Date(scheduledAt.getTime() - 30 * 60_000);
            const activationAt = new Date(scheduledAt.getTime() - 15 * 60_000);
            await tx.scheduledBooking.create({
              data: {
                bookingId: created.id,
                scheduledAt,
                reminderAt,
                activationAt,
                version: 1,
              },
            });
          }

          let createdReturnBooking: any = null;
          if (
            input.tripType === "RETURN" &&
            returnFare &&
            returnRoute &&
            input.returnDateTime
          ) {
            const returnBookingTotal = new Prisma.Decimal(returnFare.total);
            createdReturnBooking = await tx.booking.create({
              data: {
                customerId: customer.id,
                vehicleCategoryId: input.vehicleCategoryId,
                type: "SCHEDULED",
                rideType: input.rideType,
                tripType: "RETURN",
                tripLeg: "RETURN",
                parentBookingId: created.id,
                pickupAddress: input.drop.address,
                pickupLatitude: input.drop.latitude,
                pickupLongitude: input.drop.longitude,
                dropAddress: input.pickup.address,
                dropLatitude: input.pickup.latitude,
                dropLongitude: input.pickup.longitude,
                distanceMeters: returnRoute.distanceMeters,
                durationSeconds: returnRoute.durationSeconds,
                routePolyline: returnRoute.encodedPolyline,
                scheduledAt: new Date(input.returnDateTime),
                estimatedFare: returnBookingTotal,
                customerNote: input.customerNote,
                idempotencyKey: idempotencyKey + "-return",
                passengerCount: input.passengerCount,
                luggageCount: input.luggageCount,
                bookingFor: input.bookingFor ? input.bookingFor : Prisma.DbNull,
                specialRequirements: input.specialRequirements || [],
                statusHistory: { create: { toStatus: BookingStatus.PENDING } },
                fareBreakdowns: {
                  create: {
                    kind: "ESTIMATE",
                    baseFare: returnFare.baseFare,
                    distanceCharge: returnFare.distanceCharge,
                    timeCharge: returnFare.timeCharge,
                    waitingCharge: returnFare.waitingCharge,
                    tollCharge: returnFare.tollCharge,
                    surgeMultiplier: returnFare.surgeMultiplier,
                    surgeCharge: returnFare.surgeCharge,
                    subtotal: returnFare.subtotal,
                    discount: returnFare.discount,
                    tax: returnFare.tax,
                    total: returnBookingTotal,
                    calculationSnapshot: returnFare.calculationSnapshot,
                  },
                },
                payments: {
                  create: {
                    method: input.paymentMethod,
                    amount: returnBookingTotal,
                    idempotencyKey: `payment:${idempotencyKey}-return`,
                    provider: "SYSTEM",
                  },
                },
              },
            });

            await tx.booking.update({
              where: { id: created.id },
              data: { returnBookingId: createdReturnBooking.id },
            });
            created.returnBookingId = createdReturnBooking.id;

            const retScheduledAt = new Date(input.returnDateTime);
            await tx.scheduledBooking.create({
              data: {
                bookingId: createdReturnBooking.id,
                scheduledAt: retScheduledAt,
                reminderAt: new Date(retScheduledAt.getTime() - 30 * 60_000),
                activationAt: new Date(retScheduledAt.getTime() - 15 * 60_000),
                version: 1,
              },
            });
          }

          return { created, createdReturnBooking };
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const existing = await prisma.booking.findUnique({
            where: {
              customerId_idempotencyKey: {
                customerId: customer.id,
                idempotencyKey,
              },
            },
            include: { payments: true },
          });
          if (existing) return existing;
        }
        throw error;
      }

      const booking = bookingData.created;
      const returnBooking = bookingData.createdReturnBooking;

      const customerName =
        customer.user.displayName || customer.user.phone || customer.id;

      console.log(`
================================================================================
[USER RIDE BOOKING CREATED] 🚖
--------------------------------------------------------------------------------
Customer Name  : ${customerName} (ID: ${customer.id})
Booking ID     : ${booking.id}
Pickup Address : ${booking.pickupAddress}
Drop Address   : ${booking.dropAddress}
Estimated Fare : ₹${booking.estimatedFare}
Ride Type      : ${booking.rideType} (${booking.vehicleCategoryId})
================================================================================
`);
      console.log(`[YOGESH][AUTO_BOOKING_CREATE] bookingId= ${booking.id}`);
      console.log(`[YOGESH][AUTO_BOOKING_CREATE] customerId= ${customer.id}`);
      console.log(
        `[YOGESH][AUTO_BOOKING_CREATE] serviceType= ${booking.rideType}`,
      );
      console.log(
        `[YOGESH][AUTO_BOOKING_CREATE] vehicleType= ${booking.vehicleCategoryId}`,
      );
      console.log(`[YOGESH][AUTO_BOOKING_CREATE] status= ${booking.status}`);

      if (input.type === BookingType.IMMEDIATE) {
        await queues.dispatch.add(
          "start",
          { bookingId: booking.id },
          { jobId: `dispatch-${booking.id}` },
        );
        setImmediate(() => {
          this.dispatch.start(booking.id).catch((err) => {
            console.log(
              `[YOGESH][DISPATCH] Direct dispatch execution notice: ${err?.message || err}`,
            );
          });
        });
      } else if (scheduledAt) {
        const activationDelay = Math.max(
          0,
          scheduledAt.getTime() - 15 * 60_000 - Date.now(),
        );
        // Enqueue activation job
        await queues.scheduledRides.add(
          "activate",
          { bookingId: booking.id, version: 1 },
          {
            jobId: `scheduled-activate-${booking.id}-v1`,
            delay: activationDelay,
          },
        );
        // Start dispatch immediately to offer scheduled ride to available eligible drivers
        console.log(
          `[SCHEDULED][IMMEDIATE_DISPATCH] Booking ${booking.id} created. Starting driver search immediately.`,
        );
        setImmediate(() => {
          this.dispatch.start(booking.id).catch((err) => {
            console.log(
              `[SCHEDULED][DISPATCH_NOTICE] Scheduled direct dispatch execution notice: ${err?.message || err}`,
            );
          });
        });
        // Enqueue reminder job
        await queues.scheduledRides.add(
          "reminder",
          { bookingId: booking.id, version: 1 },
          {
            jobId: `scheduled-reminder-${booking.id}-v1`,
            delay: Math.max(
              0,
              scheduledAt.getTime() - 30 * 60_000 - Date.now(),
            ),
          },
        );
        // Save job IDs
        await prisma.scheduledBooking.update({
          where: { bookingId: booking.id },
          data: {
            activationJobId: `scheduled-activate-${booking.id}-v1`,
            reminderJobId: `scheduled-reminder-${booking.id}-v1`,
          },
        });
      }

      if (returnBooking && input.returnDateTime) {
        const retScheduledAt = new Date(input.returnDateTime);
        const activationDelay = Math.max(
          0,
          retScheduledAt.getTime() - 15 * 60_000 - Date.now(),
        );
        await queues.scheduledRides.add(
          "activate",
          { bookingId: returnBooking.id, version: 1 },
          {
            jobId: `scheduled-activate-${returnBooking.id}-v1`,
            delay: activationDelay,
          },
        );
        await queues.scheduledRides.add(
          "reminder",
          { bookingId: returnBooking.id, version: 1 },
          {
            jobId: `scheduled-reminder-${returnBooking.id}-v1`,
            delay: Math.max(
              0,
              retScheduledAt.getTime() - 30 * 60_000 - Date.now(),
            ),
          },
        );
        await prisma.scheduledBooking.update({
          where: { bookingId: returnBooking.id },
          data: {
            activationJobId: `scheduled-activate-${returnBooking.id}-v1`,
            reminderJobId: `scheduled-reminder-${returnBooking.id}-v1`,
          },
        });
      }
      getRealtimeServer()
        ?.in(`customer:${customer.id}`)
        .socketsJoin(`booking:${booking.id}`);
      const createdPayload: any = {
        bookingId: booking.id,
        status: booking.status,
        type: booking.type,
        rideType: booking.rideType,
        tripType: booking.tripType,
        tripLeg: booking.tripLeg,
        returnBookingId: booking.returnBookingId,
        returnDateTime: booking.returnDateTime,
        categoryId: booking.vehicleCategoryId,
        pickup: {
          address: booking.pickupAddress,
          latitude: Number(booking.pickupLatitude),
          longitude: Number(booking.pickupLongitude),
        },
        drop: {
          address: booking.dropAddress,
          latitude: Number(booking.dropLatitude),
          longitude: Number(booking.dropLongitude),
        },
        estimatedFare: Number(booking.estimatedFare),
        currency: booking.currency,
        scheduledAt: booking.scheduledAt,
        createdAt: booking.createdAt,
        paymentMethod: input.paymentMethod,
      };

      if (booking.tripType === "RETURN") {
        createdPayload.fare = {
          outbound: Number(booking.estimatedFare),
          return: returnBooking ? Number(returnBooking.estimatedFare) : 0,
          total:
            Number(booking.estimatedFare) +
            (returnBooking ? Number(returnBooking.estimatedFare) : 0),
          currency: booking.currency,
        };
      }
      emitBooking(booking.id, "booking:created", createdPayload);
      emitAdminRoom("dashboard", "admin:booking:created", {
        bookingId: booking.id,
        status: booking.status,
        type: booking.type,
        categoryId: booking.vehicleCategoryId,
        serviceAreaId: booking.serviceAreaId,
        createdAt: booking.createdAt,
        paymentMethod: input.paymentMethod,
      });
      emitAdminRoom("dashboard", "admin:dashboard:update", {
        reason: "booking.created",
        bookingId: booking.id,
      });

      const responseBooking = booking as any;
      if (booking.tripType === "RETURN") {
        responseBooking.fareInfo = createdPayload.fare;
        responseBooking.returnBooking = returnBooking;
      }
      return responseBooking;
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async list(userId: string, roles: string[], page: number, limit: number) {
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    const where =
      roles.includes("ADMIN") || roles.includes("SUPER_ADMIN")
        ? {}
        : customer
          ? { customerId: customer.id }
          : driver
            ? {
                dispatchOffers: {
                  some: { driverId: driver.id, status: "ACCEPTED" as const },
                },
              }
            : { id: "00000000-0000-0000-0000-000000000000" };
    const [items, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);
    return { items, meta: { page, limit, total } };
  }

  async get(id: string, userId: string, roles: string[]) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        customer: true,
        vehicleCategory: true,
        fareBreakdowns: true,
        dispatchOffers: {
          include: { driver: { select: { userId: true } } },
        },
        trip: true,
        cancellation: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!booking) throw errors.notFound("Booking not found");
    const authorized =
      roles.includes("ADMIN") ||
      roles.includes("SUPER_ADMIN") ||
      booking.customer.userId === userId ||
      booking.dispatchOffers.some(
        ({ status, driver }) =>
          status === "ACCEPTED" && driver.userId === userId,
      );
    if (!authorized) throw errors.forbidden("Booking access denied");
    return booking;
  }

  async reschedule(id: string, userId: string, scheduledAtStr: string) {
    const scheduledAt = new Date(scheduledAtStr);
    if (isNaN(scheduledAt.getTime()))
      throw errors.badRequest("Invalid scheduled time");

    // Check if in future, e.g. at least 30 mins from now
    if (scheduledAt.getTime() - Date.now() < 30 * 60_000) {
      throw errors.badRequest(
        "Scheduled time must be at least 30 minutes in the future.",
      );
    }

    const lockKey = redisKeys.bookingCancelLock(id);
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) throw errors.conflict("BOOKING_STATE_CHANGED");

    try {
      const result = await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id },
          include: {
            scheduledBooking: true,
            customer: true,
            assignments: {
              where: { status: "ACTIVE" },
              take: 1,
            },
          },
        });

        if (booking.customer.userId !== userId)
          throw errors.forbidden("BOOKING_ACCESS_DENIED");
        if (booking.type !== "SCHEDULED")
          throw errors.badRequest("Ride is not scheduled");

        const validStatuses = [
          "PENDING",
          "SEARCHING_DRIVER",
          "DRIVER_ASSIGNED",
        ];
        if (!validStatuses.includes(booking.status)) {
          throw errors.conflict("Cannot reschedule ride at this stage");
        }

        const newVersion = (booking.scheduledBooking?.version ?? 0) + 1;

        if (booking.scheduledBooking) {
          await tx.scheduledBooking.update({
            where: { id: booking.scheduledBooking.id },
            data: { scheduledAt, version: newVersion },
          });
        }

        let keepDriver = false;
        let releasedDriverId = null;

        if (booking.status === "DRIVER_ASSIGNED" && booking.assignedDriverId) {
          const driver = await tx.driverProfile.findUnique({
            where: { id: booking.assignedDriverId },
            include: {
              currentBookings: {
                where: {
                  status: {
                    in: [
                      "SEARCHING_DRIVER",
                      "DRIVER_ASSIGNED",
                      "DRIVER_ARRIVING",
                      "TRIP_STARTED",
                    ],
                  },
                  id: { not: booking.id }, // Exclude the current booking itself from overlap check
                },
                include: { scheduledBooking: true },
              },
              vehicles: { where: { isAvailable: true } },
              vehicleAssignments: {
                where: { isActive: true, endedAt: null },
                include: { vehicle: true },
              },
            },
          });

          if (driver) {
            const simulatedBooking = {
              ...booking,
              scheduledBooking: { scheduledAt },
            } as any;
            if (this.matching.isDriverAvailable(driver, simulatedBooking)) {
              keepDriver = true;
            }
          }

          if (!keepDriver) {
            releasedDriverId = booking.assignedDriverId;
            await tx.booking.update({
              where: { id },
              data: {
                status: "SEARCHING_DRIVER",
                assignedDriverId: null,
                assignedVehicleId: null,
                version: { increment: 1 },
              },
            });
            if (booking.assignments[0]) {
              await tx.driverAssignment.update({
                where: { id: booking.assignments[0].id },
                data: { status: "CANCELLED" },
              });
            }
            const trip = await tx.trip.findUnique({ where: { bookingId: id } });
            if (trip) {
              await tx.trip.update({
                where: { id: trip.id },
                data: { status: "CANCELLED", completedAt: new Date() },
              });
            }
          }
        }

        return { booking, newVersion, keepDriver, releasedDriverId };
      });

      const { booking, newVersion, releasedDriverId } = result;

      const activationDelay = Math.max(
        0,
        scheduledAt.getTime() - 15 * 60_000 - Date.now(),
      );
      await queues.scheduledRides.add(
        "activate",
        { bookingId: id, version: newVersion },
        {
          jobId: `scheduled-activate-${id}-v${newVersion}`,
          delay: activationDelay,
        },
      );

      const reminderDelay = Math.max(
        0,
        scheduledAt.getTime() - 30 * 60_000 - Date.now(),
      );
      await queues.scheduledRides.add(
        "reminder",
        { bookingId: id, version: newVersion },
        {
          jobId: `scheduled-reminder-${id}-v${newVersion}`,
          delay: reminderDelay,
        },
      );

      let statusMessage = `Your ride has been rescheduled successfully for ${scheduledAt.toLocaleTimeString()}.`;

      if (releasedDriverId) {
        emitDriver(releasedDriverId, "booking:cancelled", {
          bookingId: id,
          reason: "RESCHEDULED",
        });
        await this.notifications.enqueue({
          userId: userId,
          bookingId: id,
          channel: "PUSH",
          templateKey: "SCHEDULED_RIDE_REASSIGNING",
          title: "Ride Rescheduled",
          body: "Your ride has been rescheduled. We're finding a driver for the new time.",
          data: { event: "booking:rescheduled", bookingId: id },
        });
        statusMessage =
          "Your ride has been rescheduled. We're finding a driver for the new time.";

        await queues.dispatch.add(
          "start",
          { bookingId: id },
          { jobId: `dispatch-${id}-${Date.now()}` },
        );
        setImmediate(() => {
          this.dispatch.start(id).catch((err) => console.log(err));
        });
      } else {
        await this.notifications.enqueue({
          userId: userId,
          bookingId: id,
          channel: "PUSH",
          templateKey: "SCHEDULED_RIDE_RESCHEDULED",
          title: "Ride Rescheduled",
          body: statusMessage,
          data: { event: "booking:rescheduled", bookingId: id },
        });
      }

      emitBooking(id, "booking:rescheduled", {
        bookingId: id,
        scheduledAt: scheduledAtStr,
      });

      return {
        rideId: id,
        scheduledAt: scheduledAtStr,
        status: releasedDriverId ? "SEARCHING_DRIVER" : booking.status,
        reassignmentRequired: !!releasedDriverId,
      };
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async driverCancel(
    id: string,
    userId: string,
    input: { reasonCode: string; reason?: string },
  ) {
    const lockKey = redisKeys.bookingCancelLock(id);
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) throw errors.conflict("BOOKING_STATE_CHANGED");
    try {
      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.booking.findUniqueOrThrow({
          where: { id },
          include: {
            assignedDriver: true,
            trip: true,
            assignments: {
              where: { status: "ACTIVE" },
              take: 1,
            },
          },
        });

        if (
          current.status !== BookingStatus.DRIVER_ASSIGNED &&
          current.status !== BookingStatus.DRIVER_ARRIVING
        ) {
          throw errors.conflict("INVALID_BOOKING_TRANSITION");
        }
        if (current.assignedDriver?.userId !== userId) {
          throw errors.forbidden("BOOKING_ACCESS_DENIED");
        }

        // Release driver availability if it was an immediate ride
        if (current.type === "IMMEDIATE") {
          await tx.driverProfile.updateMany({
            where: { id: current.assignedDriverId! },
            data: { availability: "ONLINE" },
          });
          if (current.assignedVehicleId) {
            await tx.vehicle.updateMany({
              where: { id: current.assignedVehicleId },
              data: { isAvailable: true },
            });
          }
        }

        // Update the assignment to CANCELLED
        if (current.assignments[0]) {
          await tx.driverAssignment.update({
            where: { id: current.assignments[0].id },
            data: { status: "CANCELLED" },
          });
        }

        // Revert booking back to SEARCHING_DRIVER
        await tx.booking.update({
          where: { id },
          data: {
            status: BookingStatus.SEARCHING_DRIVER,
            assignedDriverId: null,
            assignedVehicleId: null,
            version: { increment: 1 },
          },
        });

        await tx.bookingStatusHistory.create({
          data: {
            bookingId: id,
            fromStatus: current.status,
            toStatus: BookingStatus.SEARCHING_DRIVER,
            actorUserId: userId,
            reason: input.reasonCode,
          },
        });

        if (current.trip) {
          await tx.trip.update({
            where: { id: current.trip.id },
            data: { status: "CANCELLED", completedAt: new Date() },
          });
          await tx.tripStatusHistory.create({
            data: {
              tripId: current.trip.id,
              fromStatus: current.trip.status,
              toStatus: "CANCELLED",
            },
          });
        }

        return {
          booking: current,
          releasedDriverId: current.assignedDriverId,
        };
      });

      emitDriver(result.releasedDriverId!, "booking:cancelled", {
        bookingId: id,
        reason: "CANCELLED_BY_YOU",
      });

      // User Notification
      await this.notifications.enqueue({
        userId: result.booking.customerId,
        bookingId: id,
        channel: "PUSH",
        templateKey: "DRIVER_CANCELLED",
        title: "Driver Unavailable",
        body: "Your assigned driver is no longer available. We're finding another driver for your scheduled ride.",
        data: {
          event: "booking:driver-cancelled",
          bookingId: id,
        },
      });

      // Restart dispatch
      await queues.dispatch.add(
        "start",
        { bookingId: id },
        { jobId: `dispatch-${id}-${Date.now()}` },
      );
      setImmediate(() => {
        this.dispatch.start(id).catch((err) => {
          console.log(
            `[DISPATCH_NOTICE] Reassignment direct dispatch error: ${err?.message || err}`,
          );
        });
      });

      return { status: "SEARCHING_DRIVER" };
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async cancel(
    id: string,
    userId: string,
    roles: string[],
    input: { reasonCode: string; reason?: string },
  ) {
    const booking = await this.get(id, userId, roles);
    const isAdmin = roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
    if (!isAdmin && booking.customer.userId !== userId) {
      throw errors.forbidden("BOOKING_ACCESS_DENIED");
    }
    if (!canTransition(booking.status, BookingStatus.CANCELLED)) {
      if (booking.status === BookingStatus.CANCELLED) return booking;
      throw errors.conflict("INVALID_BOOKING_TRANSITION");
    }
    const lockKey = redisKeys.bookingCancelLock(id);
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) throw errors.conflict("BOOKING_STATE_CHANGED");
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const current = await tx.booking.findUniqueOrThrow({
            where: { id },
            include: {
              dispatchOffers: {
                where: { status: "OFFERED" },
                select: { id: true, driverId: true },
              },
              assignments: {
                where: { status: "ACTIVE" },
                take: 1,
              },
              trip: true,
              payments: {
                where: { status: "CAPTURED" },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
              returnBookings: {
                where: { status: { not: BookingStatus.CANCELLED } },
              },
            },
          });
          if (current.status === BookingStatus.CANCELLED) {
            return { booking: current, releasedDriverId: null, openOffers: [] };
          }
          if (!canTransition(current.status, BookingStatus.CANCELLED)) {
            throw errors.conflict("INVALID_BOOKING_TRANSITION");
          }
          const fareRule = await tx.pricingRule.findFirst({
            where: {
              vehicleCategoryId: current.vehicleCategoryId,
              rideType: current.rideType,
              isActive: true,
              effectiveFrom: { lte: new Date() },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
            },
            orderBy: { effectiveFrom: "desc" },
            select: { cancellationFee: true },
          });
          const previousCustomerCancellations = isAdmin
            ? 0
            : await tx.bookingCancellation.count({
                where: {
                  cancelledByUserId: userId,
                  bookingId: { not: id },
                  booking: { customerId: current.customerId },
                },
              });
          const fee =
            !isAdmin && previousCustomerCancellations < 2
              ? new Prisma.Decimal(0)
              : (fareRule?.cancellationFee ?? new Prisma.Decimal(0));
          const bookingIdsToCancel = [id, ...current.returnBookings.map(b => b.id)];
          const changed = await tx.booking.updateMany({
            where: { id: { in: bookingIdsToCancel }, status: { not: BookingStatus.CANCELLED } },
            data: {
              status: BookingStatus.CANCELLED,
              assignedDriverId: null,
              assignedVehicleId: null,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) {
            throw errors.conflict("BOOKING_STATE_CHANGED");
          }
          for (const bId of bookingIdsToCancel) {
            await tx.bookingStatusHistory.create({
              data: {
                bookingId: bId,
                fromStatus: bId === id ? current.status : BookingStatus.PENDING,
                toStatus: BookingStatus.CANCELLED,
                actorUserId: userId,
                reason: input.reason,
              },
            });
            await tx.bookingCancellation.upsert({
              where: { bookingId: bId },
              update: {},
              create: {
                bookingId: bId,
                cancelledByUserId: userId,
                reasonCode: input.reasonCode,
                reason: input.reason,
                fee: bId === id ? fee : 0,
              },
            });
          }
          await tx.dispatchOffer.updateMany({
            where: { bookingId: id, status: "OFFERED" },
            data: { status: "CANCELLED", respondedAt: new Date() },
          });
          await tx.dispatchCycle.updateMany({
            where: { bookingId: id, status: "ACTIVE" },
            data: {
              status: "CANCELLED",
              completedAt: new Date(),
              failureReason: "BOOKING_CANCELLED",
            },
          });
          const assignment = current.assignments[0];
          if (assignment) {
            await tx.driverAssignment.update({
              where: { id: assignment.id },
              data: {
                status: "CANCELLED",
                releasedAt: new Date(),
                releaseReason: input.reasonCode,
              },
            });
            await tx.driverProfile.updateMany({
              where: { id: assignment.driverId, availability: "BUSY" },
              data: { availability: "ONLINE" },
            });
            await tx.vehicle.update({
              where: { id: assignment.vehicleId },
              data: { isAvailable: true },
            });
          }
          if (
            current.trip &&
            [
              "CREATED",
              "DRIVER_ARRIVING",
              "DRIVER_ARRIVED",
              "STARTED",
            ].includes(current.trip.status)
          ) {
            await tx.trip.update({
              where: { id: current.trip.id },
              data: {
                status: "CANCELLED",
                verificationOtpHash: null,
                verificationOtpExpiresAt: null,
              },
            });
            await tx.tripStatusHistory.create({
              data: {
                tripId: current.trip.id,
                fromStatus: current.trip.status,
                toStatus: "CANCELLED",
                actorUserId: userId,
              },
            });
          }
          if (current.couponId) {
            await tx.couponUsage.deleteMany({ where: { bookingId: id } });
          }
          const payment = current.payments[0];
          let refundRecord = null;
          if (payment) {
            refundRecord = await tx.refund.upsert({
              where: { idempotencyKey: `booking-cancel:${id}` },
              update: {},
              create: {
                paymentId: payment.id,
                amount: Prisma.Decimal.max(
                  new Prisma.Decimal(0),
                  payment.amountPaid.sub(fee),
                ),
                reason: input.reason ?? input.reasonCode,
                idempotencyKey: `booking-cancel:${id}`,
              },
            });
          }
          return {
            booking: await tx.booking.findUniqueOrThrow({ where: { id } }),
            releasedDriverId: assignment?.driverId ?? null,
            openOffers: current.dispatchOffers,
            refundInitiated: !!payment,
            refundId: refundRecord?.id ?? null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      await this.cleanupCancellationJobs(id);
      const pipeline = redis.pipeline();
      pipeline.del(
        redisKeys.dispatchState(id),
        redisKeys.dispatchCycle(id),
        redisKeys.dispatchOfferedDrivers(id),
      );
      for (const offer of result.openOffers) {
        pipeline.del(redisKeys.dispatchOffer(offer.id));
        pipeline.srem(redisKeys.driverOffers(offer.driverId), offer.id);
        emitDriver(offer.driverId, "dispatch:offer-cancelled", {
          offerId: offer.id,
          bookingId: id,
          reason: "BOOKING_CANCELLED",
        });

        // Let's find the driver userId for push
        const driverProfile = await prisma.driverProfile.findUnique({
          where: { id: offer.driverId },
          select: { userId: true },
        });
        if (driverProfile) {
          await this.notifications.sendToDriver({
            driverId: driverProfile.userId,
            bookingId: id,
            templateKey: "BOOKING_CANCELLED",
            title: "Booking Cancelled",
            body: "The customer cancelled the ride request.",
            data: {
              type: "BOOKING_CANCELLED",
              entityType: "BOOKING",
              entityId: id,
              bookingId: id,
              screen: "booking_status",
              action: "OPEN_BOOKING",
              role: "DRIVER",
            },
          });
        }
      }
      await pipeline.exec();
      if (result.releasedDriverId) {
        await this.availability.restoreAvailable(result.releasedDriverId);
        emitDriver(result.releasedDriverId, "booking:cancelled", {
          bookingId: id,
          reasonCode: input.reasonCode,
        });

        const assignedDriverProfile = await prisma.driverProfile.findUnique({
          where: { id: result.releasedDriverId },
          select: { userId: true },
        });
        if (assignedDriverProfile) {
          await this.notifications.enqueue({
            userId: assignedDriverProfile.userId,
            bookingId: id,
            channel: "PUSH",
            templateKey: "BOOKING_CANCELLED",
            title: "Booking Cancelled",
            body: "The customer cancelled the assigned ride.",
            data: {
              type: "BOOKING_CANCELLED",
              entityType: "BOOKING",
              entityId: id,
              bookingId: id,
              screen: "booking_status",
              action: "OPEN_BOOKING",
              role: "DRIVER",
            },
          });
        }
      }
      emitBooking(id, "booking:cancelled", {
        bookingId: id,
        reasonCode: input.reasonCode,
      });
      emitAdminRoom("dashboard", "admin:booking:cancelled", {
        bookingId: id,
        reasonCode: input.reasonCode,
      });
      await this.notifications.enqueue({
        userId: booking.customer.userId,
        bookingId: id,
        channel: "PUSH",
        templateKey: "BOOKING_CANCELLED",
        title: "Booking cancelled",
        body: "Your booking has been cancelled.",
        data: {
          type: "BOOKING_CANCELLED",
          entityType: "BOOKING",
          entityId: id,
          bookingId: id,
          screen: "booking_details",
          action: "OPEN_BOOKING",
          role: "USER",
        },
      });
      if (result.refundInitiated) {
        if (result.refundId) {
          await queues.payments.add("process-refund", {
            refundId: result.refundId,
          });
        }
        await this.notifications.enqueue({
          userId: booking.customer.userId,
          bookingId: id,
          channel: "PUSH",
          templateKey: "REFUND_INITIATED",
          title: "Refund initiated",
          body: "A refund for your cancelled booking has been initiated.",
          data: { event: "booking:refund-initiated", bookingId: id },
        });
      }
      return result.booking;
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  private async cleanupCancellationJobs(bookingId: string) {
    const ids = [`dispatch-${bookingId}`, `booking-timeout-${bookingId}`];

    // Also try to find the scheduled booking to remove correct versioned jobs
    const scheduled = await prisma.scheduledBooking.findUnique({
      where: { bookingId },
    });
    const scheduledJobIds = [];
    if (scheduled) {
      if (scheduled.activationJobId)
        scheduledJobIds.push(scheduled.activationJobId);
      if (scheduled.reminderJobId)
        scheduledJobIds.push(scheduled.reminderJobId);
    } else {
      // Fallback to legacy unversioned jobs if no row exists (shouldn't happen but safe)
      scheduledJobIds.push(`scheduled-activate-${bookingId}`);
      scheduledJobIds.push(`scheduled-reminder-${bookingId}`);
    }

    const jobs = await Promise.all([
      ...ids.map((id) => queues.dispatch.getJob(id)),
      ...scheduledJobIds.map((id) => queues.scheduledRides.getJob(id)),
    ]);
    await Promise.all(
      jobs.map(async (job) => {
        try {
          await job?.remove();
        } catch {
          // An active job will re-read the terminal database state and no-op.
        }
      }),
    );
  }
}
