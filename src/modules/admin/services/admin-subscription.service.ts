import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { Prisma } from "@prisma/client";
import { isValidUUID } from "../admin.utils";

export class AdminSubscriptionService {
  async createPlan(data: {
    name: string;
    description?: string;
    price: number;
    durationValue: number;
    durationType: "DAILY" | "WEEKLY" | "MONTHLY";
    tripType: "LIMITED" | "UNLIMITED";
    numberOfTrips?: number;
    gstOrTax?: number;
    isActive?: boolean;
  }) {
    return prisma.subscriptionPlan.create({
      data,
    });
  }

  async updatePlan(id: string, data: Prisma.SubscriptionPlanUpdateInput) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) throw errors.notFound("Subscription plan not found");

    return prisma.subscriptionPlan.update({
      where: { id },
      data,
    });
  }

  async getPlans() {
    return prisma.subscriptionPlan.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async getPlan(id: string) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) throw errors.notFound("Subscription plan not found");
    return plan;
  }

  async deletePlan(id: string) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) throw errors.notFound("Subscription plan not found");

    // Don't hard delete if drivers have purchased it
    const activeSubscriptions = await prisma.driverSubscription.findFirst({
      where: { planId: id },
    });

    if (activeSubscriptions) {
      // Soft delete by making it inactive
      return prisma.subscriptionPlan.update({
        where: { id },
        data: { isActive: false },
      });
    }

    return prisma.subscriptionPlan.delete({ where: { id } });
  }

  async listPurchases(input: {
    page: number;
    limit: number;
    search?: string;
    status?: any;
  }) {
    const where: Prisma.DriverSubscriptionWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.search
        ? {
            OR: [
              ...(isValidUUID(input.search)
                ? [{ id: { equals: input.search } }]
                : []),
              {
                driver: {
                  user: {
                    OR: [
                      {
                        displayName: {
                          contains: input.search,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        phone: {
                          contains: input.search,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        email: {
                          contains: input.search,
                          mode: "insensitive" as const,
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const skip = (input.page - 1) * input.limit;

    const [data, total] = await Promise.all([
      prisma.driverSubscription.findMany({
        where,
        skip,
        take: input.limit,
        orderBy: { createdAt: "desc" },
        include: {
          driver: {
            include: { user: true },
          },
          plan: true,
        },
      }),
      prisma.driverSubscription.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: input.page,
        limit: input.limit,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  async getPurchase(id: string) {
    const purchase = await prisma.driverSubscription.findUnique({
      where: { id },
      include: {
        driver: {
          include: { user: true },
        },
        plan: true,
        payment: true,
      },
    });

    if (!purchase) throw errors.notFound("Driver subscription not found");
    return purchase;
  }
}
