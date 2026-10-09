import { Prisma, UserStatus } from "@prisma/client";
import { errors } from "../../../common/errors";
import { isValidUUID } from "../admin.utils";
import { prisma } from "../../../database/prisma";
import { SessionsService } from "../../sessions/service";
import type { AdminActionContext } from "../admin.constants";

export class AdminCustomerService {
  private readonly sessions = new SessionsService();

  async list(input: {
    page: number;
    limit: number;
    search?: string;
    status?: UserStatus;
    from?: Date;
    to?: Date;
    sort: "newest" | "oldest" | "booking_count" | "total_spending";
  }) {
    const filters = [
      input.search
        ? isValidUUID(input.search)
          ? Prisma.sql`AND (
              u."displayName" ILIKE ${`%${input.search}%`} OR
              u."phone" ILIKE ${`%${input.search}%`} OR
              u."email" ILIKE ${`%${input.search}%`} OR
              cp."id" = ${input.search}::uuid
            )`
          : Prisma.sql`AND (
              u."displayName" ILIKE ${`%${input.search}%`} OR
              u."phone" ILIKE ${`%${input.search}%`} OR
              u."email" ILIKE ${`%${input.search}%`}
            )`
        : Prisma.empty,
      input.status
        ? Prisma.sql`AND u."status" = ${input.status}::"UserStatus"`
        : Prisma.empty,
      input.from
        ? Prisma.sql`AND cp."createdAt" >= ${input.from}`
        : Prisma.empty,
      input.to ? Prisma.sql`AND cp."createdAt" <= ${input.to}` : Prisma.empty,
    ];
    const order =
      input.sort === "oldest"
        ? Prisma.sql`cp."createdAt" ASC`
        : input.sort === "booking_count"
          ? Prisma.sql`"totalBookings" DESC, cp."createdAt" DESC`
          : input.sort === "total_spending"
            ? Prisma.sql`"totalSpending" DESC, cp."createdAt" DESC`
            : Prisma.sql`cp."createdAt" DESC`;
    const offset = (input.page - 1) * input.limit;
    const [items, totalRows] = await prisma.$transaction([
      prisma.$queryRaw<
        Array<{
          id: string;
          userId: string;
          displayName: string | null;
          phone: string;
          email: string | null;
          status: UserStatus;
          createdAt: Date;
          lastLoginAt: Date | null;
          totalBookings: bigint;
          completedTrips: bigint;
          cancelledBookings: bigint;
          totalSpending: Prisma.Decimal;
          walletBalance: Prisma.Decimal;
          averageRating: Prisma.Decimal;
          lastBookingAt: Date | null;
          activeSessions: bigint;
          profileImageUrl: string | null;
          city: string | null;
          state: string | null;
          addressLine: string | null;
        }>
      >(Prisma.sql`
        SELECT
          cp."id", cp."userId", u."displayName", u."phone", u."email",
          u."status", cp."createdAt", u."lastLoginAt", cp."profileImageUrl",
          ad."city" AS "city", ad."state" AS "state", ad."addressLine" AS "addressLine",
          COALESCE(bs."totalBookings", 0) AS "totalBookings",
          COALESCE(ts."completedTrips", 0) AS "completedTrips",
          COALESCE(bs."cancelledBookings", 0) AS "cancelledBookings",
          COALESCE(ps."totalSpending", 0) AS "totalSpending",
          COALESCE(w."balance", 0) AS "walletBalance",
          COALESCE(rs."averageRating", 0) AS "averageRating",
          bs."lastBookingAt",
          COALESCE(ss."activeSessions", 0) AS "activeSessions"
        FROM "CustomerProfile" cp
        JOIN "User" u ON u."id" = cp."userId"
        LEFT JOIN "Wallet" w ON w."userId" = u."id"
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) AS "totalBookings",
            COUNT(*) FILTER (WHERE b."status" = 'CANCELLED') AS "cancelledBookings",
            MAX(b."createdAt") AS "lastBookingAt"
          FROM "Booking" b
          WHERE b."customerId" = cp."id"
        ) bs ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) FILTER (WHERE t."status" = 'COMPLETED') AS "completedTrips"
          FROM "Trip" t
          JOIN "Booking" b ON b."id" = t."bookingId"
          WHERE b."customerId" = cp."id"
        ) ts ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(p."amountPaid"), 0) AS "totalSpending"
          FROM "Payment" p
          JOIN "Booking" b ON b."id" = p."bookingId"
          WHERE b."customerId" = cp."id" AND p."status" = 'CAPTURED'
        ) ps ON true
        LEFT JOIN LATERAL (
          SELECT AVG(r."score") AS "averageRating"
          FROM "Rating" r
          WHERE r."subjectUserId" = u."id"
        ) rs ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS "activeSessions"
          FROM "Session" s
          WHERE s."userId" = u."id"
            AND s."isRevoked" = false
            AND s."expiresAt" > NOW()
        ) ss ON true
        LEFT JOIN LATERAL (
          SELECT ca."city", ca."state", ca."addressLine"
          FROM "CustomerAddress" ca
          WHERE ca."customerId" = cp."id" AND ca."isDeleted" = false
          ORDER BY ca."isDefault" DESC, ca."updatedAt" DESC
          LIMIT 1
        ) ad ON true
        WHERE 1=1 ${Prisma.join(filters, " ")}
        ORDER BY ${order}
        LIMIT ${input.limit} OFFSET ${offset}
      `),
      prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "count"
        FROM "CustomerProfile" cp
        JOIN "User" u ON u."id" = cp."userId"
        WHERE 1=1 ${Prisma.join(filters, " ")}
      `),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        displayName: item.displayName || "Guest User",
        totalBookings: Number(item.totalBookings),
        completedTrips: Number(item.completedTrips),
        cancelledBookings: Number(item.cancelledBookings),
        activeSessions: Number(item.activeSessions),
      })),
      total: Number(totalRows[0]?.count ?? 0),
    };
  }

  async create(
    data: { phone: string; displayName: string; email?: string },
    actor: AdminActionContext,
  ) {
    const user = await prisma.user.create({
      data: {
        phone: data.phone,
        displayName: data.displayName,
        email: data.email,
        roles: { create: { role: { connect: { name: "CUSTOMER" } } } },
        status: "ACTIVE",
      },
    });

    // Generate a unique referral code
    const referralCode =
      "REF" + Math.random().toString(36).substring(2, 8).toUpperCase();

    const profile = await prisma.customerProfile.create({
      data: {
        userId: user.id,
        referralCode,
      },
    });
    return { user, profile };
  }

  async delete(customerId: string, actor: AdminActionContext) {
    const profile = await prisma.customerProfile.findUnique({
      where: { id: customerId },
    });
    if (!profile) throw errors.notFound("Customer not found");
    await prisma.user.update({
      where: { id: profile.userId },
      data: { status: "DELETED" },
    });
    return { success: true };
  }

  async getWalletByCustomerId(customerId: string) {
    const profile = await prisma.customerProfile.findUnique({
      where: { id: customerId },
    });
    if (!profile) throw errors.notFound("Customer not found");
    return prisma.wallet.findFirst({
      where: { userId: profile.userId },
    });
  }

  async getActivity(customerId: string) {
    const bookings = await prisma.booking.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const couponUsages = await prisma.couponUsage.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return { bookings, couponUsages };
  }

  async getAddresses(customerId: string) {
    return prisma.customerAddress.findMany({
      where: { customerId, isDeleted: false },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
  }

  async get(customerId: string) {
    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            phone: true,
            email: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!customer) throw errors.notFound("Customer not found");
    const [
      bookingStats,
      spending,
      rating,
      wallet,
      activeSessions,
      lastBooking,
    ] = await Promise.all([
      prisma.booking.groupBy({
        by: ["status"],
        where: { customerId },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: {
          booking: { customerId },
          status: "CAPTURED",
        },
        _sum: { amountPaid: true },
      }),
      prisma.rating.aggregate({
        where: { subjectUserId: customer.userId },
        _avg: { score: true },
      }),
      prisma.wallet.findUnique({ where: { userId: customer.userId } }),
      prisma.session.count({
        where: {
          userId: customer.userId,
          isRevoked: false,
          expiresAt: { gt: new Date() },
        },
      }),
      prisma.booking.findFirst({
        where: { customerId },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      ...customer,
      user: {
        ...customer.user,
        displayName: customer.user.displayName || "Guest User",
      },
      overview: {
        bookingStats,
        totalSpending: spending._sum.amountPaid ?? new Prisma.Decimal(0),
        walletBalance: wallet?.balance ?? new Prisma.Decimal(0),
        averageRating: rating._avg.score ?? 0,
        activeSessions,
        lastBooking,
      },
    };
  }

  async update(
    customerId: string,
    input: {
      displayName?: string;
      email?: string | null;
      dateOfBirth?: Date | null;
    },
    actor: AdminActionContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.customerProfile.findUnique({
        where: { id: customerId },
        include: { user: true },
      });
      if (!before) throw errors.notFound("Customer not found");
      const updated = await tx.customerProfile.update({
        where: { id: customerId },
        data: {
          dateOfBirth: input.dateOfBirth,
          user: {
            update: {
              displayName: input.displayName,
              email: input.email,
            },
          },
        },
        include: { user: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_CUSTOMER_UPDATED",
          entityType: "CustomerProfile",
          entityId: customerId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          before: {
            displayName: before.user.displayName,
            email: before.user.email,
            dateOfBirth: before.dateOfBirth,
          },
          after: {
            displayName: updated.user.displayName,
            email: updated.user.email,
            dateOfBirth: updated.dateOfBirth,
          },
        },
      });
      return updated;
    });
  }

  async updateStatus(
    customerId: string,
    input: { status: UserStatus; reason: string },
    actor: AdminActionContext,
  ) {
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customerProfile.findUnique({
        where: { id: customerId },
        include: { user: true },
      });
      if (!customer) throw errors.notFound("Customer not found");
      if (customer.user.status === input.status) return customer;
      const updated = await tx.customerProfile.update({
        where: { id: customerId },
        data: {
          user: {
            update: {
              status: input.status,
              deletedAt:
                input.status === UserStatus.DELETED ? new Date() : null,
            },
          },
          statusHistory: {
            create: {
              adminId: actor.adminId,
              fromStatus: customer.user.status,
              toStatus: input.status,
              reason: input.reason,
            },
          },
        },
        include: { user: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_CUSTOMER_STATUS_UPDATED",
          entityType: "CustomerProfile",
          entityId: customerId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason: input.reason,
          before: { status: customer.user.status },
          after: { status: input.status },
        },
      });
      return updated;
    });
    if (input.status !== UserStatus.ACTIVE) {
      await this.sessions.revokeAllForUser(
        result.userId,
        actor.userId,
        `CUSTOMER_${input.status}`,
      );
    }
    return result;
  }

  listBookings(customerId: string, page: number, limit: number) {
    return this.paginate("booking", customerId, page, limit);
  }

  listTrips(customerId: string, page: number, limit: number) {
    return this.paginate("trip", customerId, page, limit);
  }

  listPayments(customerId: string, page: number, limit: number) {
    return this.paginate("payment", customerId, page, limit);
  }

  listRatings(customerId: string, page: number, limit: number) {
    return this.paginate("rating", customerId, page, limit);
  }

  listSupportTickets(customerId: string, page: number, limit: number) {
    return this.paginate("support", customerId, page, limit);
  }

  private async paginate(
    kind: "booking" | "trip" | "payment" | "rating" | "support",
    customerId: string,
    page: number,
    limit: number,
  ) {
    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });
    if (!customer) throw errors.notFound("Customer not found");
    const skip = (page - 1) * limit;
    if (kind === "booking") {
      return prisma.$transaction([
        prisma.booking.findMany({
          where: { customerId },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: {
            assignedDriver: {
              include: { user: true },
            },
            assignedVehicle: true,
            vehicleCategory: true,
            payments: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            fareBreakdowns: true,
            trip: {
              include: {
                fareBreakdown: true,
                driver: { include: { user: true } },
                vehicle: true,
              },
            },
          },
        }),
        prisma.booking.count({ where: { customerId } }),
      ]);
    }
    if (kind === "trip") {
      return prisma.$transaction([
        prisma.trip.findMany({
          where: { booking: { customerId } },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.trip.count({ where: { booking: { customerId } } }),
      ]);
    }
    if (kind === "payment") {
      return prisma.$transaction([
        prisma.payment.findMany({
          where: { booking: { customerId } },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.payment.count({ where: { booking: { customerId } } }),
      ]);
    }
    if (kind === "rating") {
      return prisma.$transaction([
        prisma.rating.findMany({
          where: { subjectUserId: customer.userId },
          include: { review: true },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.rating.count({
          where: { subjectUserId: customer.userId },
        }),
      ]);
    }
    return prisma.$transaction([
      prisma.supportTicket.findMany({
        where: { createdByUserId: customer.userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.supportTicket.count({
        where: { createdByUserId: customer.userId },
      }),
    ]);
  }

  async listSessions(customerId: string) {
    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });
    if (!customer) throw errors.notFound("Customer not found");
    return this.sessions.list(customer.userId);
  }

  async revokeSession(
    customerId: string,
    sessionId: string,
    actor: AdminActionContext,
  ) {
    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });
    if (!customer) throw errors.notFound("Customer not found");

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== customer.userId) {
      throw errors.notFound("Session not found");
    }

    await this.sessions.revoke(sessionId, actor.userId, "ADMIN_REVOKED");

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_CUSTOMER_SESSION_REVOKED",
        entityType: "CustomerProfile",
        entityId: customerId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { sessionId },
      },
    });
  }

  async logoutAll(customerId: string, actor: AdminActionContext) {
    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });
    if (!customer) throw errors.notFound("Customer not found");

    const count = await this.sessions.revokeAllForUser(
      customer.userId,
      actor.userId,
      "ADMIN_REVOKED",
    );

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_CUSTOMER_SESSIONS_REVOKED_ALL",
        entityType: "CustomerProfile",
        entityId: customerId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { revokedCount: count },
      },
    });

    return count;
  }

  async getNotifications(customerId: string, page: number, limit: number) {
    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });
    if (!customer) throw errors.notFound("Customer not found");

    const offset = (page - 1) * limit;
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where: { userId: customer.userId },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.notification.count({
        where: { userId: customer.userId },
      }),
    ]);
    return { items, total };
  }
}
