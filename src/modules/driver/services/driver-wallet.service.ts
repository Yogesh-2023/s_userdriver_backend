import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { razorpay } from "../../../integrations/razorpay";

type EarningsPeriod = "daily" | "weekly" | "monthly";

export class DriverWalletService {
  async getEarningsSummary(driverId: string, startDate?: Date, endDate?: Date) {
    const where: Prisma.DriverEarningWhereInput = {
      driverId,
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    };
    const result = await prisma.driverEarning.aggregate({
      where,
      _sum: {
        grossFare: true,
        platformCommission: true,
        tax: true,
        toll: true,
        incentive: true,
        bonus: true,
        adjustment: true,
        netEarning: true,
        cashCollected: true,
        onlineCollected: true,
      },
      _count: true,
    });
    return {
      grossFare: Number(result._sum.grossFare ?? 0),
      platformCommission: Number(result._sum.platformCommission ?? 0),
      tax: Number(result._sum.tax ?? 0),
      toll: Number(result._sum.toll ?? 0),
      incentive: Number(result._sum.incentive ?? 0),
      bonus: Number(result._sum.bonus ?? 0),
      adjustment: Number(result._sum.adjustment ?? 0),
      netEarning: Number(result._sum.netEarning ?? 0),
      cashCollected: Number(result._sum.cashCollected ?? 0),
      onlineCollected: Number(result._sum.onlineCollected ?? 0),
      tripCount: result._count,
    };
  }

  async listEarnings(
    driverId: string,
    input: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.DriverEarningWhereInput = {
      driverId,
      ...(input.startDate || input.endDate
        ? {
            createdAt: {
              ...(input.startDate ? { gte: input.startDate } : {}),
              ...(input.endDate ? { lte: input.endDate } : {}),
            },
          }
        : {}),
    };
    const [items, total, summary] = await Promise.all([
      prisma.driverEarning.findMany({
        where,
        include: {
          trip: {
            include: {
              booking: {
                select: {
                  id: true,
                  pickupAddress: true,
                  dropAddress: true,
                  finalFare: true,
                  currency: true,
                  payments: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { method: true, status: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit ?? 20,
        skip: input.offset ?? 0,
      }),
      prisma.driverEarning.count({ where }),
      this.getEarningsSummary(driverId, input.startDate, input.endDate),
    ]);
    return {
      items,
      total,
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
      summary,
    };
  }

  async getEarningsByPeriod(
    driverId: string,
    period: EarningsPeriod,
    referenceDate = new Date(),
  ) {
    const { start, end } = this.periodRange(period, referenceDate);
    const [summary, items] = await Promise.all([
      this.getEarningsSummary(driverId, start, end),
      prisma.driverEarning.findMany({
        where: { driverId, createdAt: { gte: start, lte: end } },
        include: {
          trip: {
            select: {
              bookingId: true,
              completedAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { period, start, end, summary, items };
  }

  async getEarningDetails(driverId: string, tripId: string) {
    const earning = await prisma.driverEarning.findFirst({
      where: { driverId, tripId },
      include: {
        trip: { include: { booking: { include: { payments: true } } } },
      },
    });
    if (!earning) throw errors.notFound("Earning details not found");
    return earning;
  }

  async getEarningByBooking(driverId: string, bookingId: string) {
    const earning = await prisma.driverEarning.findFirst({
      where: { driverId, trip: { bookingId } },
      include: {
        trip: { include: { booking: { include: { payments: true } } } },
      },
    });
    if (!earning) throw errors.notFound("Earning details not found");
    return earning;
  }

  async getWallet(driverId: string) {
    return prisma.driverWallet.upsert({
      where: { driverId },
      update: {},
      create: { driverId, balance: 0 },
    });
  }

  async getWalletTransactions(driverId: string, limit = 50, offset = 0) {
    const wallet = await this.getWallet(driverId);
    const [items, total] = await Promise.all([
      prisma.driverWalletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.driverWalletTransaction.count({ where: { walletId: wallet.id } }),
    ]);
    return { items, total, limit, offset };
  }

  async createTopupOrder(
    driverId: string,
    amount: number,
    idempotencyKey: string,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    const replayKey = `driver:wallet-topup:idempotency:${driverId}:${idempotencyKey}`;
    const replay = await redis.get(replayKey);
    if (replay) return JSON.parse(replay) as Record<string, unknown>;
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const receipt = `driver_${driverId.slice(0, 8)}_${Date.now()}`;
    const order = await razorpay.createOrder({
      amountMinor: Math.round(amount * 100),
      currency: "INR",
      receipt,
      notes: {
        driverId,
        userId: driver.userId,
        type: "DRIVER_WALLET_TOPUP",
      },
    });
    if (typeof order.id !== "string") {
      throw errors.unavailable("Payment provider returned an invalid order");
    }
    const result = {
      provider: razorpay.name,
      orderId: order.id,
      amount,
      amountMinor: Math.round(amount * 100),
      currency: "INR",
      status: "PENDING_PAYMENT",
      expiresInSeconds: 600,
    };
    await redis
      .multi()
      .setex(
        `driver:wallet-topup:${order.id}`,
        600,
        JSON.stringify({ driverId, amount, idempotencyKey }),
      )
      .setex(replayKey, 600, JSON.stringify(result))
      .exec();
    return result;
  }

  async requestWithdrawal(
    driverId: string,
    input: {
      amount: number;
      payoutAccountId?: string;
      idempotencyKey: string;
    },
  ) {
    this.assertIdempotencyKey(input.idempotencyKey);
    if (input.amount < 100) {
      throw errors.badRequest("Minimum withdrawal amount is INR 100");
    }
    const replay = await prisma.driverSettlement.findFirst({
      where: { driverId, referenceId: input.idempotencyKey },
      include: { payoutAccount: true },
    });
    if (replay) return this.maskSettlement(replay);
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: {
        user: { select: { status: true } },
        kycSubmissions: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    if (
      driver.user.status !== "ACTIVE" ||
      driver.kycSubmissions[0]?.status !== "VERIFIED"
    ) {
      throw errors.forbidden("Active account and approved KYC are required");
    }

    const settlement = await prisma.$transaction(
      async (tx) => {
        const pending = await tx.driverSettlement.count({
          where: {
            driverId,
            status: { in: ["PENDING", "PROCESSING"] },
          },
        });
        if (pending) throw errors.conflict("A payout is already in progress");
        const account = await tx.driverPayoutAccount.findFirst({
          where: {
            driverId,
            ...(input.payoutAccountId
              ? { id: input.payoutAccountId }
              : { isDefault: true }),
            status: "VERIFIED",
          },
        });
        if (!account)
          throw errors.conflict("A verified payout account is required");
        const wallet = await tx.driverWallet.upsert({
          where: { driverId },
          update: {},
          create: { driverId, balance: 0 },
        });
        const amount = new Prisma.Decimal(input.amount);
        if (wallet.balance.lessThan(amount)) {
          throw errors.conflict("Insufficient available balance");
        }
        const nextBalance = wallet.balance.sub(amount);
        const created = await tx.driverSettlement.create({
          data: {
            driverId,
            payoutAccountId: account.id,
            amount,
            status: "PENDING",
            referenceId: input.idempotencyKey,
          },
        });
        await tx.driverWallet.update({
          where: { id: wallet.id },
          data: { balance: nextBalance },
        });
        await tx.driverWalletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "DEBIT",
            amount,
            balanceAfter: nextBalance,
            referenceType: "WITHDRAWAL",
            referenceId: created.id,
            description: `Withdrawal request ${created.id}`,
          },
        });
        return tx.driverSettlement.findUniqueOrThrow({
          where: { id: created.id },
          include: { payoutAccount: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.maskSettlement(settlement);
  }

  async getSettlements(driverId: string, limit = 50, offset = 0) {
    const [items, total] = await Promise.all([
      prisma.driverSettlement.findMany({
        where: { driverId },
        orderBy: { createdAt: "desc" },
        include: { payoutAccount: true },
        take: limit,
        skip: offset,
      }),
      prisma.driverSettlement.count({ where: { driverId } }),
    ]);
    return {
      items: items.map((item) => this.maskSettlement(item)),
      total,
      limit,
      offset,
    };
  }

  async getSettlement(driverId: string, settlementId: string) {
    const settlement = await prisma.driverSettlement.findFirst({
      where: { id: settlementId, driverId },
      include: { payoutAccount: true },
    });
    if (!settlement) throw errors.notFound("Payout not found");
    return this.maskSettlement(settlement);
  }

  async getPayoutAccounts(driverId: string) {
    const accounts = await prisma.driverPayoutAccount.findMany({
      where: { driverId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return accounts.map((account) => this.maskAccount(account));
  }

  async addPayoutAccount(
    driverId: string,
    data: {
      accountName: string;
      accountNumber: string;
      bankCode: string;
      bankName: string;
    },
  ) {
    const existing = await prisma.driverPayoutAccount.findFirst({
      where: {
        driverId,
        accountNumber: data.accountNumber,
        bankCode: data.bankCode,
      },
    });
    if (existing) throw errors.conflict("Bank account already exists");
    const existingAccounts = await prisma.driverPayoutAccount.count({
      where: { driverId },
    });
    const account = await prisma.driverPayoutAccount.create({
      data: {
        driverId,
        ...data,
        isDefault: existingAccounts === 0,
        status: "PENDING",
      },
    });
    return this.maskAccount(account);
  }

  async updatePayoutAccount(
    driverId: string,
    accountId: string,
    data: {
      accountName?: string;
      accountNumber?: string;
      bankCode?: string;
      bankName?: string;
    },
  ) {
    await this.requirePayoutAccount(driverId, accountId);
    const account = await prisma.driverPayoutAccount.update({
      where: { id: accountId },
      data: { ...data, status: "PENDING" },
    });
    return this.maskAccount(account);
  }

  async deletePayoutAccount(driverId: string, accountId: string) {
    const account = await this.requirePayoutAccount(driverId, accountId);
    const settlements = await prisma.driverSettlement.count({
      where: {
        payoutAccountId: accountId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });
    if (settlements) {
      throw errors.conflict("Account has an active payout");
    }
    await prisma.$transaction(async (tx) => {
      await tx.driverPayoutAccount.delete({ where: { id: accountId } });
      if (account.isDefault) {
        const replacement = await tx.driverPayoutAccount.findFirst({
          where: { driverId, id: { not: accountId } },
          orderBy: { createdAt: "asc" },
        });
        if (replacement) {
          await tx.driverPayoutAccount.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }
    });
  }

  async setDefaultPayoutAccount(driverId: string, accountId: string) {
    await this.requirePayoutAccount(driverId, accountId);
    await prisma.$transaction([
      prisma.driverPayoutAccount.updateMany({
        where: { driverId, isDefault: true },
        data: { isDefault: false },
      }),
      prisma.driverPayoutAccount.update({
        where: { id: accountId },
        data: { isDefault: true },
      }),
    ]);
    const account = await this.requirePayoutAccount(driverId, accountId);
    return this.maskAccount(account);
  }

  private async requirePayoutAccount(driverId: string, accountId: string) {
    const account = await prisma.driverPayoutAccount.findFirst({
      where: { id: accountId, driverId },
    });
    if (!account) throw errors.notFound("Bank account not found");
    return account;
  }

  private periodRange(period: EarningsPeriod, referenceDate: Date) {
    const start = new Date(referenceDate);
    const end = new Date(referenceDate);
    if (period === "daily") {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (period === "weekly") {
      const day = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(start.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    }
    return { start, end };
  }

  private maskAccount<T extends { accountNumber: string }>(account: T) {
    const visible = account.accountNumber.slice(-4);
    return {
      ...account,
      accountNumber: `${"*".repeat(
        Math.max(0, account.accountNumber.length - 4),
      )}${visible}`,
    };
  }

  private maskSettlement<
    T extends { payoutAccount: { accountNumber: string } },
  >(settlement: T) {
    return {
      ...settlement,
      payoutAccount: this.maskAccount(settlement.payoutAccount),
    };
  }

  private assertIdempotencyKey(value: string) {
    if (!value || value.length > 100) {
      throw errors.badRequest("A valid x-idempotency-key header is required");
    }
  }
}
