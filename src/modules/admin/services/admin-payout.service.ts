import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class AdminPayoutService {
  async listSettlements(
    page: number,
    limit: number,
    filters?: { status?: string },
  ) {
    const where: Prisma.DriverSettlementWhereInput = {};
    if (filters?.status) where.status = filters.status;

    const [items, total] = await prisma.$transaction([
      prisma.driverSettlement.findMany({
        where,
        include: {
          driver: { include: { user: { select: { displayName: true } } } },
          payoutAccount: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.driverSettlement.count({ where }),
    ]);
    return { items, total };
  }

  async processSettlement(settlementId: string, referenceId: string) {
    const settlement = await prisma.driverSettlement.findUnique({
      where: { id: settlementId },
    });
    if (!settlement) throw errors.notFound("Settlement not found");
    if (settlement.status !== "PENDING")
      throw errors.badRequest("Settlement is not pending");

    return prisma.driverSettlement.update({
      where: { id: settlementId },
      data: { status: "COMPLETED", referenceId, updatedAt: new Date() },
    });
  }

  async rejectSettlement(settlementId: string) {
    const settlement = await prisma.driverSettlement.findUnique({
      where: { id: settlementId },
    });
    if (!settlement) throw errors.notFound("Settlement not found");
    if (settlement.status !== "PENDING")
      throw errors.badRequest("Settlement is not pending");

    return prisma.driverSettlement.update({
      where: { id: settlementId },
      data: { status: "FAILED", updatedAt: new Date() },
    });
  }

  async createManualPayout(input: {
    driverId: string;
    amount: number;
    notes?: string;
    referenceId?: string;
  }) {
    if (input.amount < 100) {
      throw errors.badRequest("Minimum payout amount is INR 100");
    }

    return prisma.$transaction(
      async (tx) => {
        const driver = await tx.driverProfile.findUnique({
          where: { id: input.driverId },
          select: { id: true, user: { select: { status: true } } },
        });
        if (!driver) throw errors.notFound("Driver profile not found");
        if (driver.user.status !== "ACTIVE") {
          throw errors.forbidden(
            "Only active drivers can receive manual payouts",
          );
        }

        const pending = await tx.driverSettlement.count({
          where: {
            driverId: input.driverId,
            status: { in: ["PENDING", "PROCESSING"] },
          },
        });
        if (pending) throw errors.conflict("A payout is already in progress");

        const account = await tx.driverPayoutAccount.findFirst({
          where: {
            driverId: input.driverId,
            isDefault: true,
            status: "VERIFIED",
          },
        });
        if (!account)
          throw errors.conflict(
            "A verified default payout account is required",
          );

        const wallet = await tx.driverWallet.upsert({
          where: { driverId: input.driverId },
          update: {},
          create: { driverId: input.driverId, balance: 0 },
        });
        const amount = new Prisma.Decimal(input.amount);
        if (wallet.balance.lessThan(amount)) {
          throw errors.conflict("Insufficient driver wallet balance");
        }

        const nextBalance = wallet.balance.sub(amount);
        const settlement = await tx.driverSettlement.create({
          data: {
            driverId: input.driverId,
            payoutAccountId: account.id,
            amount,
            status: "PENDING",
            referenceId: input.referenceId ?? `ADMIN-${Date.now()}`,
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
            referenceType: "ADMIN_MANUAL_PAYOUT",
            referenceId: settlement.id,
            description: input.notes ?? `Admin manual payout ${settlement.id}`,
          },
        });
        return settlement;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
