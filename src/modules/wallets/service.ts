import { Prisma, WalletTransactionType } from "@prisma/client";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";

export class WalletsService {
  async get(userId: string, page: number, limit: number) {
    const wallet = await prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    const [transactions, total] = await prisma.$transaction([
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);
    return { wallet, transactions, meta: { page, limit, total } };
  }

  async adjust(
    userId: string,
    amount: number,
    type: WalletTransactionType,
    idempotencyKey: string,
    description: string,
    actorUserId: string,
  ) {
    if (!idempotencyKey) throw errors.badRequest("Idempotency key is required");
    const money = new Prisma.Decimal(amount);
    const signedAmount =
      type === WalletTransactionType.CREDIT ? money : money.negated();
    return prisma.$transaction(
      async (tx) => {
        const replay = await tx.walletTransaction.findUnique({
          where: { idempotencyKey },
        });
        if (replay) return replay;
        const wallet = await tx.wallet.upsert({
          where: { userId },
          update: {},
          create: { userId },
        });
        const next = wallet.balance.add(signedAmount);
        if (next.lessThan(0))
          throw errors.conflict("Insufficient wallet balance");
        const updated = await tx.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { balance: next, version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw errors.conflict("Wallet changed; retry the request");
        }
        const created = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type,
            amount: money,
            balanceAfter: next,
            idempotencyKey,
            description,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            actorRole: "ADMIN",
            action: "ADMIN_WALLET_ADJUSTED",
            entityType: "WalletTransaction",
            entityId: created.id,
            reason: description,
            after: {
              userId,
              type,
              amount: money,
              balanceAfter: next,
            },
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
