import { activeSubscriptionWhere } from "./subscription-state";
import { DriverAvailability } from "@prisma/client";
import { errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import { getRealtimeServer } from "../../../infrastructure/realtime";
import { redis } from "../../../infrastructure/redis";
import { REALTIME_TTL, redisKeys } from "../../../realtime/socket.constants";
import { DriverLocationService } from "./driver-location.service";
import { DriverEligibilityService } from "./driver-eligibility.service";

const activeRideStatuses = [
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
] as const;

export class DriverAvailabilityService {
  private readonly locations = new DriverLocationService();
  private readonly eligibilityService = new DriverEligibilityService();

  async getAvailability(userId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw errors.notFound("DRIVER_NOT_FOUND");
    return {
      availability: profile.availability,
      liveStatus:
        (await redis.get(redisKeys.driverAvailability(profile.id))) ?? null,
    };
  }

  async setAvailability(userId: string, availability: DriverAvailability) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("DRIVER_NOT_FOUND");
    if (availability === "BUSY") {
      throw errors.forbidden("DRIVER_NOT_ELIGIBLE");
    }
    return availability === "ONLINE"
      ? this.goOnline(driver.id)
      : this.goOffline(driver.id, "DRIVER_MANUAL_OFFLINE");
  }

  async goOnline(driverId: string) {
    if (
      !(await prisma.driverSubscription.findFirst({
        where: activeSubscriptionWhere(driverId),
        select: { id: true },
      }))
    ) {
      throw errors.forbidden("DRIVER_SUBSCRIPTION_REQUIRED");
    }
    let location = await this.locations.getByDriverId(driverId);
    if (!location) {
      location = {
        driverId,
        latitude: 28.6139,
        longitude: 77.209,
        clientTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      };
    }
    const eligibility =
      await this.eligibilityService.checkEligibility(driverId);
    if (!eligibility.eligible || !eligibility.vehicle) {
      console.log(
        `[YOGESH][DRIVER][STATUS] Warning: Eligibility check returned code ${eligibility.code ?? "none"} for driver ${driverId}, attempting active vehicle fallback`,
      );
    }

    const activeAssignment = await prisma.driverVehicleAssignment.findFirst({
      where: { driverId, isActive: true },
      select: { vehicle: { select: { id: true, categoryId: true } } },
    });

    const fallbackVehicle = activeAssignment?.vehicle ?? await prisma.vehicle.findFirst({
      where: { driverId, deletedAt: null },
      select: { id: true, categoryId: true },
    });

    const vehicleId = eligibility.vehicle?.id ?? fallbackVehicle?.id;
    const categoryId =
      eligibility.vehicle?.categoryId ?? fallbackVehicle?.categoryId;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.driverProfile.updateMany({
        where: { id: driverId },
        data: { availability: "ONLINE", onboardingStatus: "PROFILE_COMPLETED" },
      });
      await tx.driverAvailabilityHistory.create({
        data: { driverId, availability: "ONLINE" },
      });
      return tx.driverProfile.findUniqueOrThrow({ where: { id: driverId } });
    });

    console.log(
      `[YOGESH][DRIVER][STATUS] Driver ${driverId} availability updated to ONLINE in DB & Redis (Vehicle: ${vehicleId}, Category: ${categoryId})`,
    );

    const pipeline = redis.pipeline();
    pipeline.set(
      redisKeys.driverAvailability(driverId),
      JSON.stringify({
        status: "ONLINE_AVAILABLE",
        categoryId: categoryId ?? null,
        vehicleId: vehicleId ?? null,
        updatedAt: new Date().toISOString(),
      }),
      "EX",
      REALTIME_TTL.PRESENCE_SECONDS,
    );
    pipeline.set(
      redisKeys.driverPresence(driverId),
      new Date().toISOString(),
      "EX",
      REALTIME_TTL.PRESENCE_SECONDS,
    );
    pipeline.set(
      redisKeys.driverLocationLastSeen(driverId),
      new Date().toISOString(),
      "EX",
      REALTIME_TTL.LOCATION_SECONDS,
    );
    const effectiveCategoryId = categoryId;

    if (effectiveCategoryId) {
      pipeline.geoadd(
        redisKeys.categoryGeo(effectiveCategoryId),
        location.longitude,
        location.latitude,
        driverId,
      );
    }
    pipeline.sadd(redisKeys.globalOnlineDrivers, driverId);
    pipeline.srem(redisKeys.globalBusyDrivers, driverId);
    await pipeline.exec();
    if (effectiveCategoryId) {
      getRealtimeServer()
        ?.in(`driver:${driverId}`)
        .socketsJoin(`category:${effectiveCategoryId}:drivers`);
    }
    return {
      ...updated,
      liveStatus: "ONLINE_AVAILABLE",
      categoryId: effectiveCategoryId ?? null,
      vehicleId: vehicleId ?? null,
    };
  }

  async goOffline(driverId: string, reason: string) {
    const activeRide = await prisma.booking.count({
      where: {
        assignedDriverId: driverId,
        status: { in: [...activeRideStatuses] },
      },
    });
    if (activeRide) throw errors.conflict("DRIVER_NOT_AVAILABLE");
    await prisma.$transaction(async (tx) => {
      await tx.driverProfile.updateMany({
        where: { id: driverId, availability: { not: "BUSY" } },
        data: { availability: "OFFLINE" },
      });
      await tx.driverAvailabilityHistory.create({
        data: { driverId, availability: "OFFLINE", reason },
      });
    });
    await Promise.all([
      redis.del(
        redisKeys.driverAvailability(driverId),
        redisKeys.driverPresence(driverId),
      ),
      this.locations.removeFromGeo(driverId),
      redis.srem(redisKeys.globalOnlineDrivers, driverId),
      redis.srem(redisKeys.globalBusyDrivers, driverId),
    ]);
    return { id: driverId, availability: "OFFLINE" as const };
  }

  async pause(userId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true, availability: true },
    });
    if (!driver || driver.availability !== "ONLINE") {
      throw errors.forbidden("DRIVER_NOT_ONLINE");
    }

    const liveStatusStr = await redis.get(
      redisKeys.driverAvailability(driver.id),
    );
    if (!liveStatusStr) throw errors.forbidden("DRIVER_NOT_ONLINE");

    const liveStatus = JSON.parse(liveStatusStr);
    const updatedStatus = {
      ...liveStatus,
      status: "PAUSED",
      updatedAt: new Date().toISOString(),
    };

    await Promise.all([
      redis.set(
        redisKeys.driverAvailability(driver.id),
        JSON.stringify(updatedStatus),
        "EX",
        REALTIME_TTL.PRESENCE_SECONDS,
      ),
      this.locations.removeFromGeo(driver.id),
    ]);

    return { liveStatus: "PAUSED" };
  }

  async resume(userId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true, availability: true },
    });
    if (!driver || driver.availability !== "ONLINE") {
      throw errors.forbidden("DRIVER_NOT_ONLINE");
    }

    // Delegate to goOnline to recheck eligibility and add back to GEO index
    return this.goOnline(driver.id);
  }

  async markBusy(driverId: string) {
    await Promise.all([
      redis.set(
        redisKeys.driverAvailability(driverId),
        JSON.stringify({
          status: "ONLINE_BUSY",
          updatedAt: new Date().toISOString(),
        }),
        "EX",
        REALTIME_TTL.PRESENCE_SECONDS,
      ),
      this.locations.removeFromGeo(driverId),
    ]);
  }

  async restoreAvailable(driverId: string) {
    const location = await this.locations.getByDriverId(driverId);
    if (!location) {
      await prisma.driverProfile.updateMany({
        where: { id: driverId, availability: { not: "BUSY" } },
        data: { availability: "OFFLINE" },
      });
      return false;
    }
    try {
      await this.goOnline(driverId);
      return true;
    } catch {
      await prisma.driverProfile.updateMany({
        where: { id: driverId },
        data: { availability: "OFFLINE" },
      });
      await redis.del(redisKeys.driverAvailability(driverId));
      await this.locations.removeFromGeo(driverId);
      return false;
    }
  }

  async markTemporarilyUnavailable(driverId: string) {
    await redis.del(redisKeys.driverAvailability(driverId));
    await this.locations.removeFromGeo(driverId);
  }

  async eligibility(driverId: string) {
    return this.eligibilityService.checkEligibility(driverId);
  }
}
