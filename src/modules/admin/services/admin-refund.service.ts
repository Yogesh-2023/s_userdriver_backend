import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { emitAdminRoom } from "../../../infrastructure/realtime";

export class AdminRefundService {
  async list(page: number, limit: number, filters?: { status?: string }) {
    const where: Prisma.RefundWhereInput = {};
    if (filters?.status) where.status = filters.status as any;

    const [items, total] = await prisma.$transaction([
      prisma.refund.findMany({
        where,
        include: { payment: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.refund.count({ where }),
    ]);

    return { items, total };
  }

  async get(refundId: string) {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });
    if (!refund) throw errors.notFound("Refund not found");
    return refund;
  }

  async processRefund(refundId: string) {
    const refund = await this.get(refundId);
    if (refund.status !== "REQUESTED") {
      throw errors.badRequest("Refund is already processed or cancelled");
    }
    const updated = await prisma.refund.update({
      where: { id: refundId },
      data: { status: "COMPLETED", processedAt: new Date() },
    });
    emitAdminRoom("dashboard", "admin:refund:processed", { refundId });
    return updated;
  }

  async rejectRefund(refundId: string, reason: string) {
    const refund = await this.get(refundId);
    if (refund.status !== "REQUESTED") {
      throw errors.badRequest("Refund is already processed or cancelled");
    }
    return prisma.refund.update({
      where: { id: refundId },
      data: { status: "FAILED", reason }, // Assuming FAILED acts as REJECTED
    });
  }
}
