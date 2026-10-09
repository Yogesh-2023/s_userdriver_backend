import { BookingStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
  getRealtimeServer,
} from "../../infrastructure/realtime";
import { queues } from "../../infrastructure/queues";
import { redis } from "../../infrastructure/redis";
import { NotificationsService } from "../notifications/service";
import { REALTIME_TTL, redisKeys } from "../../realtime/socket.constants";
import { DriverMatchingService } from "./driver-matching.service";

const strategy = [
  { radiusMeters: 2_000, batchSize: 3, timeoutSeconds: 60 },
  { radiusMeters: 4_000, batchSize: 5, timeoutSeconds: 60 },
  { radiusMeters: 10_000, batchSize: 8, timeoutSeconds: 60 },
] as const;

export class DispatchOfferService {
  private readonly matching = new DriverMatchingService();
  private readonly notifications = new NotificationsService();

  async processDispatchCycle(bookingId: string) {
    const lockKey = `lock:dispatch:${bookingId}:cycle`;
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 15_000, "NX");
    if (!locked) return false;
    try {
      return await this.processLocked(bookingId);
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  private async processLocked(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: {
          select: {
            id: true,
            userId: true,
            user: { select: { displayName: true, phone: true } },
          },
        },
        dispatchCycles: {
          where: { status: "ACTIVE" },
          orderBy: { cycleNumber: "desc" },
          take: 1,
          include: {
            offers: {
              where: { status: "OFFERED", expiresAt: { gt: new Date() } },
              select: { id: true },
            },
          },
        },
        dispatchOffers: { select: { driverId: true } },
      },
    });
    if (!booking || booking.status !== BookingStatus.SEARCHING_DRIVER) {
      return false;
    }

    if (booking.type === "SCHEDULED") {
      const now = new Date();
      const minutesUntilScheduled = booking.scheduledAt
        ? Math.round((booking.scheduledAt.getTime() - now.getTime()) / 60_000)
        : null;
      console.log(
        `[SCHEDULED][DISPATCH_WINDOW] bookingId=${bookingId} scheduledAt=${booking.scheduledAt?.toISOString()} currentUtc=${now.toISOString()} minutesUntilScheduled=${minutesUntilScheduled} vehicleCategoryId=${booking.vehicleCategoryId}`,
      );
      console.log(
        `[SCHEDULED][DISPATCH_START] bookingId=${bookingId} vehicleCategoryId=${booking.vehicleCategoryId} pickupLat=${booking.pickupLatitude} pickupLng=${booking.pickupLongitude} scheduledAt=${booking.scheduledAt?.toISOString()}`,
      );
    }

    let cycle = booking.dispatchCycles[0];
    if (cycle?.offers.length) return false;
    if (!cycle) {
      const last = await prisma.dispatchCycle.findFirst({
        where: { bookingId },
        orderBy: { cycleNumber: "desc" },
        select: { cycleNumber: true },
      });
      cycle = await prisma.dispatchCycle.create({
        data: {
          bookingId,
          cycleNumber: (last?.cycleNumber ?? 0) + 1,
          attemptNumber: 0,
          radiusMeters: strategy[0].radiusMeters,
        },
        include: {
          offers: { where: { id: "00000000-0000-0000-0000-000000000000" } },
        },
      });
      emitAdminRoom("dashboard", "admin:dispatch:started", {
        bookingId,
        dispatchCycleId: cycle.id,
        cycleNumber: cycle.cycleNumber,
      });
    }

    const attemptNumber = cycle.attemptNumber + 1;
    const currentStrategy = strategy[attemptNumber - 1];
    if (!currentStrategy) {
      await this.noDriverFound(bookingId, cycle.id);
      return true;
    }
    cycle = await prisma.dispatchCycle.update({
      where: { id: cycle.id },
      data: {
        attemptNumber,
        radiusMeters: currentStrategy.radiusMeters,
      },
      include: {
        offers: { where: { id: "00000000-0000-0000-0000-000000000000" } },
      },
    });

    const excludedDriverIds = [
      ...new Set(booking.dispatchOffers.map(({ driverId }) => driverId)),
    ];
    const drivers = await this.matching.getEligibleDrivers(
      booking,
      currentStrategy.radiusMeters,
      currentStrategy.batchSize,
      excludedDriverIds,
    );
    if (!drivers.length) {
      await prisma.dispatchCycle.update({
        where: { id: cycle.id },
        data: { attemptNumber: Math.max(0, attemptNumber - 1) },
      });
      const slot = Math.floor(Date.now() / 15_000);
      await queues.dispatch.add(
        "dispatch-next-batch",
        {
          bookingId,
          dispatchCycleId: cycle.id,
          attemptNumber: attemptNumber - 1,
        },
        {
          jobId: `dispatch-next-${bookingId}-${cycle.id}-${attemptNumber}-${slot}`,
          delay: 15_000,
        },
      );
      return true;
    }

    const expiresAt = new Date(
      Date.now() + currentStrategy.timeoutSeconds * 1_000,
    );
    const offers = await Promise.all(
      drivers.map(async (driver) => {
        let vehicleId =
          (driver as any).vehicleAssignments?.[0]?.vehicleId ??
          (driver as any).vehicles?.[0]?.id;
        if (!vehicleId) {
          const v = await prisma.vehicle.findFirst({
            where: { driverId: driver.id },
            select: { id: true },
          });
          vehicleId = v?.id;
        }
        if (!vehicleId) {
          const v = await prisma.vehicle.findFirst({
            where: { categoryId: booking.vehicleCategoryId },
            select: { id: true },
          });
          vehicleId = v?.id;
        }
        return {
          id: randomUUID(),
          bookingId,
          dispatchCycleId: cycle.id,
          driverId: driver.id,
          vehicleId: vehicleId ?? randomUUID(),
          attemptNumber,
          expiresAt,
        };
      }),
    );
    await prisma.dispatchOffer.createMany({ data: offers });

    const pipeline = redis.pipeline();
    pipeline.set(
      redisKeys.dispatchState(bookingId),
      "SEARCHING_DRIVER",
      "EX",
      REALTIME_TTL.DISPATCH_SECONDS,
    );
    pipeline.set(
      redisKeys.dispatchCycle(bookingId),
      cycle.id,
      "EX",
      REALTIME_TTL.DISPATCH_SECONDS,
    );
    for (const offer of offers) {
      pipeline.sadd(
        redisKeys.dispatchOfferedDrivers(bookingId),
        offer.driverId,
      );
      pipeline.expire(
        redisKeys.dispatchOfferedDrivers(bookingId),
        REALTIME_TTL.DISPATCH_SECONDS,
      );
      pipeline.set(
        redisKeys.dispatchOffer(offer.id),
        JSON.stringify({
          bookingId,
          driverId: offer.driverId,
          dispatchCycleId: cycle.id,
          expiresAt: expiresAt.toISOString(),
        }),
        "EX",
        currentStrategy.timeoutSeconds + REALTIME_TTL.OFFER_GRACE_SECONDS,
      );
      pipeline.sadd(redisKeys.driverOffers(offer.driverId), offer.id);
      pipeline.expire(
        redisKeys.driverOffers(offer.driverId),
        REALTIME_TTL.DISPATCH_SECONDS,
      );
    }
    await pipeline.exec();

    for (const offer of offers) {
      const distanceKmVal = booking.distanceMeters
        ? (booking.distanceMeters / 1000).toFixed(1)
        : "5.0";
      const durationMinVal = booking.durationSeconds
        ? Math.ceil(booking.durationSeconds / 60)
        : 15;
      const fareVal = Number(booking.estimatedFare);

      const matchedDriver = drivers.find((d) => d.id === offer.driverId);
      const driverUser = (matchedDriver as any)?.user;
      const driverName =
        driverUser?.displayName || driverUser?.phone || offer.driverId;

      console.log(`
================================================================================
[YOGESH][DISPATCH] NEW TRIP OFFER EMITTED 🚀
--------------------------------------------------------------------------------
[YOGESH][AUTO_DISPATCH] bookingId= ${bookingId}
[YOGESH][AUTO_DISPATCH] searching Auto drivers
[YOGESH][AUTO_DISPATCH] eligible drivers count= ${drivers.length}
[YOGESH][AUTO_DISPATCH] eligible driver IDs= [${drivers.map((d) => d.id).join(", ")}]
[YOGESH][AUTO_DISPATCH] selected driverId= ${offer.driverId}
[YOGESH][AUTO_DISPATCH] driver request created= ${offer.id}
[YOGESH][AUTO_DISPATCH] socket event emitted= ${offer.id}
[YOGESH][DISPATCH] bookingId= ${bookingId}
[YOGESH][DISPATCH] serviceType= ${booking.rideType}
[YOGESH][DISPATCH] vehicleType= ${booking.vehicleCategoryId}
[YOGESH][DISPATCH] status= ${booking.status}
[YOGESH][DISPATCH] searching eligible drivers
[YOGESH][DISPATCH] eligible drivers count= ${drivers.length}
[YOGESH][DISPATCH] eligible driver IDs= [${drivers.map((d) => d.id).join(", ")}]
[YOGESH][DISPATCH] creating driver request
[YOGESH][DISPATCH] requestId= ${offer.id}
[YOGESH][DISPATCH] driverId= ${offer.driverId}
[YOGESH][DISPATCH] emitting driver ride event
[YOGESH][DISPATCH] socket event= dispatch:offer
[YOGESH][DISPATCH] dispatch successful= true
================================================================================
`);

      const customerName =
        booking.customer?.user?.displayName ||
        booking.customer?.user?.phone ||
        "Customer";
      const customerPhone = booking.customer?.user?.phone || "";

      const payload = {
        offerId: offer.id,
        requestId: offer.id,
        bookingId,
        tripId: bookingId,
        dispatchCycleId: cycle.id,
        attemptNumber,
        categoryId: booking.vehicleCategoryId,
        customerName,
        customerPhone,
        customer: {
          id: booking.customer?.id ?? "",
          name: customerName,
          displayName: customerName,
          phone: customerPhone,
        },
        pickup: {
          latitude: Number(booking.pickupLatitude),
          longitude: Number(booking.pickupLongitude),
          address: booking.pickupAddress,
        },
        drop: {
          latitude: Number(booking.dropLatitude),
          longitude: Number(booking.dropLongitude),
          address: booking.dropAddress,
        },
        pickupAddress: booking.pickupAddress,
        dropAddress: booking.dropAddress,
        pickupLatitude: Number(booking.pickupLatitude),
        pickupLongitude: Number(booking.pickupLongitude),
        dropLatitude: Number(booking.dropLatitude),
        dropLongitude: Number(booking.dropLongitude),
        fare: fareVal,
        estimatedFare: fareVal,
        totalFare: fareVal,
        distance: distanceKmVal,
        distanceKm: distanceKmVal,
        distanceMeters: booking.distanceMeters,
        durationSeconds: booking.durationSeconds,
        estimatedDurationMin: durationMinVal,
        estimatedDriverEarning: fareVal * 0.8,
        bookingType: booking.type,
        type: booking.type,
        isScheduled: booking.type === "SCHEDULED",
        scheduledAt: booking.scheduledAt ? booking.scheduledAt.toISOString() : null,
        expiresAt: expiresAt.toISOString(),
        timeoutSeconds: currentStrategy.timeoutSeconds,
      };
      const meta = {
        bookingId,
        dispatchCycleId: cycle.id,
        requestId: offer.id,
      };

      console.log(`[DISPATCH] Creating offer...`);
      console.log(`[DISPATCH] Offer created: offerId=${offer.id}`);

      const realtime = getRealtimeServer();
      const driverRoomSockets = realtime?.sockets.adapter.rooms.get(`driver:${offer.driverId}`);
      const userRoomSockets = driverUser?.userId ? realtime?.sockets.adapter.rooms.get(`user:${driverUser.userId}`) : null;
      const driverSocketFound = Boolean((driverRoomSockets && driverRoomSockets.size > 0) || (userRoomSockets && userRoomSockets.size > 0));

      console.log(`[DISPATCH] Driver socket found=${driverSocketFound}`);
      console.log(`[DISPATCH] Emitting booking request to driver ${offer.driverId} (Room: driver:${offer.driverId})...`);

      emitDriver(offer.driverId, "dispatch:offer", payload, meta);
      emitDriver(offer.driverId, "dispatch_offer", payload, meta);
      emitDriver(offer.driverId, "NEW_TRIP_REQUEST", payload, meta);
      emitDriver(offer.driverId, "goods.booking.request.sent", payload, meta);
      emitDriver(offer.driverId, "goods:booking:request", payload, meta);

      console.log(`[DISPATCH] Socket emit successful`);

      emitAdminRoom("dashboard", "admin:dispatch:offer-sent", {
        bookingId,
        dispatchCycleId: cycle.id,
        driverId: offer.driverId,
        expiresAt: expiresAt.toISOString(),
      });

      console.log(`[DISPATCH] Sending FCM push notification to driver ${offer.driverId}...`);
      try {
        await this.enqueueOfferPush(offer.driverId, payload);
        console.log(`[DISPATCH] FCM sent successfully`);
      } catch (fcmError: any) {
        console.error(`[DISPATCH] FCM send failed for driver ${offer.driverId}:`, fcmError?.message || fcmError);
      }
    }

    await queues.dispatch.add(
      "dispatch-offer-timeout",
      { bookingId, dispatchCycleId: cycle.id, attemptNumber },
      {
        delay: currentStrategy.timeoutSeconds * 1_000,
        jobId: `dispatch-timeout-${bookingId}-${cycle.id}-${attemptNumber}`,
      },
    );
    return true;
  }

  async expireAttempt(
    bookingId: string,
    dispatchCycleId: string,
    attemptNumber: number,
  ) {
    const expired = await prisma.dispatchOffer.findMany({
      where: {
        bookingId,
        dispatchCycleId,
        attemptNumber,
        status: "OFFERED",
        expiresAt: { lte: new Date() },
      },
      select: { id: true, driverId: true },
    });
    if (expired.length) {
      await prisma.dispatchOffer.updateMany({
        where: { id: { in: expired.map(({ id }) => id) }, status: "OFFERED" },
        data: { status: "EXPIRED", respondedAt: new Date() },
      });
      const pipeline = redis.pipeline();
      for (const offer of expired) {
        pipeline.del(redisKeys.dispatchOffer(offer.id));
        pipeline.srem(redisKeys.driverOffers(offer.driverId), offer.id);
        emitDriver(offer.driverId, "dispatch:offer-expired", {
          offerId: offer.id,
          bookingId,
          dispatchCycleId,
        });
      }
      await pipeline.exec();
    }
    await this.processDispatchCycle(bookingId);
  }

  private async noDriverFound(bookingId: string, dispatchCycleId: string) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.booking.updateMany({
        where: { id: bookingId, status: "SEARCHING_DRIVER" },
        data: { status: "NO_DRIVER_FOUND", version: { increment: 1 } },
      });
      if (!changed.count) return;
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: "SEARCHING_DRIVER",
          toStatus: "NO_DRIVER_FOUND",
        },
      });
      await tx.dispatchCycle.updateMany({
        where: { id: dispatchCycleId, status: "ACTIVE" },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          failureReason: "NO_DRIVER_FOUND",
        },
      });
    });
    await redis.del(
      redisKeys.dispatchState(bookingId),
      redisKeys.dispatchCycle(bookingId),
    );
    emitBooking(bookingId, "dispatch:no-driver-found", { bookingId });
    emitAdminRoom("dashboard", "admin:dispatch:no-driver-found", {
      bookingId,
      dispatchCycleId,
    });
  }

  private async enqueueOfferPush(
    driverId: string,
    payload: {
      offerId: string;
      bookingId: string;
      expiresAt: string;
      isScheduled?: boolean;
      bookingType?: string;
      scheduledAt?: string | null;
      pickupAddress?: string;
      dropAddress?: string;
    },
  ) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw errors.notFound("DRIVER_NOT_FOUND");
    const isScheduled = payload.isScheduled || payload.bookingType === "SCHEDULED";
    const title = isScheduled ? "New Scheduled Ride" : "New Ride Request";
    const body = isScheduled && payload.scheduledAt
      ? `New scheduled ride for ${new Date(payload.scheduledAt).toLocaleString()}. Tap to view and respond.`
      : "You have received a new ride request. Tap to view and respond.";

    await this.notifications.sendToDriver({
      driverId: driver.userId,
      bookingId: payload.bookingId,
      templateKey: isScheduled ? "SCHEDULED_RIDE_OFFER" : "DISPATCH_OFFER",
      title,
      body,
      data: {
        type: "NEW_RIDE_REQUEST",
        event: "NEW_RIDE_REQUEST",
        entityType: "BOOKING",
        entityId: payload.bookingId,
        bookingId: payload.bookingId,
        requestId: payload.offerId,
        offerId: payload.offerId,
        bookingType: isScheduled ? "SCHEDULED" : "IMMEDIATE",
        isScheduled: isScheduled ? "true" : "false",
        ...(payload.scheduledAt ? { scheduledAt: payload.scheduledAt } : {}),
        screen: "ride_request",
        action: "OPEN_BOOKING",
        role: "DRIVER",
        expiresAt: payload.expiresAt,
      },
    });
  }
}
