import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class CustomerNotificationService {
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

  async getUnreadCount(userId: string) {
    const count = await prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unreadCount: count };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.userId !== userId) {
      throw errors.notFound("Notification not found");
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    return { success: true };
  }

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async delete(userId: string, notificationId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.userId !== userId) {
      throw errors.notFound("Notification not found");
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    return { success: true };
  }

  async registerDeviceToken(userId: string, token: string, platform: string) {
    // Upsert the device token associated with the user
    const result = await prisma.deviceToken.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform: platform || "ANDROID",
        isActive: true,
      },
      update: {
        userId,
        platform: platform || "ANDROID",
        isActive: true,
        lastSeenAt: new Date(),
      },
    });

    return result;
  }

  async deleteDeviceToken(userId: string, tokenOrId: string) {
    const record = await prisma.deviceToken.findFirst({
      where: {
        userId,
        OR: [{ token: tokenOrId }, { id: tokenOrId }],
      },
    });
    if (!record) throw errors.notFound("Device token not found");

    await prisma.deviceToken.delete({
      where: { id: record.id },
    });

    return { success: true };
  }
}
