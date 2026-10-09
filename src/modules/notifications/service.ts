import { NotificationChannel, Prisma } from "@prisma/client";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import { queues } from "../../infrastructure/queues";
import { emitUser } from "../../infrastructure/realtime";
import { envelope } from "../../realtime/socket-emitter.service";

export class NotificationsService {
  async registerDevice(
    userId: string,
    input: { token: string; platform: string },
  ) {
    return prisma.deviceToken.upsert({
      where: { token: input.token },
      update: {
        userId,
        platform: input.platform,
        isActive: true,
        lastSeenAt: new Date(),
      },
      create: { userId, ...input },
    });
  }

  async list(userId: string, page: number, limit: number) {
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
    ]);
    return { items, meta: { page, limit, total } };
  }

  async unreadCount(userId: string) {
    const unreadCount = await prisma.notification.count({
      where: { userId, status: { not: "READ" } },
    });
    return { unreadCount };
  }

  async markRead(id: string, userId: string) {
    await prisma.$transaction(async (tx) => {
      const notification = await tx.notification.findFirst({
        where: { id, userId },
      });
      if (!notification) throw errors.notFound("Notification not found");
      if (notification.status === "READ") return;
      await tx.notification.update({
        where: { id },
        data: { status: "READ", readAt: new Date() },
      });
      if (notification.campaignId) {
        await tx.notificationCampaign.update({
          where: { id: notification.campaignId },
          data: { readCount: { increment: 1 } },
        });
      }
    });
  }

  async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, status: { not: "READ" } },
      data: { status: "READ", readAt: new Date() },
    });
  }

  async enqueue(input: {
    userId: string;
    bookingId?: string;
    channel: NotificationChannel;
    templateKey: string;
    title?: string;
    body: string;
    data?: Prisma.InputJsonObject;
    idempotencyKey?: string;
  }) {
    let notification;

    if (input.idempotencyKey) {
      notification = await prisma.notification.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
    }

    if (!notification) {
      notification = await prisma.notification.create({ data: input });
      await queues.notifications.add(
        "deliver",
        { notificationId: notification.id },
        { jobId: `notification-${notification.id}` },
      );
      emitUser(
        input.userId,
        "admin.notification.created",
        notification
      );
    }
    return notification;
  }

  async sendToUser(input: {
    userId: string;
    bookingId?: string;
    templateKey: string;
    title?: string;
    body: string;
    data?: Record<string, string>;
    idempotencyKey?: string;
  }) {
    return this.enqueue({
      ...input,
      channel: NotificationChannel.PUSH,
    });
  }

  async sendToDriver(input: {
    driverId: string;
    bookingId?: string;
    templateKey: string;
    title?: string;
    body: string;
    data?: Record<string, string>;
    idempotencyKey?: string;
  }) {
    return this.enqueue({
      userId: input.driverId,
      bookingId: input.bookingId,
      templateKey: input.templateKey,
      title: input.title,
      body: input.body,
      data: input.data,
      idempotencyKey: input.idempotencyKey,
      channel: NotificationChannel.PUSH,
    });
  }

  async sendToMultipleDevices(userIds: string[], input: any) {
    const promises = userIds.map((userId) => this.sendToUser({ userId, ...input }));
    return Promise.allSettled(promises);
  }

  async sendPushNotification(input: any) {
    return this.sendToUser(input);
  }

  async cleanupInvalidTokens(invalidTokens: string[]) {
    if (invalidTokens.length > 0) {
      await prisma.deviceToken.deleteMany({
        where: { token: { in: invalidTokens } },
      });
    }
  }
}
