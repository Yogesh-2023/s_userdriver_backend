import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { externalKycStatus } from "../driver-status";

const activeBookingStatuses = [
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
] as const;

export class DriverDashboardService {
  async getDashboard(userId: string) {
    const driver = await this.getDriver(userId);
    // Get current time and adjust to IST (+5:30)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const istTime = new Date(istNow.getTime());
    istTime.setUTCHours(0, 0, 0, 0);
    const startOfToday = new Date(istTime.getTime() - istOffset);
    const daysSinceMonday = (istNow.getUTCDay() + 6) % 7;
    const startOfWeekIst = new Date(istTime.getTime());
    startOfWeekIst.setUTCDate(startOfWeekIst.getUTCDate() - daysSinceMonday);
    const startOfWeek = new Date(startOfWeekIst.getTime() - istOffset);
    const startOfNextWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startOfLastWeek = new Date(startOfWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [
      activeBooking,
      todayTrips,
      todayEarnings,
      weekEarnings,
      lastWeekEarnings,
      performance,
      incentives,
      todayDistanceAgg,
      todayAvailabilityEvents,
      initialAvailabilityEvent,
    ] = await Promise.all([
        prisma.booking.findFirst({
          where: {
            assignedDriverId: driver.id,
            status: { in: [...activeBookingStatuses] },
          },
          include: {
            customer: {
              select: {
                user: { select: { displayName: true, phone: true } },
              },
            },
            trip: true,
            vehicleCategory: { select: { id: true, name: true } },
          },
        }),
        prisma.trip.count({
          where: {
            driverId: driver.id,
            status: "COMPLETED",
            completedAt: { gte: startOfToday },
          },
        }),
        prisma.driverEarning.aggregate({
          where: { driverId: driver.id, createdAt: { gte: startOfToday } },
          _sum: { netEarning: true },
        }),
        prisma.driverEarning.aggregate({
          where: {
            driverId: driver.id,
            createdAt: { gte: startOfWeek, lt: startOfNextWeek },
          },
          _sum: { netEarning: true },
        }),
        prisma.driverEarning.aggregate({
          where: {
            driverId: driver.id,
            createdAt: { gte: startOfLastWeek, lt: startOfWeek },
          },
          _sum: { netEarning: true },
        }),
        this.getPerformance(userId),
        prisma.driverIncentiveProgress.findMany({
          where: {
            driverId: driver.id,
            incentive: {
              isActive: true,
              validFrom: { lte: new Date() },
              validUntil: { gte: new Date() },
            },
          },
          include: { incentive: true },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
        prisma.trip.aggregate({
          where: {
            driverId: driver.id,
            status: "COMPLETED",
            completedAt: { gte: startOfToday },
          },
          _sum: { actualDistanceMeters: true },
        }),
        // Fetch all availability events from today
        prisma.driverAvailabilityHistory.findMany({
          where: {
            driverId: driver.id,
            createdAt: { gte: startOfToday },
          },
          orderBy: { createdAt: "asc" },
          select: { availability: true, createdAt: true },
        }),
        // Fetch the last event before today to know initial state
        prisma.driverAvailabilityHistory.findFirst({
          where: {
            driverId: driver.id,
            createdAt: { lt: startOfToday },
          },
          orderBy: { createdAt: "desc" },
          select: { availability: true, createdAt: true },
        }),
      ]);

    const assignedVehicle = driver.vehicleAssignments[0]?.vehicle ?? null;
    const expiringDocuments = [
      ...driver.documents.map((document) => ({
        owner: "DRIVER" as const,
        type: document.type,
        expiresAt: document.expiresAt,
      })),
      ...(assignedVehicle?.documents ?? []).map((document) => ({
        owner: "VEHICLE" as const,
        type: document.type,
        expiresAt: document.expiresAt,
      })),
    ].filter(
      ({ expiresAt }) =>
        expiresAt &&
        expiresAt <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
    );

    let todayOnlineMilliseconds = 0;
    let onlineSince = initialAvailabilityEvent?.availability !== "OFFLINE" ? startOfToday : null;

    for (const event of todayAvailabilityEvents) {
      if (event.availability !== "OFFLINE" && !onlineSince) {
        onlineSince = event.createdAt;
      } else if (event.availability === "OFFLINE" && onlineSince) {
        todayOnlineMilliseconds += event.createdAt.getTime() - onlineSince.getTime();
        onlineSince = null;
      }
    }

    if (onlineSince) {
      todayOnlineMilliseconds += Date.now() - onlineSince.getTime();
    }

    const todayDistanceMeters = Number(todayDistanceAgg._sum.actualDistanceMeters ?? 0);
    const todayOnlineSeconds = Math.floor(todayOnlineMilliseconds / 1000);
    const currentWeekEarnings = Number(weekEarnings._sum.netEarning ?? 0);
    const previousWeekEarnings = Number(lastWeekEarnings._sum.netEarning ?? 0);
    const weeklyChangePercent =
      previousWeekEarnings > 0
        ? Number(
            (
              ((currentWeekEarnings - previousWeekEarnings) /
                previousWeekEarnings) *
              100
            ).toFixed(1),
          )
        : null;

    return {
      driverId: driver.id,
      availability: driver.availability,
      activeBooking,
      assignedVehicle,
      todayTrips,
      todayDistanceMeters,
      todayOnlineSeconds,
      todayEarnings: Number(todayEarnings._sum.netEarning ?? 0),
      weekStart: startOfWeek.toISOString(),
      currentWeekEarnings,
      previousWeekEarnings,
      weeklyChangePercent,
      walletBalance: Number(driver.wallet?.balance ?? 0),
      pendingPayout: driver.settlements.reduce(
        (total, settlement) => total + Number(settlement.amount),
        0,
      ),
      performance,
      incentives,
      kycStatus: externalKycStatus(
        driver.kycSubmissions[0]?.status,
        driver.onboardingStatus,
        expiringDocuments.some(
          ({ expiresAt }) => expiresAt && expiresAt <= new Date(),
        ),
      ),
      accountStatus: driver.user.status,
      documentExpiryWarnings: expiringDocuments,
    };
  }

  async getStatistics(userId: string, startDate?: Date, endDate?: Date) {
    const driver = await this.getDriver(userId);
    const createdAt =
      startDate || endDate
        ? {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          }
        : undefined;
    const [tripGroups, earnings, assignmentGroups] = await Promise.all([
      prisma.trip.groupBy({
        by: ["status"],
        where: { driverId: driver.id, ...(createdAt ? { createdAt } : {}) },
        _count: true,
      }),
      prisma.driverEarning.aggregate({
        where: { driverId: driver.id, ...(createdAt ? { createdAt } : {}) },
        _sum: {
          grossFare: true,
          platformCommission: true,
          incentive: true,
          bonus: true,
          netEarning: true,
        },
      }),
      prisma.driverAssignment.groupBy({
        by: ["status"],
        where: { driverId: driver.id, ...(createdAt ? { createdAt } : {}) },
        _count: true,
      }),
    ]);

    return {
      trips: Object.fromEntries(
        tripGroups.map((group) => [group.status, group._count]),
      ),
      assignments: Object.fromEntries(
        assignmentGroups.map((group) => [group.status, group._count]),
      ),
      earnings: {
        grossFare: Number(earnings._sum.grossFare ?? 0),
        platformCommission: Number(earnings._sum.platformCommission ?? 0),
        incentive: Number(earnings._sum.incentive ?? 0),
        bonus: Number(earnings._sum.bonus ?? 0),
        netEarning: Number(earnings._sum.netEarning ?? 0),
      },
      range: {
        startDate: startDate?.toISOString() ?? null,
        endDate: endDate?.toISOString() ?? null,
      },
    };
  }

  async getPerformance(userId: string) {
    const driver = await this.getDriver(userId);
    const [
      offers,
      completedTrips,
      cancelledTrips,
      ratings,
      incidents,
      availabilityEvents,
      complaints,
      earnings,
    ] = await Promise.all([
      prisma.dispatchOffer.groupBy({
        by: ["status"],
        where: { driverId: driver.id },
        _count: true,
      }),
      prisma.trip.count({
        where: { driverId: driver.id, status: "COMPLETED" },
      }),
      prisma.trip.count({
        where: { driverId: driver.id, status: "CANCELLED" },
      }),
      prisma.rating.aggregate({
        where: {
          subjectUserId: driver.userId,
          subjectType: "DRIVER",
        },
        _avg: { score: true },
        _count: true,
      }),
      prisma.safetyIncident.count({
        where: {
          booking: {
            OR: [
              { assignedDriverId: driver.id },
              { trip: { driverId: driver.id } },
            ],
          },
        },
      }),
      prisma.driverAvailabilityHistory.findMany({
        where: { driverId: driver.id },
        orderBy: { createdAt: "asc" },
        select: { availability: true, createdAt: true },
      }),
      prisma.supportTicket.count({
        where: {
          booking: {
            OR: [
              { assignedDriverId: driver.id },
              { trip: { driverId: driver.id } },
            ],
          },
          category: {
            in: ["CUSTOMER_BEHAVIOUR", "SAFETY_ISSUE", "DRIVER_COMPLAINT"],
          },
        },
      }),
      prisma.driverEarning.aggregate({
        where: { driverId: driver.id },
        _sum: { netEarning: true },
      }),
    ]);
    const offerCounts = Object.fromEntries(
      offers.map((group) => [group.status, group._count]),
    ) as Record<string, number>;
    const offered =
      (offerCounts.OFFERED ?? 0) +
      (offerCounts.ACCEPTED ?? 0) +
      (offerCounts.REJECTED ?? 0) +
      (offerCounts.EXPIRED ?? 0);
    const accepted = offerCounts.ACCEPTED ?? 0;
    const totalTrips = completedTrips + cancelledTrips;
    let onlineSince: Date | null = null;
    let onlineMilliseconds = 0;
    for (const event of availabilityEvents) {
      if (event.availability !== "OFFLINE" && !onlineSince) {
        onlineSince = event.createdAt;
      } else if (event.availability === "OFFLINE" && onlineSince) {
        onlineMilliseconds += event.createdAt.getTime() - onlineSince.getTime();
        onlineSince = null;
      }
    }
    if (onlineSince) onlineMilliseconds += Date.now() - onlineSince.getTime();

    return {
      acceptanceRate: offered ? (accepted / offered) * 100 : 0,
      cancellationRate: totalTrips ? (cancelledTrips / totalTrips) * 100 : 0,
      completionRate: totalTrips ? (completedTrips / totalTrips) * 100 : 0,
      tripsCompleted: completedTrips,
      tripsCancelled: cancelledTrips,
      averageRating: Number(ratings._avg.score ?? driver.averageRating),
      ratingsCount: ratings._count,
      safetyIncidents: incidents,
      complaints,
      totalEarnings: Number(earnings._sum.netEarning ?? 0),
      onlineHours: onlineMilliseconds / 3_600_000,
    };
  }

  private async getDriver(userId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { status: true } },
        wallet: true,
        documents: {
          select: { type: true, status: true, expiresAt: true },
        },
        kycSubmissions: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { status: true },
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
        settlements: {
          where: { status: { in: ["PENDING", "PROCESSING"] } },
          select: { amount: true },
        },
      },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    return driver;
  }
}
