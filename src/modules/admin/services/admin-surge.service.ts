import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class AdminSurgeService {
  async list(page: number, limit: number, filters?: { isActive?: boolean }) {
    const where: Prisma.SurgePricingRuleWhereInput = {};
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;

    const [items, total] = await prisma.$transaction([
      prisma.surgePricingRule.findMany({
        where,
        include: { vehicleCategory: true },
        orderBy: { startsAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.surgePricingRule.count({ where }),
    ]);
    return { items, total };
  }

  async get(surgeId: string) {
    const surge = await prisma.surgePricingRule.findUnique({
      where: { id: surgeId },
      include: { vehicleCategory: true },
    });
    if (!surge) throw errors.notFound("Surge rule not found");
    return surge;
  }

  async create(data: any) {
    return prisma.surgePricingRule.create({ data });
  }

  async update(surgeId: string, data: any) {
    const surge = await prisma.surgePricingRule.findUnique({
      where: { id: surgeId },
    });
    if (!surge) throw errors.notFound("Surge rule not found");
    return prisma.surgePricingRule.update({ where: { id: surgeId }, data });
  }

  async delete(surgeId: string) {
    const surge = await prisma.surgePricingRule.findUnique({
      where: { id: surgeId },
    });
    if (!surge) throw errors.notFound("Surge rule not found");
    return prisma.surgePricingRule.update({
      where: { id: surgeId },
      data: { isActive: false },
    });
  }
}
