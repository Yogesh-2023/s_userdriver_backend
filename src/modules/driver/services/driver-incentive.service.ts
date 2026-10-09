import { prisma } from "../../../database/prisma";

export class DriverIncentiveService {
  async getActiveIncentives(driverId: string) {
    const now = new Date();
    return prisma.incentive.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
      include: {
        progress: {
          where: { driverId },
        },
      },
    });
  }

  async getIncentiveHistory(driverId: string) {
    return prisma.driverIncentiveReward.findMany({
      where: { driverId },
      include: { incentive: true },
      orderBy: { issuedAt: "desc" },
    });
  }

  async getProgress(driverId: string) {
    const now = new Date();
    return prisma.driverIncentiveProgress.findMany({
      where: {
        driverId,
        incentive: {
          isActive: true,
          validFrom: { lte: now },
          validUntil: { gte: now },
        },
      },
      include: { incentive: true },
      orderBy: { updatedAt: "desc" },
    });
  }
}
