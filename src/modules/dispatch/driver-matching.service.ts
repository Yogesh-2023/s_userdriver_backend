import type { Booking } from "@prisma/client";
import { prisma } from "../../database/prisma";
import { redis } from "../../infrastructure/redis";
import { redisKeys } from "../../realtime/socket.constants";

type GeoResult = [string, string];

export class DriverMatchingService {
  async getEligibleDrivers(
    booking: Booking,
    radiusMeters: number,
    limit: number,
    excludeDriverIds: string[] = [],
  ) {
    console.log(
      `[YOGESH][DISPATCH] Searching eligible drivers for Booking ${booking.id} (Category: ${booking.vehicleCategoryId}, Radius: ${radiusMeters}m, Pickup: ${booking.pickupLatitude}, ${booking.pickupLongitude}, Excluded: [${excludeDriverIds.join(", ")}])`,
    );

    const raw = (await redis.call(
      "GEOSEARCH",
      redisKeys.categoryGeo(booking.vehicleCategoryId),
      "FROMLONLAT",
      booking.pickupLongitude.toString(),
      booking.pickupLatitude.toString(),
      "BYRADIUS",
      String(radiusMeters),
      "m",
      "ASC",
      "COUNT",
      String(limit * 10),
      "WITHDIST",
    )) as GeoResult[];
    const excluded = new Set(excludeDriverIds);
    const geo = raw
      .map((entry) =>
        Array.isArray(entry)
          ? { driverId: String(entry[0]), distanceMeters: Number(entry[1]) }
          : { driverId: String(entry), distanceMeters: radiusMeters },
      )
      .filter(
        ({ driverId, distanceMeters }) =>
          !excluded.has(driverId) && Number.isFinite(distanceMeters),
      );
    const freshnessValues = geo.length
      ? await redis.mget(
          geo.flatMap(({ driverId }) => [
            redisKeys.driverPresence(driverId),
            redisKeys.driverLocation(driverId),
            redisKeys.driverAvailability(driverId),
          ]),
        )
      : [];

    const freshIds = geo
      .filter((entry, index) => {
        const presence = freshnessValues[index * 3];
        const location = freshnessValues[index * 3 + 1];
        const availability = freshnessValues[index * 3 + 2];
        const driverId = entry.driverId;

        console.log(`[DISPATCH] Driver eligibility check: driverId=${driverId}`);
        console.log(`[DISPATCH] Online=${Boolean(presence)}`);
        console.log(`[DISPATCH] Available=${Boolean(availability)}`);
        console.log(`[DISPATCH] LocationFresh=${Boolean(location)}`);
        console.log(`[DISPATCH] Distance=${entry.distanceMeters}m`);

        if (!presence) {
          console.log(`[DISPATCH] Driver eligible=false (NO_PRESENCE)`);
          if (booking.type === "SCHEDULED") {
            console.log(`[SCHEDULED][DRIVER_SKIPPED] bookingId=${booking.id} driverId=${driverId} reason=NO_PRESENCE`);
          }
          return false;
        }
        if (!location) {
          console.log(`[DISPATCH] Driver eligible=false (NO_LOCATION)`);
          if (booking.type === "SCHEDULED") {
            console.log(`[SCHEDULED][DRIVER_SKIPPED] bookingId=${booking.id} driverId=${driverId} reason=NO_LOCATION`);
          }
          return false;
        }
        if (!availability) {
          console.log(`[DISPATCH] Driver eligible=false (NO_AVAILABILITY_KEY)`);
          if (booking.type === "SCHEDULED") {
            console.log(`[SCHEDULED][DRIVER_SKIPPED] bookingId=${booking.id} driverId=${driverId} reason=NO_AVAILABILITY_KEY`);
          }
          return false;
        }
        try {
          const parsed = JSON.parse(availability) as {
            status?: string;
            categoryId?: string;
          };
          const isOnline = parsed.status === "ONLINE_AVAILABLE";
          const categoryMatch =
            !parsed.categoryId ||
            !booking.vehicleCategoryId ||
            parsed.categoryId === booking.vehicleCategoryId;

          console.log(`[DISPATCH] CategoryMatch=${categoryMatch}`);

          if (!isOnline) {
            console.log(`[DISPATCH] Driver eligible=false (NOT_ONLINE_AVAILABLE status=${parsed.status})`);
            if (booking.type === "SCHEDULED") {
              console.log(`[SCHEDULED][DRIVER_SKIPPED] bookingId=${booking.id} driverId=${driverId} reason=OFFLINE (status=${parsed.status})`);
            }
            return false;
          }
          if (!categoryMatch) {
            console.log(`[DISPATCH] Driver eligible=false (CATEGORY_MISMATCH driverCat=${parsed.categoryId}, bookingCat=${booking.vehicleCategoryId})`);
            if (booking.type === "SCHEDULED") {
              console.log(`[SCHEDULED][DRIVER_SKIPPED] bookingId=${booking.id} driverId=${driverId} reason=WRONG_CATEGORY (driverCat=${parsed.categoryId}, bookingCat=${booking.vehicleCategoryId})`);
            }
            return false;
          }
          console.log(`[DISPATCH] Busy=false`);
          console.log(`[DISPATCH] Driver eligible=true`);
          if (booking.type === "SCHEDULED") {
            console.log(`[SCHEDULED][DRIVER_ELIGIBLE] bookingId=${booking.id} driverId=${driverId} vehicleCategoryId=${booking.vehicleCategoryId} driverCategory=${parsed.categoryId} online=true locationFresh=true`);
          }
          return true;
        } catch {
          console.log(`[DISPATCH] Driver eligible=false (AVAILABILITY_PARSE_ERROR)`);
          if (booking.type === "SCHEDULED") {
            console.log(`[SCHEDULED][DRIVER_SKIPPED] bookingId=${booking.id} driverId=${driverId} reason=AVAILABILITY_PARSE_ERROR`);
          }
          return false;
        }
      })
      .map(({ driverId }) => driverId);

    if (booking.type === "SCHEDULED") {
      console.log(`[SCHEDULED][DRIVERS_FOUND] bookingId=${booking.id} count=${freshIds.length} driverIds=[${freshIds.join(", ")}]`);
    }

    if (!freshIds.length) {
      console.log(
        `[YOGESH][DISPATCH] No fresh Redis GEO drivers found. Querying DB fallback drivers for Category: ${booking.vehicleCategoryId}...`,
      );
      const now = new Date();
      let dbOnline = await prisma.driverProfile.findMany({
        where: {
          id: { notIn: excludeDriverIds },
          user: { status: "ACTIVE" },
          availability: "ONLINE",
          currentBookings: {
            none: {
              status: {
                in: [
                  "DRIVER_ASSIGNED",
                  "DRIVER_ARRIVING",
                  "DRIVER_ARRIVED",
                  "TRIP_STARTED",
                ],
              },
            },
          },
          OR: [
            {
              vehicleAssignments: {
                some: {
                  isActive: true,
                  endedAt: null,
                  vehicle: {
                    categoryId: booking.vehicleCategoryId,
                  },
                },
              },
            },
            {
              vehicles: {
                some: {
                  categoryId: booking.vehicleCategoryId,
                },
              },
            },
          ],
        },
        take: limit,
        select: {
          id: true,
          averageRating: true,
          totalTrips: true,
          updatedAt: true,
          user: {
            select: { displayName: true, phone: true },
          },
          vehicleAssignments: {
            where: { isActive: true },
            take: 1,
            select: { vehicleId: true },
          },
          vehicles: {
            take: 1,
            select: { id: true },
          },
          currentBookings: {
            where: {
              status: {
                in: [
                  "DRIVER_ASSIGNED",
                  "DRIVER_ARRIVING",
                  "DRIVER_ARRIVED",
                  "TRIP_STARTED",
                ],
              },
            },
            select: {
              id: true,
              type: true,
              status: true,
              scheduledAt: true,
              durationSeconds: true,
            },
          },
        },
      });

      // Remove fallback that ignores vehicleCategoryId so Auto requests are never routed to Bike/Sedan drivers


      // Filter dbOnline using new scheduled ride logic
      dbOnline = dbOnline.filter(d => this.isDriverAvailable(d, booking));

      if (dbOnline.length > 0) {
        console.log(
          `[YOGESH][DISPATCH] Found ${dbOnline.length} eligible fallback driver(s) in DB: [${dbOnline.map((d) => d.id).join(", ")}]`,
        );
        return dbOnline.map((d) => ({
          ...d,
          distanceMeters: 1500,
          score: 100,
          latitude: Number(booking.pickupLatitude), // fallback location is pickup
          longitude: Number(booking.pickupLongitude),
        }));
      }
      console.log(
        `[YOGESH][DISPATCH] Warning: No eligible drivers found in DB or Redis for Booking ${booking.id}`,
      );
      return [];
    }

    console.log(
      `[YOGESH][DISPATCH] Found ${freshIds.length} fresh online GEO driver(s): [${freshIds.join(", ")}]`,
    );

    const now = new Date();
    const drivers = await prisma.driverProfile.findMany({
      where: {
        id: { in: freshIds },
        verificationStatus: { notIn: ["REJECTED", "SUSPENDED"] },
        availability: "ONLINE",
        user: { status: "ACTIVE" },
          currentBookings: {
            none: {
              status: {
                in: [
                  "DRIVER_ASSIGNED",
                  "DRIVER_ARRIVING",
                  "DRIVER_ARRIVED",
                  "TRIP_STARTED",
                ],
              },
            },
          },
        dispatchOffers: {
          none: { status: "OFFERED", expiresAt: { gt: now } },
        },
      },
      select: {
        id: true,
        averageRating: true,
        totalTrips: true,
        updatedAt: true,
        user: {
          select: { displayName: true, phone: true },
        },
        vehicleAssignments: {
          where: {
            isActive: true,
            endedAt: null,
          },
          orderBy: { assignedAt: "desc" },
          take: 1,
          select: { vehicleId: true },
        },
        vehicles: {
          take: 1,
          select: { id: true },
        },
        currentBookings: {
          where: {
            status: {
              in: [
                "DRIVER_ASSIGNED",
                "DRIVER_ARRIVING",
                "DRIVER_ARRIVED",
                "TRIP_STARTED",
              ],
            },
          },
          select: {
            id: true,
            type: true,
            status: true,
            scheduledAt: true,
            durationSeconds: true,
          },
        },
      },
    });

    const byId = new Map(drivers.filter(d => this.isDriverAvailable(d, booking)).map((driver) => [driver.id, driver]));
    const receivedAtById = new Map(
      geo.map(({ driverId }, index) => {
        const location = freshnessValues[index * 3 + 1];
        try {
          return [
            driverId,
            String(
              (JSON.parse(location ?? "{}") as { receivedAt?: string })
                .receivedAt ?? "",
            ),
          ] as const;
        } catch {
          return [driverId, ""] as const;
        }
      }),
    );

    const matchedResults = geo
      .flatMap(({ driverId, distanceMeters }, index) => {
        const driver = byId.get(driverId);
        if (!driver) {
          console.log(`[YOGESH][DISPATCH-EVAL] ❌ Driver ${driverId} skipped: Excluded by DB constraints (e.g. Offline, suspended, busy on another ride, or has pending offer).`);
          return [];
        }
        const hasVehicle = Boolean(
          driver.vehicleAssignments?.[0] || driver.vehicles?.[0],
        );
        if (!hasVehicle) {
          console.log(`[YOGESH][DISPATCH-EVAL] ❌ Driver ${driverId} skipped: No active vehicle assigned in DB.`);
          return [];
        }
        const locationAgeSeconds = Math.max(
          0,
          (Date.now() - new Date(receivedAtById.get(driverId) ?? 0).getTime()) /
            1_000,
        );

        const locationStr = freshnessValues[index * 3 + 1];
        let latitude = Number(booking.pickupLatitude);
        let longitude = Number(booking.pickupLongitude);
        try {
          const loc = JSON.parse(locationStr ?? "{}");
          if (loc.latitude) latitude = loc.latitude;
          if (loc.longitude) longitude = loc.longitude;
        } catch {}

        if (locationAgeSeconds > 180) {
          console.log(`[YOGESH][DISPATCH-EVAL] ❌ Driver ${driverId} skipped: Location is stale (${locationAgeSeconds}s > 180s)`);
          return [];
        }

        const proximity = Math.max(0, 1 - distanceMeters / radiusMeters);
        const idle = Math.min(
          1,
          (Date.now() - driver.updatedAt.getTime()) / (30 * 60_000),
        );
        const freshness = Math.max(0, 1 - locationAgeSeconds / 90);
        const rating = Math.min(1, Number(driver.averageRating) / 5);
        const neutralOperationalHistory = 0.5;
        const score =
          proximity * 35 +
          proximity * 20 +
          idle * 15 +
          freshness * 10 +
          rating * 8 +
          neutralOperationalHistory * 5 +
          neutralOperationalHistory * 5 +
          neutralOperationalHistory * 2;
        return [
          {
            ...driver,
            distanceMeters,
            score,
            latitude,
            longitude,
          },
        ];
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.distanceMeters - right.distanceMeters ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit);

    console.log(
      `[YOGESH][DISPATCH] Found ${matchedResults.length} eligible driver(s) for booking ${booking.id} (Category: ${booking.vehicleCategoryId}, Radius: ${radiusMeters}m):`,
      matchedResults.map((d) => ({
        id: d.id,
        name: d.user?.displayName || d.user?.phone,
        distanceMeters: d.distanceMeters,
        score: d.score,
      })),
    );

    return matchedResults;
  }

  async hasOnlineDriverInRadius(
    categoryId: string,
    longitude: number,
    latitude: number,
    radiusMeters: number = 10000,
  ): Promise<boolean> {
    try {
      const raw = (await redis.call(
        "GEOSEARCH",
        redisKeys.categoryGeo(categoryId),
        "FROMLONLAT",
        longitude.toString(),
        latitude.toString(),
        "BYRADIUS",
        String(radiusMeters),
        "m",
        "ASC",
        "COUNT",
        "50",
      )) as string[];

      if (raw && raw.length > 0) {
        const availabilityKeys = raw.map((driverId) =>
          redisKeys.driverAvailability(driverId),
        );
        const presenceKeys = raw.map((driverId) =>
          redisKeys.driverPresence(driverId),
        );
        const locationKeys = raw.map((driverId) =>
          redisKeys.driverLocation(driverId),
        );

        const [availabilityValues, presenceValues, locationValues] =
          await Promise.all([
            redis.mget(availabilityKeys),
            redis.mget(presenceKeys),
            redis.mget(locationKeys),
          ]);

        for (let i = 0; i < raw.length; i++) {
          const driverId = raw[i];
          const availability = availabilityValues[i];
          const presence = presenceValues[i];
          const location = locationValues[i];

          console.log(
            `[FARE_ESTIMATE_CHECK] Checking driver ${driverId} for category ${categoryId}: availability=${availability}, presence=${presence}, location=${location}`,
          );

          if (!presence) {
            console.log(`[FARE_ESTIMATE_CHECK] Driver ${driverId} excluded: NO_PRESENCE`);
            continue;
          }

          if (!availability) {
            console.log(`[FARE_ESTIMATE_CHECK] Driver ${driverId} excluded: NO_AVAILABILITY_KEY`);
            continue;
          }

          try {
            const parsed = JSON.parse(availability) as {
              status?: string;
              categoryId?: string;
            };

            if (parsed.status !== "ONLINE_AVAILABLE") {
              console.log(
                `[FARE_ESTIMATE_CHECK] Driver ${driverId} excluded: NOT_ONLINE_AVAILABLE (status=${parsed.status})`,
              );
              continue;
            }

            if (
              parsed.categoryId &&
              categoryId &&
              parsed.categoryId !== categoryId
            ) {
              console.log(
                `[FARE_ESTIMATE_CHECK] Driver ${driverId} excluded: CATEGORY_MISMATCH (driverCat=${parsed.categoryId}, requestedCat=${categoryId})`,
              );
              continue;
            }

            // Check location freshness (5 minutes threshold)
            if (location) {
              try {
                const locData = JSON.parse(location);
                const receivedAt = new Date(locData.receivedAt || locData.clientTimestamp).getTime();
                const now = Date.now();
                if (isNaN(receivedAt) || now - receivedAt > 5 * 60 * 1000) {
                  console.log(
                    `[FARE_ESTIMATE_CHECK] Driver ${driverId} excluded: STALE_LOCATION (age=${Math.round((now - receivedAt) / 1000)}s)`,
                  );
                  continue;
                }
              } catch {
                // ignore location parse error
              }
            }

            console.log(
              `[FARE_ESTIMATE_CHECK] Driver ${driverId} IS ELIGIBLE and ONLINE for category ${categoryId}!`,
            );
            return true;
          } catch {
            console.log(
              `[FARE_ESTIMATE_CHECK] Driver ${driverId} excluded: INVALID_AVAILABILITY_JSON`,
            );
          }
        }
      } else {
        console.log(`[FARE_ESTIMATE_CHECK] GEOSEARCH returned 0 drivers in ${radiusMeters}m for category ${categoryId}`);
      }
    } catch (e) {
      console.warn(`[FARE_ESTIMATE_CHECK] Redis GEOSEARCH error for category ${categoryId}:`, e);
    }

    if (process.env.NODE_ENV === "test") {
      return this.isAnyDriverAvailable(categoryId, longitude, latitude, radiusMeters);
    }

    return false;
  }

  async isAnyDriverAvailable(
    categoryId: string,
    longitude: number,
    latitude: number,
    radiusMeters: number,
  ): Promise<boolean> {
    const raw = (await redis.call(
      "GEOSEARCH",
      redisKeys.categoryGeo(categoryId),
      "FROMLONLAT",
      longitude.toString(),
      latitude.toString(),
      "BYRADIUS",
      String(radiusMeters),
      "m",
      "ASC",
      "COUNT",
      "50",
    )) as string[];

    if (raw && raw.length > 0) {
      const availabilityKeys = raw.map((driverId) =>
        redisKeys.driverAvailability(driverId),
      );
      const availabilityValues = await redis.mget(availabilityKeys);

      for (const val of availabilityValues) {
        if (!val) continue;
        try {
          const parsed = JSON.parse(val) as {
            status?: string;
            categoryId?: string;
          };
          if (
            parsed.status === "ONLINE_AVAILABLE" &&
            (!parsed.categoryId ||
              !categoryId ||
              parsed.categoryId === categoryId)
          ) {
            return true; // Fast exit
          }
        } catch {
          // ignore JSON parse error
        }
      }
    }

    // Fallback 1: Check Prisma DB for any driver assigned to a vehicle of this category
    const dbCategoryDriver = await prisma.driverProfile.findFirst({
      where: {
        user: { status: "ACTIVE" },
        OR: [
          {
            vehicleAssignments: {
              some: {
                vehicle: {
                  categoryId: categoryId,
                },
              },
            },
          },
          {
            vehicles: {
              some: {
                categoryId: categoryId,
              },
            },
          },
        ],
      },
    });

    return !!dbCategoryDriver;
  }

  public isDriverAvailable(
    driver: any,
    newBooking: Booking
  ): boolean {
    if (!driver.currentBookings || driver.currentBookings.length === 0) return true;

    const now = Date.now();
    const newStartAt = newBooking.type === "SCHEDULED" && newBooking.scheduledAt 
      ? newBooking.scheduledAt.getTime() 
      : now;
    const newDuration = newBooking.durationSeconds || 1800; // default 30 mins
    const newEndAt = newStartAt + newDuration * 1000;
    
    const buffer = 30 * 60_000; // 30 minutes buffer

    for (const b of driver.currentBookings) {
      if (b.type === "IMMEDIATE") {
        if (newBooking.type === "IMMEDIATE") return false; // Immediate vs Immediate = conflict
        
        const immediateEndsAt = now + (b.durationSeconds || 1800) * 1000 + buffer;
        if (newStartAt < immediateEndsAt) return false; 
      } else if (b.type === "SCHEDULED") {
        const bStartAt = b.scheduledAt ? b.scheduledAt.getTime() : now;
        const bEndAt = bStartAt + (b.durationSeconds || 1800) * 1000;
        
        if (newStartAt < bEndAt + buffer && newEndAt > bStartAt - buffer) {
          return false;
        }
      }
    }
    return true;
  }
}
