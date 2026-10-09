import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class AdminWalletService {
  async listCustomerWallets(page: number, limit: number) {
    const [items, total] = await prisma.$transaction([
      prisma.wallet.findMany({
        include: {
          user: {
            select: { id: true, displayName: true, email: true, phone: true },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.wallet.count(),
    ]);
    return { items, total };
  }

  async getCustomerWallet(walletId: string) {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        user: true,
        transactions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!wallet) throw errors.notFound("Wallet not found");
    return wallet;
  }

  async listDriverWallets(page: number, limit: number) {
    const [items, total] = await prisma.$transaction([
      prisma.driverWallet.findMany({
        include: {
          driver: {
            include: { user: { select: { displayName: true, phone: true } } },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.driverWallet.count(),
    ]);
    return { items, total };
  }

  async getDriverWallet(walletId: string) {
    const wallet = await prisma.driverWallet.findUnique({
      where: { id: walletId },
      include: {
        driver: { include: { user: true } },
        transactions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!wallet) throw errors.notFound("Wallet not found");
    return wallet;
  }

  // Adjustments would be added here
}
