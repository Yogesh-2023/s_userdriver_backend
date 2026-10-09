import {
  NotificationCampaignStatus,
  NotificationChannel,
  Prisma,
} from "@prisma/client";
import { errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import { queues } from "../../../infrastructure/queues";
import type { AdminActionContext } from "../admin.constants";

export class AdminNotificationService {
  async list(page: number, limit: number) {
    const [items, total] = await prisma.$transaction([
      prisma.notificationCampaign.findMany({
        include: { template: true, initiatedByAdmin: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notificationCampaign.count(),
    ]);
    return { items, total };
  }

  async createCampaign(
    input: {
      audience: Record<string, unknown>;
      channels: NotificationChannel[];
      templateId?: string;
      title?: string;
      body: string;
      data?: Record<string, unknown>;
      scheduledAt?: Date;
    },
    idempotencyKey: string,
    actor: AdminActionContext,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 120) {
      throw errors.badRequest("A valid x-idempotency-key is required");
    }
    const replay = await prisma.notificationCampaign.findUnique({
      where: { idempotencyKey },
    });
    if (replay) return replay;
    if (input.templateId) {
      const template = await prisma.notificationTemplate.findFirst({
        where: { id: input.templateId, isActive: true },
      });
      if (!template) throw errors.notFound("Notification template not found");
    }
    const scheduled =
      input.scheduledAt && input.scheduledAt.getTime() > Date.now();
    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.notificationCampaign.create({
        data: {
          idempotencyKey,
          initiatedByAdminId: actor.adminId,
          templateId: input.templateId,
          audience: input.audience as Prisma.InputJsonObject,
          channels: input.channels,
          title: input.title ? this.sanitize(input.title) : undefined,
          body: this.sanitize(input.body),
          data: input.data as Prisma.InputJsonObject | undefined,
          scheduledAt: input.scheduledAt,
          status: scheduled
            ? NotificationCampaignStatus.SCHEDULED
            : NotificationCampaignStatus.QUEUED,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: scheduled
            ? "ADMIN_NOTIFICATION_SCHEDULED"
            : "ADMIN_NOTIFICATION_SENT",
          entityType: "NotificationCampaign",
          entityId: created.id,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          after: {
            audience: input.audience as Prisma.InputJsonObject,
            channels: input.channels,
            scheduledAt: input.scheduledAt?.toISOString(),
          },
        },
      });
      return created;
    });
    await queues.notifications.add(
      "campaign",
      { campaignId: campaign.id },
      {
        jobId: `notification-campaign-${campaign.id}`,
        delay: scheduled
          ? Math.max(0, input.scheduledAt!.getTime() - Date.now())
          : 0,
      },
    );
    return campaign;
  }

  async get(campaignId: string) {
    const campaign = await prisma.notificationCampaign.findUnique({
      where: { id: campaignId },
      include: {
        template: true,
        initiatedByAdmin: true,
      },
    });
    if (!campaign) throw errors.notFound("Notification campaign not found");
    const counts = await prisma.notification.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: true,
    });
    return { ...campaign, deliveryCounts: counts };
  }

  async retry(notificationId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw errors.notFound("Notification not found");
    if (notification.status !== "FAILED") {
      throw errors.conflict("Only failed notifications can be retried");
    }
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: "QUEUED", errorCode: null },
    });
    await queues.notifications.add(
      "deliver",
      { notificationId },
      {
        jobId: `notification-retry-${notificationId}-${notification.attempts}`,
      },
    );
  }

  async cancelSchedule(campaignId: string, actor: AdminActionContext) {
    const changed = await prisma.notificationCampaign.updateMany({
      where: {
        id: campaignId,
        status: NotificationCampaignStatus.SCHEDULED,
      },
      data: {
        status: NotificationCampaignStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });
    if (!changed.count) {
      throw errors.conflict("Scheduled campaign cannot be cancelled");
    }
    const job = await queues.notifications.getJob(
      `notification-campaign-${campaignId}`,
    );
    if (job) await job.remove();
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_NOTIFICATION_SCHEDULE_CANCELLED",
        entityType: "NotificationCampaign",
        entityId: campaignId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
    });
  }

  templates() {
    return prisma.notificationTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async createTemplate(
    input: {
      key: string;
      channel: NotificationChannel;
      title?: string;
      body: string;
      variables: string[];
      isActive: boolean;
    },
    actor: AdminActionContext,
  ) {
    this.assertTemplate(input.body, input.variables);
    const template = await prisma.notificationTemplate.create({
      data: {
        ...input,
        title: input.title ? this.sanitize(input.title) : undefined,
        body: this.sanitize(input.body),
        createdByAdminId: actor.adminId,
      },
    });
    await this.auditTemplate(
      actor,
      template.id,
      "ADMIN_NOTIFICATION_TEMPLATE_CREATED",
    );
    return template;
  }

  async updateTemplate(
    templateId: string,
    input: Partial<{
      key: string;
      channel: NotificationChannel;
      title: string;
      body: string;
      variables: string[];
      isActive: boolean;
    }>,
    actor: AdminActionContext,
  ) {
    const current = await prisma.notificationTemplate.findUnique({
      where: { id: templateId },
    });
    if (!current) throw errors.notFound("Notification template not found");
    const variables = input.variables ?? current.variables;
    const body = input.body ?? current.body;
    this.assertTemplate(body, variables);
    const template = await prisma.notificationTemplate.update({
      where: { id: templateId },
      data: {
        ...input,
        title: input.title ? this.sanitize(input.title) : input.title,
        body: input.body ? this.sanitize(input.body) : undefined,
      },
    });
    await this.auditTemplate(
      actor,
      templateId,
      "ADMIN_NOTIFICATION_TEMPLATE_UPDATED",
    );
    return template;
  }

  private assertTemplate(body: string, variables: string[]) {
    const used = [...body.matchAll(/\{\{([a-z][a-zA-Z0-9_]*)\}\}/g)].map(
      (match) => match[1]!,
    );
    if (used.some((name) => !variables.includes(name))) {
      throw errors.badRequest("Template uses an undeclared variable");
    }
  }

  private sanitize(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  private auditTemplate(
    actor: AdminActionContext,
    templateId: string,
    action: string,
  ) {
    return prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action,
        entityType: "NotificationTemplate",
        entityId: templateId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
    });
  }

  async delete(notificationId: string, _actor: AdminActionContext) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw errors.notFound("Notification not found");

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    return { id: notificationId };
  }

  async markAllAsRead(actor: AdminActionContext) {
    await prisma.notification.updateMany({
      where: {
        userId: actor.userId,
        status: { not: "READ" },
      },
      data: {
        status: "READ",
        readAt: new Date(),
      },
    });
  }

  async markAllAsUnread(actor: AdminActionContext) {
    await prisma.notification.updateMany({
      where: {
        userId: actor.userId,
        status: "READ",
      },
      data: {
        status: "DELIVERED",
        readAt: null,
      },
    });
  }
}
