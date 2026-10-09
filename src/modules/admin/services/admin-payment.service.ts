import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class AdminPaymentService {
  async list(
    page: number,
    limit: number,
    filters?: { status?: string; method?: string; query?: string },
  ) {
    const where: Prisma.PaymentWhereInput = {};
    if (filters?.status) where.status = filters.status as any;
    if (filters?.method) where.method = filters.method as any;
    if (filters?.query) {
      where.OR = [
        { id: filters.query },
        { providerOrderId: filters.query },
        { providerPaymentId: filters.query },
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        include: {
          booking: { select: { id: true, customerId: true } },
          transactions: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return { items, total };
  }

  async get(paymentId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: true,
        transactions: true,
        refunds: true,
      },
    });
    if (!payment) throw errors.notFound("Payment not found");
    return payment;
  }

  async retry(paymentId: string) {
    const payment = await this.get(paymentId);
    if (payment.status !== "FAILED") {
      throw errors.badRequest("Only failed payments can be retried");
    }
    // Stub logic for payment retry
    return prisma.payment.update({
      where: { id: paymentId },
      data: { status: "CREATED" },
    });
  }

  async reconcile(paymentId: string) {
    const payment = await this.get(paymentId);
    if (payment.status === "CAPTURED") {
      throw errors.badRequest("Payment is already completed");
    }
    // Stub logic to check provider status and reconcile
    return prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: "CAPTURED",
        amountPaid: payment.amount,
        paidAt: new Date(),
      },
    });
  }

  async gatewayLogs(
    page: number,
    limit: number,
    filters?: { type?: string; status?: string },
  ) {
    const where: Prisma.PaymentTransactionWhereInput = {};
    if (filters?.type) where.type = filters.type as any;
    if (filters?.status) where.status = filters.status;

    const [items, total] = await prisma.$transaction([
      prisma.paymentTransaction.findMany({
        where,
        include: {
          payment: {
            select: {
              id: true,
              providerOrderId: true,
              providerPaymentId: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.paymentTransaction.count({ where }),
    ]);
    return { items, total };
  }
}
