import type { SupportPriority } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { SupportService, type TicketAttachment } from "../../support/service";

const support = new SupportService();

export class DriverSupportService {
  async getNotifications(userId: string, limit = 20, offset = 0) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  async getUnreadCount(userId: string) {
    const count = await prisma.notification.count({
      where: { userId, status: { not: "READ" } },
    });
    return { unreadCount: count };
  }

  async markRead(userId: string, notificationId: string) {
    const updated = await prisma.notification.updateMany({
      where: { id: notificationId, userId, status: { not: "READ" } },
      data: { status: "READ", readAt: new Date() },
    });
    if (!updated.count) {
      const owned = await prisma.notification.count({
        where: { id: notificationId, userId },
      });
      if (!owned) throw errors.notFound("Notification not found");
    }
    return updated;
  }

  async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, status: { not: "READ" } },
      data: { status: "READ", readAt: new Date() },
    });
  }

  async deleteNotification(userId: string, notificationId: string) {
    const deleted = await prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
    if (!deleted.count) throw errors.notFound("Notification not found");
  }

  async addDeviceToken(userId: string, token: string, platform: string) {
    return prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform, lastSeenAt: new Date() },
      create: { userId, token, platform },
    });
  }

  async removeDeviceToken(userId: string, token: string) {
    return prisma.deviceToken.deleteMany({
      where: { userId, token },
    });
  }

  async removeDevice(userId: string, deviceId: string) {
    const deleted = await prisma.deviceToken.deleteMany({
      where: { id: deviceId, userId },
    });
    if (!deleted.count) throw errors.notFound("Device not found");
  }

  getCategories() {
    return support.listCategories();
  }

  createTicket(
    userId: string,
    data: {
      categoryId?: string;
      subject: string;
      description: string;
      bookingId?: string;
      tripId?: string;
      priority?: SupportPriority;
      attachments?: TicketAttachment | TicketAttachment[] | string | null;
    },
  ) {
    return support.create(userId, {
      categoryId: data.categoryId,
      subject: data.subject,
      description: data.description,
      bookingId: data.bookingId,
      tripId: data.tripId,
      priority: data.priority,
      attachments: data.attachments,
    });
  }

  getTickets(userId: string, page?: number, limit?: number) {
    return support.list(userId, page ?? 1, limit ?? 20);
  }

  getTicket(userId: string, ticketId: string) {
    return support.get(ticketId, userId);
  }

  getMessages(userId: string, ticketId: string) {
    return support.getMessages(userId, ticketId);
  }

  addTicketMessage(
    userId: string,
    ticketId: string,
    message: string,
    attachments?: TicketAttachment | TicketAttachment[] | string | null,
  ) {
    return support.createMessage(userId, ticketId, message, attachments);
  }

  markMessagesRead(userId: string, ticketId: string) {
    return support.markMessagesRead(userId, ticketId);
  }

  uploadAttachment(
    userId: string,
    contentType: string,
    body: Buffer,
    filename?: string,
  ) {
    return support.uploadAttachment(userId, contentType, body, filename);
  }

  closeTicket(userId: string, ticketId: string) {
    return support.closeTicket(userId, ticketId);
  }

  reportBooking(
    userId: string,
    bookingId: string,
    input: {
      category: string;
      description: string;
    },
  ) {
    return support.create(userId, {
      bookingId,
      subject: `${input.category.replaceAll("_", " ")} report`,
      description: input.description,
      priority: input.category.includes("SAFETY") ? "URGENT" : "MEDIUM",
    });
  }
}
