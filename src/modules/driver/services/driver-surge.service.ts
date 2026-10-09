import { PrismaClient } from "@prisma/client";
import { AppError } from "../../../common/errors";

const prisma = new PrismaClient();

export class DriverSurgeService {
  /**
   * Get the surge pricing heatmap for the driver's current or all zones
   */
  async getHeatmap() {
    // Return all service zones with their latest demand level and surge multiplier
    const zones = await prisma.serviceZone.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        polygon: true,
        demandLevel: true,
        surgePricingLogs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { multiplier: true },
        },
      },
    });

    return zones.map((zone) => ({
      zoneId: zone.id,
      name: zone.name,
      polygon: zone.polygon,
      demandLevel: zone.demandLevel,
      multiplier: zone.surgePricingLogs?.[0]?.multiplier ?? 1.0,
    }));
  }
}

export const driverSurgeService = new DriverSurgeService();
