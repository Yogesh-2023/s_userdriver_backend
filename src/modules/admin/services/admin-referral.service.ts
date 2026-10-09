import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { isValidUUID } from "../admin.utils";

export class AdminReferralService {
  async list(page: number, limit: number, search?: string) {
    const where: Prisma.ReferralWhereInput = {};
    if (search) {
      where.OR = [
        ...(isValidUUID(search) ? [{ id: { equals: search } }] : []),
        { code: { contains: search, mode: "insensitive" as const } },
        {
          referrer: {
            user: {
              OR: [
                { displayName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
        {
          referred: {
            user: {
              OR: [
                { displayName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.referral.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          referrer: {
            include: {
              user: {
                select: { displayName: true, email: true },
              },
            },
          },
          referred: {
            include: {
              user: {
                select: { displayName: true, email: true },
              },
            },
          },
          _count: {
            select: { rewards: true },
          },
        },
      }),
      prisma.referral.count({ where }),
    ]);

    return { items, total };
  }

  async get(referralId: string) {
    const referral = await prisma.referral.findUnique({
      where: { id: referralId },
      include: {
        referrer: {
          include: {
            user: { select: { displayName: true, email: true } },
          },
        },
        referred: {
          include: {
            user: { select: { displayName: true, email: true } },
          },
        },
        rewards: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!referral) throw errors.notFound("Referral not found");
    return referral;
  }

  async stats() {
    const [totalReferrals, qualifiedReferrals, rewardsData] =
      await prisma.$transaction([
        prisma.referral.count(),
        prisma.referral.count({ where: { qualifiedAt: { not: null } } }),
        prisma.referralReward.aggregate({
          _sum: { amount: true },
          where: { creditedAt: { not: null } },
        }),
      ]);

    return {
      totalReferrals,
      qualifiedReferrals,
      totalRewardsCredited: rewardsData._sum.amount || 0,
    };
  }
}
