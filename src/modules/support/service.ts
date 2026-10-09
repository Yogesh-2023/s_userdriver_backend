import {
  Prisma,
  SupportPriority,
  SupportTicketStatus,
  type SupportMessage,
} from "@prisma/client";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import {
  emitAdminRoom,
  emitTicket,
  emitUser,
} from "../../infrastructure/realtime";
import { uploadSupportAttachment } from "../../integrations/storage";
import { ensureSupportCategories } from "./seed-categories";
import { withUniqueTicketNumber } from "./ticket-number";

export type TicketAttachment = { url: string; name?: string };

const shapeMessage = (ticketOwnerId: string, message: SupportMessage) => ({
  id: message.id,
  ticketId: message.ticketId,
  senderId: message.senderUserId,
  senderType: message.senderUserId === ticketOwnerId ? "USER" : "SUPPORT",
  message: message.message,
  attachments: message.attachments,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
});

const shapeTicket = (
  ticket: Prisma.SupportTicketGetPayload<{
    include: { messages: { take: number } };
  }>,
  opts?: { unreadMessages?: number },
) => {
  const firstMessage = ticket.messages[0];
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.subject,
    subject: ticket.subject,
    description: firstMessage?.message ?? null,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    categoryId: ticket.categoryId,
    attachments: firstMessage?.attachments ?? null,
    bookingId: ticket.bookingId,
    tripId: ticket.tripId,
    paymentId: ticket.paymentId,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    ...(opts?.unreadMessages != null && {
      unreadMessages: opts.unreadMessages,
    }),
  };
};

const normalizeAttachments = (
  input?:
    | TicketAttachment
    | TicketAttachment[]
    | Array<{ key: string; name?: string }>
    | string
    | null,
): TicketAttachment[] | undefined => {
  if (!input) return undefined;
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed ? [{ url: trimmed, name: "attachment" }] : undefined;
  }
  const items: Array<TicketAttachment | { key: string; name?: string }> =
    Array.isArray(input) ? input : [input];
  const normalized = items
    .map((item) => {
      const url =
        "url" in item && item.url
          ? item.url.trim()
          : "key" in item && item.key
            ? item.key.trim()
            : "";
      const name =
        "name" in item && item.name && item.name.trim()
          ? item.name.trim().slice(0, 255)
          : "attachment";
      return { url, name };
    })
    .filter((item) => item.url.length > 0);
  return normalized.length ? normalized : undefined;
};

export class SupportService {
  async listCategories() {
    return prisma.supportCategory.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, description: true },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Single reusable ticket creation for both customers and drivers.
   * Resource ownership is enforced for the requester (customer or assigned driver).
   */
  async create(
    userId: string,
    input: {
      categoryId?: string;
      subject: string;
      message?: string;
      description?: string;
      bookingId?: string;
      tripId?: string;
      paymentId?: string;
      priority?: SupportPriority;
      attachments?:
        | TicketAttachment
        | TicketAttachment[]
        | Array<{ key: string; name?: string }>
        | string
        | null;
    },
  ) {
    const description = (input.message ?? input.description ?? "").trim();
    if (!description) {
      throw errors.badRequest("Ticket description is required");
    }
    let categoryId = input.categoryId;
    if (!categoryId) {
      await ensureSupportCategories();
      const general = await prisma.supportCategory.findFirst({
        where: { code: "GENERAL", isActive: true },
      });
      if (!general) throw errors.unavailable("No support category configured");
      categoryId = general.id;
    }
    const categoryDef = await prisma.supportCategory.findUnique({
      where: { id: categoryId },
    });
    if (!categoryDef) throw errors.notFound("Support category not found");

    // Validate resource ownership (customer or assigned driver)
    const linkedBookingIds = new Set<string>();
    if (input.bookingId) linkedBookingIds.add(input.bookingId);
    if (input.tripId) {
      const trip = await prisma.trip.findUnique({
        where: { id: input.tripId },
        select: { bookingId: true },
      });
      if (!trip) throw errors.notFound("Trip not found");
      linkedBookingIds.add(trip.bookingId);
    }
    if (input.paymentId) {
      const payment = await prisma.payment.findUnique({
        where: { id: input.paymentId },
        select: { bookingId: true },
      });
      if (!payment) throw errors.notFound("Payment not found");
      if (payment.bookingId) linkedBookingIds.add(payment.bookingId);
    }
    if (linkedBookingIds.size > 1) {
      throw errors.badRequest("Linked records must belong to one booking");
    }
    const linkedBookingId = [...linkedBookingIds][0];
    if (linkedBookingId) {
      await this.assertBookingAccess(linkedBookingId, userId);
    }

    const attachments = normalizeAttachments(input.attachments);

    const ticket = await withUniqueTicketNumber(async (ticketNumber) => {
      const created = await prisma.$transaction(async (tx) => {
        const createdTicket = await tx.supportTicket.create({
          data: {
            ticketNumber,
            createdByUserId: userId,
            categoryId,
            subject: input.subject,
            category: categoryDef.name,
            priority: input.priority ?? SupportPriority.MEDIUM,
            status: SupportTicketStatus.OPEN,
            bookingId: linkedBookingId,
            tripId: input.tripId,
            paymentId: input.paymentId,
            messages: {
              create: {
                senderUserId: userId,
                message: description,
                isInternal: false,
                attachments: attachments
                  ? (attachments as Prisma.InputJsonArray)
                  : undefined,
              },
            },
          },
          include: { messages: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "SUPPORT_TICKET_CREATED",
            entityType: "SupportTicket",
            entityId: createdTicket.id,
            metadata: {
              ticketNumber,
              bookingId: linkedBookingId,
              tripId: input.tripId,
              paymentId: input.paymentId,
            },
          },
        });
        return createdTicket;
      });
      emitAdminRoom("support", "admin:support:ticket-created", created);
      emitAdminRoom("dashboard", "admin:dashboard:update", {
        reason: "support.ticket-created",
        ticketId: created.id,
      });
      return created;
    });

    return shapeTicket(ticket);
  }

  async list(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = { createdByUserId: userId };

    const [tickets, total] = await prisma.$transaction([
      prisma.supportTicket.findMany({
        where,
        include: {
          messages: {
            where: { isInternal: false },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.supportTicket.count({ where }),
    ]);

    const ticketIds = tickets.map((ticket) => ticket.id);
    const unreadRows = ticketIds.length
      ? await prisma.supportMessage.groupBy({
          by: ["ticketId"],
          where: {
            ticketId: { in: ticketIds },
            isInternal: false,
            senderUserId: { not: userId },
            userReads: { none: { userId } },
          },
          _count: true,
        })
      : [];
    const unreadByTicket = new Map(
      unreadRows.map((row) => [row.ticketId, row._count]),
    );

    return {
      items: tickets.map((ticket) =>
        shapeTicket(ticket, {
          unreadMessages: unreadByTicket.get(ticket.id) ?? 0,
        }),
      ),
      total,
    };
  }

  async get(ticketId: string, userId: string) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        createdBy: { select: { id: true, displayName: true, phone: true } },
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!ticket || ticket.createdByUserId !== userId) {
      throw errors.notFound("Support ticket not found");
    }

    const unreadMessages = await prisma.supportMessage.count({
      where: {
        ticketId,
        isInternal: false,
        senderUserId: { not: userId },
        userReads: { none: { userId } },
      },
    });

    const firstMessage = ticket.messages[0];
    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      title: ticket.subject,
      subject: ticket.subject,
      description: firstMessage?.message ?? null,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      categoryId: ticket.categoryId,
      attachments: firstMessage?.attachments ?? null,
      bookingId: ticket.bookingId,
      tripId: ticket.tripId,
      paymentId: ticket.paymentId,
      resolvedAt: ticket.resolvedAt,
      escalatedAt: ticket.escalatedAt,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      unreadMessages,
      requester: {
        id: ticket.createdBy.id,
        displayName: ticket.createdBy.displayName,
        phone: ticket.createdBy.phone,
      },
      messages: ticket.messages.map((message) =>
        shapeMessage(ticket.createdByUserId, message),
      ),
    };
  }

  async getMessages(userId: string, ticketId: string) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, createdByUserId: userId },
      select: { id: true, createdByUserId: true },
    });
    if (!ticket) throw errors.notFound("Support ticket not found");

    const messages = await prisma.supportMessage.findMany({
      where: { ticketId, isInternal: false },
      orderBy: { createdAt: "asc" },
    });
    return messages.map((message) =>
      shapeMessage(ticket.createdByUserId, message),
    );
  }

  async reply(
    ticketId: string,
    userId: string,
    input: { message: string; attachments?: unknown },
  ) {
    return this.createMessage(
      userId,
      ticketId,
      input.message,
      input.attachments as never,
    );
  }

  async createMessage(
    userId: string,
    ticketId: string,
    message: string,
    attachments?:
      | TicketAttachment
      | TicketAttachment[]
      | Array<{ key: string; name?: string }>
      | string
      | null,
  ) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || ticket.createdByUserId !== userId) {
      throw errors.notFound("Support ticket not found");
    }
    if (
      ticket.status === SupportTicketStatus.RESOLVED ||
      ticket.status === SupportTicketStatus.CLOSED
    ) {
      throw errors.conflict("Cannot send messages to a resolved ticket");
    }
    const normalizedAttachments = normalizeAttachments(attachments);

    const created = await prisma.$transaction(async (tx) => {
      const messageRow = await tx.supportMessage.create({
        data: {
          ticketId,
          senderUserId: userId,
          message: message.trim(),
          isInternal: false,
          attachments: normalizedAttachments
            ? (normalizedAttachments as Prisma.InputJsonArray)
            : undefined,
        },
      });

      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { updatedAt: new Date() },
      });
      return messageRow;
    });

    const payload = shapeMessage(ticket.createdByUserId, created);
    emitTicket(ticketId, "support:message", payload);
    emitUser(userId, "support:ticket-updated", { ticketId });
    emitAdminRoom("support", "admin:support:ticket-updated", {
      ticketId,
      messageId: created.id,
    });
    return payload;
  }

  async markMessagesRead(userId: string, ticketId: string) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, createdByUserId: userId },
      select: { id: true },
    });
    if (!ticket) throw errors.notFound("Support ticket not found");

    const unreadMessages = await prisma.supportMessage.findMany({
      where: {
        ticketId,
        isInternal: false,
        senderUserId: { not: userId },
      },
      select: { id: true },
    });
    if (unreadMessages.length) {
      await prisma.supportMessageRead.createMany({
        data: unreadMessages.map(({ id }) => ({ userId, messageId: id })),
        skipDuplicates: true,
      });
    }
    return {
      markedRead: unreadMessages.length,
      unreadCount: 0,
    };
  }

  async closeTicket(userId: string, ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || ticket.createdByUserId !== userId) {
      throw errors.notFound("Support ticket not found");
    }
    if (ticket.status === SupportTicketStatus.RESOLVED) {
      return { success: true };
    }

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: SupportTicketStatus.RESOLVED, resolvedAt: new Date() },
    });

    emitTicket(ticketId, "support:ticket-updated", { ticketId });
    emitAdminRoom("support", "admin:support:ticket-updated", { ticketId });
    return { success: true };
  }

  async uploadAttachment(
    userId: string,
    contentType: string,
    body: Buffer,
    filename?: string,
  ) {
    const result = await uploadSupportAttachment(
      userId,
      contentType,
      body,
      filename,
    );
    return {
      url: result.url,
      name: result.name,
      key: result.key,
      contentType: result.contentType,
      sizeBytes: result.sizeBytes,
    };
  }

  private async assertBookingAccess(bookingId: string, userId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        customer: { select: { userId: true } },
        assignedDriver: { select: { userId: true } },
        dispatchOffers: {
          where: { status: "ACCEPTED" },
          select: { driver: { select: { userId: true } } },
        },
        trip: { select: { driver: { select: { userId: true } } } },
      },
    });
    const isOwner =
      booking &&
      (booking.customer.userId === userId ||
        booking.assignedDriver?.userId === userId ||
        booking.dispatchOffers.some(({ driver }) => driver.userId === userId) ||
        booking.trip?.driver.userId === userId);
    if (!isOwner) {
      throw errors.forbidden("Linked booking access denied");
    }
  }
}
