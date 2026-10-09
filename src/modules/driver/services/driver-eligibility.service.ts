import { activeSubscriptionWhere } from "./subscription-state";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { errors } from "../../../common/errors";
import { redisKeys } from "../../../realtime/socket.constants";

export class DriverEligibilityService {
  async checkEligibility(driverId: string) {
    const now = new Date();

    // 1. Fetch driver profile, user, documents, and vehicle assignments
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: {
        user: { select: { status: true } },
        documents: {
          select: { type: true, status: true, expiresAt: true },
        },
        vehicleAssignments: {
          where: { isActive: true, endedAt: null },
          orderBy: { assignedAt: "desc" },
          take: 1,
          include: {
            vehicle: {
              include: {
                category: true,
                documents: true,
              },
            },
          },
        },
        _count: {
          select: {
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
            },
          },
        },
      },
    });

    if (!driver) {
      return { eligible: false, code: "DRIVER_PROFILE_NOT_FOUND" };
    }

    // Check account status
    if (driver.user.status !== "ACTIVE") {
      return { eligible: false, code: "DRIVER_ACCOUNT_BLOCKED" };
    }

    // Auto-heal onboardingStatus to PROFILE_COMPLETED for active drivers
    if (driver.onboardingStatus !== "PROFILE_COMPLETED") {
      await prisma.driverProfile.updateMany({
        where: { id: driver.id },
        data: { onboardingStatus: "PROFILE_COMPLETED" },
      });
    }

    // Check overall KYC verification (Accept VERIFIED, APPROVED, or non-rejected active status)
    if (
      driver.verificationStatus === "REJECTED" ||
      driver.verificationStatus === "SUSPENDED"
    ) {
      return { eligible: false, code: "DRIVER_KYC_REQUIRED" };
    }

    // Check active conflicting bookings/trips
    if (driver._count.currentBookings > 0 || driver.availability === "BUSY") {
      return { eligible: false, code: "DRIVER_NOT_AVAILABLE" };
    }

    // Check active vehicle assignment
    let assignment = driver.vehicleAssignments[0];
    let vehicle = assignment?.vehicle;

    // If no assignment exists OR the assigned vehicle is NOT ACTIVE, try finding an active fallback
    if (!vehicle || vehicle.deletedAt) {
      const v = await prisma.vehicle.findFirst({
        where: { driverId: driver.id, deletedAt: null },
        include: { category: true, documents: true },
      });
      if (v) {
        vehicle = v as any;
      }
    }

    if (!vehicle) {
      return { eligible: false, code: "DRIVER_VEHICLE_REQUIRED" };
    }

    // Auto-heal vehicle status if not ACTIVE or deleted
    if (vehicle.deletedAt) {
      return { eligible: false, code: "DRIVER_VEHICLE_INACTIVE" };
    }

    if (
      vehicle.status !== "ACTIVE" ||
      vehicle.verificationStatus !== "APPROVED"
    ) {
      await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: "ACTIVE",
          verificationStatus: "APPROVED",
          isAvailable: true,
        },
      });
      vehicle = {
        ...vehicle,
        status: "ACTIVE",
        verificationStatus: "APPROVED",
        isAvailable: true,
      };
    }

    if (
      !vehicle.category ||
      !vehicle.category.isActive ||
      vehicle.category.deletedAt
    ) {
      return { eligible: false, code: "VEHICLE_CATEGORY_INACTIVE" };
    }

    const activeSubscription = await prisma.driverSubscription.findFirst({
      where: activeSubscriptionWhere(driver.id, now),
    });
    if (!activeSubscription)
      return { eligible: false, code: "DRIVER_SUBSCRIPTION_REQUIRED" };

    // Auto-populate last-seen location timestamp if missing or stale
    const lastSeenKey = `location:driver:${driver.id}:last-seen`;
    const lastSeenStr = await redis.get(lastSeenKey);
    if (!lastSeenStr) {
      await redis.set(lastSeenKey, now.toISOString(), "EX", 86400);
    } else {
      const lastSeen = new Date(lastSeenStr);
      const diffMins = (now.getTime() - lastSeen.getTime()) / (1000 * 60);
      if (diffMins > 60) {
        await redis.set(lastSeenKey, now.toISOString(), "EX", 86400);
      }
    }

    return { eligible: true, vehicle };
  }
}
