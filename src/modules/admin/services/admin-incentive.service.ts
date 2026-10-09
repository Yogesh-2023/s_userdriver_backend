import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class AdminIncentiveService {
  async list(page: number, limit: number, filters?: { isActive?: boolean }) {
    const where: Prisma.IncentiveWhereInput = {};
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;

    const [items, total] = await prisma.$transaction([
      prisma.incentive.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.incentive.count({ where }),
    ]);
    return { items, total };
  }

  async get(incentiveId: string) {
    const incentive = await prisma.incentive.findUnique({
      where: { id: incentiveId },
      include: {
        progress: {
          take: 10,
          include: {
            driver: { include: { user: { select: { displayName: true } } } },
          },
        },
      },
    });
    if (!incentive) throw errors.notFound("Incentive not found");
    return incentive;
  }

  async create(data: any) {
    return prisma.incentive.create({ data });
  }

  async update(incentiveId: string, data: any) {
    const incentive = await prisma.incentive.findUnique({
      where: { id: incentiveId },
    });
    if (!incentive) throw errors.notFound("Incentive not found");
    return prisma.incentive.update({ where: { id: incentiveId }, data });
  }

  async delete(incentiveId: string) {
    const incentive = await prisma.incentive.findUnique({
      where: { id: incentiveId },
    });
    if (!incentive) throw errors.notFound("Incentive not found");
    return prisma.incentive.update({
      where: { id: incentiveId },
      data: { isActive: false },
    });
  }
}
