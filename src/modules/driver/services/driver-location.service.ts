import { errors } from "../../../common/errors";
import { distanceMeters } from "../../../common/geo";
import { getEta } from "../../../integrations/maps";
import { env } from "../../../config/env";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { REALTIME_TTL, redisKeys } from "../../../realtime/socket.constants";

export type DriverLocationUpdate = {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  timestamp: Date;
  sequence?: number;
  tripId?: string;
};

export type StoredDriverLocation = {
  driverId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  clientTimestamp: string;
  receivedAt: string;
  sequence?: number;
  tripId?: string;
};

export class DriverLocationService {
  async updateLocation(userId: string, data: DriverLocationUpdate) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("DRIVER_NOT_FOUND");
    return this.updateLocationByDriverId(driver.id, data);
  }

  async updateLocationByDriverId(driverId: string, data: DriverLocationUpdate) {
    this.validate(data);
    if (data.tripId) {
      const owned = await prisma.trip.count({
        where: {
          id: data.tripId,
          driverId,
          status: {
            in: ["CREATED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "STARTED"],
          },
        },
      });
      if (!owned) throw errors.forbidden("TRIP_ACCESS_DENIED");
    }

    const locationKey = redisKeys.driverLocation(driverId);
    const previousRaw = await redis.get(locationKey);
    const previous = this.parse(previousRaw);
    if (
      previous &&
      Date.now() - new Date(previous.receivedAt).getTime() <
        1_000 / env.SOCKET_LOCATION_RATE_LIMIT_PER_SECOND
    ) {
      throw errors.rateLimited("LOCATION_UPDATE_RATE_LIMITED");
    }
    console.log(
      `[YOGESH][LOCATION] Received update for driver ${driverId} -> Lat: ${data.latitude}, Lng: ${data.longitude}, Sequence: ${data.sequence ?? "none"}, PrevSeq: ${previous?.sequence ?? "none"}, ClientTime: ${data.timestamp.toISOString()}, ServerTime: ${new Date().toISOString()}`,
    );

    if (
      data.sequence !== undefined &&
      previous?.sequence !== undefined &&
      data.sequence < previous.sequence &&
      data.sequence !== 1
    ) {
      console.log(
        `[YOGESH][LOCATION] Warning: Out of order sequence received (${data.sequence} < ${previous.sequence}). Adjusting sequence.`,
      );
      data.sequence = previous.sequence + 1;
    }
    if (previous) this.validateJump(previous, data);

    const receivedAt = new Date();
    const update: StoredDriverLocation = {
      driverId,
      latitude: data.latitude,
      longitude: data.longitude,
      heading: data.heading,
      speed: data.speed,
      accuracy: data.accuracy,
      clientTimestamp: data.timestamp.toISOString(),
      receivedAt: receivedAt.toISOString(),
      sequence: data.sequence,
      tripId: data.tripId,
    };

    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: {
        availability: true,
        vehicleAssignments: {
          where: { isActive: true },
          take: 1,
          select: {
            vehicle: {
              select: {
                categoryId: true,
                status: true,
                verificationStatus: true,
                category: { select: { isActive: true } },
              },
            },
          },
        },
        vehicles: {
          take: 1,
          select: {
            categoryId: true,
            status: true,
            verificationStatus: true,
            category: { select: { isActive: true } },
          },
        },
      },
    });
    if (!driver) throw errors.notFound("DRIVER_NOT_FOUND");

    const pipeline = redis.pipeline();
    pipeline.set(
      locationKey,
      JSON.stringify(update),
      "EX",
      REALTIME_TTL.LOCATION_SECONDS,
    );
    pipeline.set(
      redisKeys.driverLocationLastSeen(driverId),
      update.receivedAt,
      "EX",
      REALTIME_TTL.LOCATION_SECONDS,
    );
    if (data.sequence !== undefined) {
      pipeline.set(
        redisKeys.driverLocationSequence(driverId),
        String(data.sequence),
        "EX",
        REALTIME_TTL.LOCATION_SECONDS,
      );
    }
    pipeline.set(
      redisKeys.driverPresence(driverId),
      update.receivedAt,
      "EX",
      REALTIME_TTL.PRESENCE_SECONDS,
    );

    const vehicle = driver.vehicleAssignments[0]?.vehicle ?? driver.vehicles[0];
    if (
      driver.availability === "ONLINE" &&
      vehicle &&
      (vehicle.status === "ACTIVE" || (vehicle as any).status === "PENDING") &&
      (vehicle.verificationStatus === "APPROVED" || (vehicle as any).verificationStatus === "PENDING" || (vehicle as any).verificationStatus === "VERIFIED")
    ) {
      if (vehicle.categoryId) {
        pipeline.geoadd(
          redisKeys.categoryGeo(vehicle.categoryId),
          data.longitude,
          data.latitude,
          driverId,
        );
      }
      pipeline.set(
        redisKeys.driverAvailability(driverId),
        JSON.stringify({
          status: "ONLINE_AVAILABLE",
          categoryId: vehicle.categoryId ?? null,
          updatedAt: update.receivedAt,
        }),
        "EX",
        REALTIME_TTL.PRESENCE_SECONDS,
      );
    }
    if (data.tripId) {
      pipeline.set(
        redisKeys.tripLive(data.tripId),
        JSON.stringify(update),
        "EX",
        REALTIME_TTL.TRIP_SECONDS,
      );
      pipeline.set(
        redisKeys.tripLastLocation(data.tripId),
        JSON.stringify(update),
        "EX",
        REALTIME_TTL.TRIP_SECONDS,
      );
    }

    if (await this.shouldSample(driverId, previous, update)) {
      pipeline.rpush("tracking:persist-buffer", JSON.stringify(update));
      pipeline.ltrim("tracking:persist-buffer", -100_000, -1);
      pipeline.set(
        redisKeys.driverLocationSample(driverId),
        JSON.stringify(update),
        "EX",
        REALTIME_TTL.TRIP_SECONDS,
      );
    }
    await pipeline.exec();
    const ride = await this.resolveActiveRide(driverId, data.tripId);
    let eta = null;

    if (ride) {
      const etaKey = `trip:eta:${ride.id}`;
      const cachedEta = await redis.get(etaKey);

      if (cachedEta) {
        try {
          eta = JSON.parse(cachedEta);
        } catch {
          /* ignore */
        }
      } else {
        // Calculate new ETA
        const origin = {
          latitude: update.latitude,
          longitude: update.longitude,
        };
        let destination = null;
        let type = "PICKUP";

        if (ride.status === "CREATED" || ride.status === "DRIVER_ARRIVING") {
          destination = {
            latitude: Number(ride.booking.pickupLatitude),
            longitude: Number(ride.booking.pickupLongitude),
          };
        } else if (ride.status === "STARTED") {
          destination = {
            latitude: Number(ride.booking.dropLatitude),
            longitude: Number(ride.booking.dropLongitude),
          };
          type = "DESTINATION";
        }

        if (destination) {
          try {
            const calculated = await getEta(origin, destination);
            eta = { ...calculated, type };
            await redis.set(etaKey, JSON.stringify(eta), "EX", 30); // 30 seconds throttle
          } catch (error) {
            // Ignore ETA fetch errors to not fail the location update
          }
        }
      }
    }

    let nearbySearchingBookings: string[] = [];
    if (!ride && driver.availability === "ONLINE" && vehicle?.categoryId) {
      try {
        nearbySearchingBookings = (await redis.call(
          "GEOSEARCH",
          `category:${vehicle.categoryId}:searching_bookings`,
          "FROMLONLAT",
          data.longitude.toString(),
          data.latitude.toString(),
          "BYRADIUS",
          "5000",
          "m",
        )) as string[];
      } catch (error) {
        // Ignore errors if the key doesn't exist or is not a geo index
      }
    }

    return { ...update, ride, eta, nearbySearchingBookings };
  }

  async resolveActiveRide(driverId: string, tripId?: string) {
    if (tripId) {
      const trip = await prisma.trip.findFirst({
        where: {
          id: tripId,
          driverId,
          status: {
            in: ["CREATED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "STARTED"],
          },
        },
        select: {
          id: true,
          bookingId: true,
          status: true,
          booking: {
            select: {
              pickupLatitude: true,
              pickupLongitude: true,
              dropLatitude: true,
              dropLongitude: true,
            },
          },
        },
      });
      return trip;
    }
    return prisma.trip.findFirst({
      where: {
        driverId,
        status: {
          in: ["CREATED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "STARTED"],
        },
      },
      select: {
        id: true,
        bookingId: true,
        status: true,
        booking: {
          select: {
            pickupLatitude: true,
            pickupLongitude: true,
            dropLatitude: true,
            dropLongitude: true,
          },
        },
      },
    });
  }

  async getCurrentLocation(userId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("DRIVER_NOT_FOUND");
    return this.getByDriverId(driver.id);
  }

  async getByDriverId(driverId: string) {
    return this.parse(await redis.get(redisKeys.driverLocation(driverId)));
  }

  async getFreshByDriverId(driverId: string, maxAgeSeconds = 300) {
    const location = await this.getByDriverId(driverId);
    
    // TEMPORARY LOGGING FOR DEBUGGING
    const serverTime = Date.now();
    const lastLocationAt = location ? new Date(location.receivedAt).getTime() : 0;
    const ageSeconds = location ? (serverTime - lastLocationAt) / 1000 : -1;
    console.log(`[YOGESH][STALE-CHECK] driverId=${driverId}, maxAge=${maxAgeSeconds}s, hasLocation=${!!location}, ageSeconds=${ageSeconds}, serverTime=${new Date().toISOString()}`);
    if (location) {
      console.log(`[YOGESH][STALE-CHECK] lat=${location.latitude}, lng=${location.longitude}, lastLocationAt=${location.receivedAt}`);
    }

    if (
      !location ||
      serverTime - lastLocationAt > maxAgeSeconds * 1_000
    ) {
      console.log(`[YOGESH][STALE-CHECK] ❌ THROWING DRIVER_LOCATION_STALE for driverId=${driverId}`);
      throw errors.conflict("DRIVER_LOCATION_STALE");
    }
    return location;
  }

  async removeFromGeo(driverId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: {
        vehicleAssignments: {
          where: { isActive: true },
          select: { vehicle: { select: { categoryId: true } } },
        },
        vehicles: {
          where: { deletedAt: null },
          select: { categoryId: true },
        },
      },
    });

    if (!driver) return;

    const categoryIds = new Set<string>();
    for (const a of driver.vehicleAssignments) {
      if (a.vehicle?.categoryId) categoryIds.add(a.vehicle.categoryId);
    }
    if (categoryIds.size === 0) {
      for (const v of driver.vehicles) {
        if (v.categoryId) categoryIds.add(v.categoryId);
      }
    }

    if (categoryIds.size === 0) return;

    await redis
      .pipeline(
        Array.from(categoryIds).map((categoryId) => [
          "zrem",
          redisKeys.categoryGeo(categoryId),
          driverId,
        ]),
      )
      .exec();
  }

  private validate(data: DriverLocationUpdate) {
    if (
      !Number.isFinite(data.latitude) ||
      data.latitude < -90 ||
      data.latitude > 90 ||
      !Number.isFinite(data.longitude) ||
      data.longitude < -180 ||
      data.longitude > 180 ||
      (data.heading !== undefined &&
        (!Number.isFinite(data.heading) ||
          data.heading < 0 ||
          data.heading > 360)) ||
      (data.speed !== undefined &&
        (!Number.isFinite(data.speed) || data.speed < 0 || data.speed > 90)) ||
      (data.accuracy !== undefined &&
        (!Number.isFinite(data.accuracy) ||
          data.accuracy < 0 ||
          data.accuracy > 2_000))
    ) {
      throw errors.badRequest("SOCKET_INVALID_PAYLOAD");
    }
    const timestamp = data.timestamp.getTime();
    const now = Date.now();
    if (
      !Number.isFinite(timestamp) ||
      timestamp < now - 300_000 ||
      timestamp > now + 300_000
    ) {
      console.log(
        `[YOGESH][LOCATION] timestamp received: ${data.timestamp.toISOString()}, server time: ${new Date().toISOString()}, sequence received: ${data.sequence ?? "none"}, stale reason: Timestamp drift (${Math.abs(now - (timestamp || 0))}ms). Normalizing timestamp to server time.`,
      );
      data.timestamp = new Date();
    }
  }

  private validateJump(
    previous: StoredDriverLocation,
    current: DriverLocationUpdate,
  ) {
    const seconds = Math.max(
      0.25,
      (Date.now() - new Date(previous.receivedAt).getTime()) / 1_000,
    );
    const distance = distanceMeters(previous, current);
    const accuracyAllowance =
      (previous.accuracy ?? 0) + (current.accuracy ?? 0) + 100;
    if (distance > seconds * 100 + accuracyAllowance) {
      console.log(
        `[YOGESH][LOCATION] timestamp received: ${current.timestamp.toISOString()}, server time: ${new Date().toISOString()}, sequence received: ${current.sequence ?? "none"}, previous sequence: ${previous.sequence ?? "none"}, stale reason: Speed/distance jump limit exceeded (${distance.toFixed(0)}m in ${seconds.toFixed(1)}s). Accepting update and resetting baseline.`,
      );
    }
  }

  private async shouldSample(
    driverId: string,
    previous: StoredDriverLocation | null,
    current: StoredDriverLocation,
  ) {
    const sampled = this.parse(
      await redis.get(redisKeys.driverLocationSample(driverId)),
    );
    if (!sampled) return true;
    if (
      Date.now() - new Date(sampled.receivedAt).getTime() >=
      REALTIME_TTL.LOCATION_SAMPLE_SECONDS * 1_000
    ) {
      return true;
    }
    return distanceMeters(sampled, current) >= 50 && previous !== null;
  }

  private parse(value: string | null): StoredDriverLocation | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as StoredDriverLocation;
      return typeof parsed.receivedAt === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
}
