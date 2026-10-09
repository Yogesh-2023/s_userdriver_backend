import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { isValidUUID } from "../admin.utils";
import { parse } from "../../../common/validation";
import * as schemas from "../admin.validation";

export class AdminCouponService {
  async list(
    page: number,
    limit: number,
    filters?: { isActive?: boolean; search?: string },
  ) {
    const where: Prisma.CouponWhereInput = {};
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    if (filters?.search) {
      where.OR = [
        ...(isValidUUID(filters.search)
          ? [{ id: { equals: filters.search } }]
          : []),
        { code: { contains: filters.search, mode: "insensitive" as const } },
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.coupon.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.coupon.count({ where }),
    ]);
    return { items, total };
  }

  async get(couponId: string) {
    const coupon = await prisma.coupon.findUnique({
      where: { id: couponId },
      include: {
        usages: {
          include: {
            customer: {
              select: { id: true, user: { select: { displayName: true } } },
            },
          },
          take: 10,
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!coupon) throw errors.notFound("Coupon not found");
    return coupon;
  }

  async usageStats(couponId: string) {
    const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw errors.notFound("Coupon not found");

    const [totalRedemptions, aggregate, uniqueCustomers] =
      await prisma.$transaction([
        prisma.couponUsage.count({ where: { couponId } }),
        prisma.couponUsage.aggregate({
          where: { couponId },
          _sum: { discount: true },
        }),
        prisma.couponUsage.findMany({
          where: { couponId },
          distinct: ["customerId"],
          select: { customerId: true },
        }),
      ]);

    return {
      couponId,
      code: coupon.code,
      totalRedemptions,
      uniqueCustomers: uniqueCustomers.length,
      totalDiscount: aggregate._sum.discount ?? 0,
      remainingUses:
        coupon.maxUses === null
          ? null
          : Math.max(coupon.maxUses - totalRedemptions, 0),
    };
  }

  async redemptions(couponId: string, page: number, limit: number) {
    const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw errors.notFound("Coupon not found");

    const [items, total] = await prisma.$transaction([
      prisma.couponUsage.findMany({
        where: { couponId },
        include: {
          customer: {
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
          booking: {
            select: {
              id: true,
              status: true,
              estimatedFare: true,
              finalFare: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.couponUsage.count({ where: { couponId } }),
    ]);
    return { items, total };
  }

  async bulkGenerate(input: any) {
    const parsed = parse(
      z
        .object({
          count: z.coerce.number().int().min(1).max(100),
          prefix: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z0-9_]{2,20}$/),
          discountType: z.enum(["PERCENTAGE", "FIXED"]),
          discountValue: z.coerce.number().nonnegative().max(10_000_000),
          maxDiscount: z.coerce
            .number()
            .nonnegative()
            .max(10_000_000)
            .nullable()
            .optional(),
          minimumFare: z.coerce
            .number()
            .nonnegative()
            .max(10_000_000)
            .default(0),
          maxUses: z.coerce.number().int().positive().nullable().optional(),
          maxUsesPerUser: z.coerce.number().int().positive().default(1),
          validFrom: z.coerce.date(),
          validUntil: z.coerce.date(),
          categoryId: z.string().uuid().nullable().optional(),
          serviceAreaId: z.string().uuid().nullable().optional(),
          newUsersOnly: z.boolean().default(false),
          isActive: z.boolean().default(true),
        })
        .refine((data) => data.validUntil > data.validFrom, {
          message: "validUntil must be after validFrom",
          path: ["validUntil"],
        }),
      input,
    );

    const now = Date.now().toString(36).toUpperCase();
    const data = Array.from({ length: parsed.count }, (_, index) => ({
      code: `${parsed.prefix}${now}${String(index + 1).padStart(3, "0")}`,
      discountType: parsed.discountType,
      discountValue: parsed.discountValue,
      maxDiscount: parsed.maxDiscount,
      minimumFare: parsed.minimumFare,
      maxUses: parsed.maxUses,
      maxUsesPerUser: parsed.maxUsesPerUser,
      validFrom: parsed.validFrom,
      validUntil: parsed.validUntil,
      categoryId: parsed.categoryId,
      serviceAreaId: parsed.serviceAreaId,
      newUsersOnly: parsed.newUsersOnly,
      isActive: parsed.isActive,
    }));

    await prisma.coupon.createMany({ data });
    return prisma.coupon.findMany({
      where: { code: { in: data.map((item) => item.code) } },
      orderBy: { code: "asc" },
    });
  }

  async create(data: any) {
    const parsed = parse(schemas.couponCreate, data);

    const existing = await prisma.coupon.findUnique({
      where: { code: parsed.code },
    });
    if (existing) throw errors.conflict("Coupon code already exists");

    return prisma.coupon.create({ data: parsed });
  }

  async update(couponId: string, data: any) {
    const parsed = parse(schemas.couponUpdate, data);

    const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw errors.notFound("Coupon not found");

    if (parsed.code && parsed.code !== coupon.code) {
      const existing = await prisma.coupon.findUnique({
        where: { code: parsed.code },
      });
      if (existing) throw errors.conflict("Coupon code already exists");
    }

    return prisma.coupon.update({ where: { id: couponId }, data: parsed });
  }

  async delete(couponId: string) {
    const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw errors.notFound("Coupon not found");

    return prisma.coupon.update({
      where: { id: couponId },
      data: { isActive: false },
    });
  }
}
