import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class AdminZoneService {
  async listServiceAreas() {
    return prisma.serviceArea.findMany({
      include: { zones: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getServiceArea(id: string) {
    const area = await prisma.serviceArea.findUnique({
      where: { id },
      include: { zones: { include: { pricingRules: true } } },
    });
    if (!area) throw errors.notFound("Service area not found");
    return area;
  }

  async createServiceArea(data: any) {
    return prisma.serviceArea.create({ data });
  }

  async updateServiceArea(id: string, data: any) {
    return prisma.serviceArea.update({ where: { id }, data });
  }

  async listZones(serviceAreaId: string) {
    return prisma.serviceZone.findMany({
      where: { serviceAreaId },
      include: { pricingRules: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getZone(id: string) {
    const zone = await prisma.serviceZone.findUnique({
      where: { id },
      include: { pricingRules: true, serviceArea: true },
    });
    if (!zone) throw errors.notFound("Zone not found");
    return zone;
  }

  async createZone(data: any) {
    return prisma.serviceZone.create({ data });
  }

  async updateZone(id: string, data: any) {
    return prisma.serviceZone.update({ where: { id }, data });
  }
}
