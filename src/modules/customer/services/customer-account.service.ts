import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { queues } from "../../../infrastructure/queues";
import { SessionsService } from "../../sessions/service";

export class CustomerAccountService {
  private readonly sessions = new SessionsService();

  private async getCustomer(userId: string) {
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw errors.notFound("Customer profile not found");
    return customer;
  }

  async requestDeletion(userId: string) {
    const customer = await this.getCustomer(userId);

    // 1. Block if there is any active booking/trip
    const activeBooking = await prisma.booking.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: [
            "PENDING",
            "SEARCHING_DRIVER",
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVING",
            "DRIVER_ARRIVED",
            "TRIP_STARTED",
          ],
        },
      },
    });
    if (activeBooking) {
      throw errors.conflict(
        "Cannot delete account while you have an active booking or ride",
      );
    }

    // 2. Block if there is any payment pending
    const pendingPayment = await prisma.booking.findFirst({
      where: {
        customerId: customer.id,
        status: "PAYMENT_PENDING",
      },
    });
    if (pendingPayment) {
      throw errors.conflict(
        "Cannot delete account while you have pending payments",
      );
    }

    // Insert deletion request record
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.accountDeletionRequest.findUnique({
        where: { customerId: customer.id },
      });
      if (existing && existing.status === "PENDING") {
        return existing;
      }

      const created = await tx.accountDeletionRequest.upsert({
        where: { customerId: customer.id },
        create: {
          customerId: customer.id,
          status: "PENDING",
        },
        update: {
          status: "PENDING",
          createdAt: new Date(),
          processedAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorRole: "CUSTOMER",
          action: "CUSTOMER_ACCOUNT_DELETION_REQUESTED",
          entityType: "AccountDeletionRequest",
          entityId: created.id,
        },
      });

      return created;
    });

    // In a real application, we would enqueue a job to physically scrub data after retention window.
    if (queues.maintenance) {
      await queues.maintenance.add(
        "customer-account-deletion",
        { customerId: customer.id },
        { jobId: `account-deletion-${customer.id}`, delay: 24 * 3600 * 1000 }, // 24 hours retention
      );
    }

    // Instantly revoke all active sessions to log out the user
    await this.sessions.revokeAllForUser(
      userId,
      userId,
      "ACCOUNT_DELETION_REQUESTED",
    );

    return result;
  }

  async cancelDeletion(userId: string) {
    const customer = await this.getCustomer(userId);

    const request = await prisma.accountDeletionRequest.findUnique({
      where: { customerId: customer.id },
    });
    if (!request || request.status !== "PENDING") {
      throw errors.notFound("No pending account deletion request found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.accountDeletionRequest.update({
        where: { id: request.id },
        data: { status: "CANCELLED" },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorRole: "CUSTOMER",
          action: "CUSTOMER_ACCOUNT_DELETION_CANCELLED",
          entityType: "AccountDeletionRequest",
          entityId: request.id,
        },
      });
    });

    // Remove the scheduled job from queue if it exists
    if (queues.maintenance) {
      const job = await queues.maintenance.getJob(
        `account-deletion-${customer.id}`,
      );
      if (job) await job.remove();
    }

    return { success: true };
  }

  async requestDataExport(userId: string) {
    const customer = await this.getCustomer(userId);

    const created = await prisma.dataExportRequest.create({
      data: {
        customerId: customer.id,
        status: "PENDING",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorRole: "CUSTOMER",
        action: "CUSTOMER_DATA_EXPORT_REQUESTED",
        entityType: "DataExportRequest",
        entityId: created.id,
      },
    });

    // Enqueue data export job
    if (queues.maintenance) {
      await queues.maintenance.add(
        "customer-data-export",
        { exportId: created.id, userId },
        { jobId: `data-export-${created.id}` },
      );
    }

    return created;
  }

  async getDataExport(userId: string, exportId: string) {
    const customer = await this.getCustomer(userId);
    const request = await prisma.dataExportRequest.findUnique({
      where: { id: exportId },
    });
    if (!request || request.customerId !== customer.id) {
      throw errors.notFound("Data export request not found");
    }
    return request;
  }
}
