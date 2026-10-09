import { Prisma, SupportPriority, SupportTicketStatus } from "@prisma/client";
import { errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import {
  emitAdminRoom,
  emitTicket,
  emitUser,
} from "../../../infrastructure/realtime";
import { NotificationsService } from "../../notifications/service";
import { withUniqueTicketNumber } from "../../support/ticket-number";
import { isValidUUID } from "../admin.utils";
import type { AdminActionContext } from "../admin.constants";

const transitions: Record<SupportTicketStatus, readonly SupportTicketStatus[]> =
  {
    OPEN: [
      SupportTicketStatus.IN_PROGRESS,
      SupportTicketStatus.WAITING_FOR_CUSTOMER,
      SupportTicketStatus.RESOLVED,
      SupportTicketStatus.ESCALATED,
      SupportTicketStatus.CLOSED,
    ],
    IN_PROGRESS: [
      SupportTicketStatus.WAITING_FOR_CUSTOMER,
      SupportTicketStatus.RESOLVED,
      SupportTicketStatus.ESCALATED,
      SupportTicketStatus.CLOSED,
    ],
    WAITING_FOR_CUSTOMER: [
      SupportTicketStatus.IN_PROGRESS,
      SupportTicketStatus.RESOLVED,
      SupportTicketStatus.ESCALATED,
      SupportTicketStatus.CLOSED,
    ],
    RESOLVED: [SupportTicketStatus.CLOSED, SupportTicketStatus.IN_PROGRESS],
    CLOSED: [],
    ESCALATED: [
      SupportTicketStatus.IN_PROGRESS,
      SupportTicketStatus.RESOLVED,
      SupportTicketStatus.CLOSED,
    ],
  };

export class AdminSupportService {
  private readonly notifications = new NotificationsService();

  async list(
    input: {
      page: number;
      limit: number;
      search?: string;
      status?: SupportTicketStatus;
      priority?: SupportPriority;
      assignedAdminId?: string;
      requesterType?: "USER" | "DRIVER";
      from?: Date;
      to?: Date;
    },
    adminId: string,
    isSuperAdmin: boolean,
  ) {
    const where: Prisma.SupportTicketWhereInput = {
      status: input.status,
      priority: input.priority,
      assignedAdminId: input.assignedAdminId,
      createdAt: { gte: input.from, lte: input.to },
      ...(input.requesterType === "USER"
        ? { createdBy: { is: { customerProfile: { is: {} } } } }
        : input.requesterType === "DRIVER"
          ? { createdBy: { is: { driverProfile: { is: {} } } } }
          : {}),
      ...(input.search
        ? {
            OR: [
              ...(isValidUUID(input.search)
                ? [{ id: { equals: input.search } }]
                : []),
              {
                subject: {
                  contains: input.search,
                  mode: "insensitive" as const,
                },
              },
              {
                category: {
                  contains: input.search,
                  mode: "insensitive" as const,
                },
              },
              {
                createdBy: {
                  OR: [
                    {
                      displayName: {
                        contains: input.search,
                        mode: "insensitive" as const,
                      },
                    },
                    { phone: { contains: input.search } },
                    {
                      email: {
                        contains: input.search,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
      ...(isSuperAdmin
        ? {}
        : {
            OR: [{ isRestricted: false }, { assignedAdminId: adminId }],
          }),
    };
    const [items, total] = await prisma.$transaction([
      prisma.supportTicket.findMany({
        where,
        include: {
          createdBy: {
            select: {
              displayName: true,
              phone: true,
              email: true,
              customerProfile: { select: { id: true } },
              driverProfile: { select: { id: true } },
              adminProfile: { select: { id: true } },
            },
          },
          assignedAdmin: true,
          categoryDefinition: true,
          _count: { select: { messages: true } },
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.supportTicket.count({ where }),
    ]);

    const shaped = items.map((item) => ({
      ...item,
      requesterType: item.createdBy.driverProfile
        ? ("DRIVER" as const)
        : item.createdBy.customerProfile
          ? ("USER" as const)
          : ("UNKNOWN" as const),
    }));
    return { items: shaped, total };
  }

  async inbox(
    input: { page: number; limit: number },
    actor: AdminActionContext,
    isSuperAdmin: boolean,
  ) {
    const offset = (input.page - 1) * input.limit;
    const accessClause = Prisma.sql`
      (${isSuperAdmin}::boolean = true
        OR st."isRestricted" = false
        OR st."assignedAdminId" = ${actor.adminId}::uuid)
    `;

    const [items, totalRows] = await prisma.$transaction([
      prisma.$queryRaw<
        Array<{
          id: string;
          ticketId: string;
          subject: string;
          ticketStatus: string;
          priority: string;
          message: string;
          senderName: string | null;
          senderEmail: string | null;
          senderPhone: string | null;
          createdAt: Date;
          isRead: boolean;
        }>
      >(Prisma.sql`
        SELECT
          sm."id",
          sm."ticketId",
          st."subject",
          st."status"::text AS "ticketStatus",
          st."priority"::text AS "priority",
          sm."message",
          u."displayName" AS "senderName",
          u."email" AS "senderEmail",
          u."phone" AS "senderPhone",
          sm."createdAt",
          (amr."id" IS NOT NULL) AS "isRead"
        FROM "SupportMessage" sm
        INNER JOIN "SupportTicket" st ON st."id" = sm."ticketId"
        INNER JOIN "User" u ON u."id" = sm."senderUserId"
        LEFT JOIN "AdminSupportMessageRead" amr
          ON amr."messageId" = sm."id"
          AND amr."adminId" = ${actor.adminId}::uuid
        WHERE sm."isInternal" = false
          AND sm."senderUserId" <> ${actor.userId}::uuid
          AND ${accessClause}
        ORDER BY sm."createdAt" DESC
        LIMIT ${input.limit}
        OFFSET ${offset}
      `),
      prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS "total"
        FROM "SupportMessage" sm
        INNER JOIN "SupportTicket" st ON st."id" = sm."ticketId"
        WHERE sm."isInternal" = false
          AND sm."senderUserId" <> ${actor.userId}::uuid
          AND ${accessClause}
      `),
    ]);

    return { items, total: Number(totalRows[0]?.total ?? 0) };
  }

  async unreadInboxCount(actor: AdminActionContext, isSuperAdmin: boolean) {
    const rows = await prisma.$queryRaw<Array<{ unreadCount: number }>>(
      Prisma.sql`
        SELECT COUNT(*)::int AS "unreadCount"
        FROM "SupportMessage" sm
        INNER JOIN "SupportTicket" st ON st."id" = sm."ticketId"
        LEFT JOIN "AdminSupportMessageRead" amr
          ON amr."messageId" = sm."id"
          AND amr."adminId" = ${actor.adminId}::uuid
        WHERE sm."isInternal" = false
          AND sm."senderUserId" <> ${actor.userId}::uuid
          AND amr."id" IS NULL
          AND (${isSuperAdmin}::boolean = true
            OR st."isRestricted" = false
            OR st."assignedAdminId" = ${actor.adminId}::uuid)
      `,
    );

    return { unreadCount: Math.max(0, Number(rows[0]?.unreadCount ?? 0)) };
  }

  async markInboxMessageRead(
    messageId: string,
    actor: AdminActionContext,
    isSuperAdmin: boolean,
  ) {
    const message = await prisma.supportMessage.findFirst({
      where: {
        id: messageId,
        isInternal: false,
        senderUserId: { not: actor.userId },
        ticket: isSuperAdmin ? undefined : {
          OR: [
            { isRestricted: false },
            { assignedAdminId: actor.adminId }
          ]
        }
      }
    });

    if (!message) throw errors.notFound("Support message not found");

    await prisma.adminSupportMessageRead.upsert({
      where: {
        adminId_messageId: {
          adminId: actor.adminId,
          messageId: message.id
        }
      },
      create: {
        adminId: actor.adminId,
        messageId: message.id
      },
      update: {}
    });
  }

  async markAllInboxMessagesRead(
    actor: AdminActionContext,
    isSuperAdmin: boolean,
  ) {
    const unreadMessages = await prisma.supportMessage.findMany({
      where: {
        isInternal: false,
        senderUserId: { not: actor.userId },
        ticket: isSuperAdmin ? undefined : {
          OR: [
            { isRestricted: false },
            { assignedAdminId: actor.adminId }
          ]
        },
        adminReads: {
          none: {
            adminId: actor.adminId
          }
        }
      },
      select: { id: true }
    });

    if (unreadMessages.length === 0) return;

    await prisma.adminSupportMessageRead.createMany({
      data: unreadMessages.map(m => ({
        adminId: actor.adminId,
        messageId: m.id
      })),
      skipDuplicates: true
    });
  }

  async get(ticketId: string, adminId: string, isSuperAdmin: boolean) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        createdBy: {
          select: {
            id: true,
            displayName: true,
            phone: true,
            email: true,
            customerProfile: { select: { id: true } },
            driverProfile: { select: { id: true } },
            adminProfile: { select: { id: true } },
          },
        },
        booking: true,
        trip: true,
        payment: true,
        assignedAdmin: true,
        categoryDefinition: true,
        messages: {
          include: {
            sender: {
              select: {
                id: true,
                displayName: true,
                phone: true,
                adminProfile: { select: { id: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        assignmentHistory: { orderBy: { createdAt: "asc" } },
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!ticket) throw errors.notFound("Support ticket not found");
    if (
      ticket.isRestricted &&
      ticket.assignedAdminId !== adminId &&
      !isSuperAdmin
    ) {
      throw errors.forbidden("Restricted support ticket access denied");
    }
    return ticket;
  }

  async reply(
    ticketId: string,
    input: {
      message: string;
      attachments?: Array<{ key: string; name: string }>;
    },
    actor: AdminActionContext,
  ) {
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findUnique({
        where: { id: ticketId },
      });
      if (!ticket) throw errors.notFound("Support ticket not found");
      if (ticket.status === "CLOSED") {
        throw errors.conflict("Closed ticket cannot receive replies");
      }
      const message = await tx.supportMessage.create({
        data: {
          ticketId,
          senderUserId: actor.userId,
          message: this.sanitize(input.message),
          attachments: input.attachments,
          isInternal: false,
        },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          firstRespondedAt: ticket.firstRespondedAt ?? new Date(),
          status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status,
          statusHistory:
            ticket.status === "OPEN"
              ? {
                  create: {
                    adminId: actor.adminId,
                    fromStatus: "OPEN",
                    toStatus: "IN_PROGRESS",
                    reason: "First admin response",
                  },
                }
              : undefined,
        },
      });
      await this.audit(tx, actor, ticketId, "ADMIN_SUPPORT_REPLY");
      return { message, userId: ticket.createdByUserId };
    });
    await this.notifications.enqueue({
      userId: result.userId,
      channel: "IN_APP",
      templateKey: "SUPPORT_ADMIN_REPLY",
      title: "Support replied",
      body: "Your support ticket has a new reply.",
      data: { ticketId },
    });
    this.emit(ticketId, result.userId);
    return result.message;
  }

  async addInternalNote(
    ticketId: string,
    note: string,
    actor: AdminActionContext,
  ) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) throw errors.notFound("Support ticket not found");
    const message = await prisma.supportMessage.create({
      data: {
        ticketId,
        senderUserId: actor.userId,
        message: this.sanitize(note),
        isInternal: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_SUPPORT_INTERNAL_NOTE",
        entityType: "SupportTicket",
        entityId: ticketId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
    });
    emitAdminRoom("support", "admin:support:ticket-updated", { ticketId });
    return message;
  }

  async updateStatus(
    ticketId: string,
    input: { status: SupportTicketStatus; reason: string; resolution?: string },
    actor: AdminActionContext,
  ) {
    const result = await prisma.$transaction(
      async (tx) => {
        const ticket = await tx.supportTicket.findUnique({
          where: { id: ticketId },
          include: {
            createdBy: {
              select: {
                customerProfile: { select: { id: true } },
                driverProfile: { select: { id: true } },
              },
            },
          },
        });
        if (!ticket) throw errors.notFound("Support ticket not found");
        if (!transitions[ticket.status].includes(input.status)) {
          throw errors.conflict("Invalid support status transition");
        }
        const changed = await tx.supportTicket.updateMany({
          where: { id: ticketId, status: ticket.status },
          data: {
            status: input.status,
            resolvedAt:
              input.status === "RESOLVED" || input.status === "CLOSED"
                ? (ticket.resolvedAt ?? new Date())
                : null,
            escalatedAt:
              input.status === "ESCALATED"
                ? (ticket.escalatedAt ?? new Date())
                : ticket.escalatedAt,
            ...(input.status === "RESOLVED" || input.status === "CLOSED"
              ? { resolution: input.resolution ?? ticket.resolution }
              : {}),
          },
        });
        if (changed.count !== 1) {
          throw errors.conflict("Support ticket changed; retry");
        }
        await tx.supportStatusHistory.create({
          data: {
            ticketId,
            adminId: actor.adminId,
            fromStatus: ticket.status,
            toStatus: input.status,
            reason: input.reason,
          },
        });
        await this.audit(
          tx,
          actor,
          ticketId,
          input.status === "ESCALATED"
            ? "ADMIN_SUPPORT_ESCALATED"
            : "ADMIN_SUPPORT_STATUS_UPDATED",
          input.reason,
          { status: ticket.status },
          { status: input.status },
        );
        return {
          ticketId,
          userId: ticket.createdByUserId,
          status: input.status,
          ticketNumber: ticket.ticketNumber,
          requesterType: ticket.createdBy.driverProfile ? "DRIVER" : "USER",
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const deepLink = {
      type: "SUPPORT_TICKET" as const,
      ticketId,
      ticketNumber: result.ticketNumber ?? undefined,
      requesterType: result.requesterType,
      status: result.status,
      route: `/support/tickets/${ticketId}`,
    };
    await this.notifications.enqueue({
      userId: result.userId,
      channel: "IN_APP",
      templateKey: "SUPPORT_STATUS_UPDATED",
      title: "Support ticket updated",
      body: `Your support ticket is now ${result.status}.`,
      data: deepLink,
    });
    await this.notifications.enqueue({
      userId: result.userId,
      channel: "PUSH",
      templateKey: "SUPPORT_STATUS_UPDATED",
      title: "Support ticket updated",
      body:
        result.status === "RESOLVED" && input.resolution
          ? `Your ticket was resolved: ${input.resolution}`
          : `Your support ticket is now ${result.status}.`,
      data: deepLink,
    });
    this.emit(ticketId, result.userId);
    return result;
  }

  async updatePriority(
    ticketId: string,
    input: { priority: SupportPriority; reason: string },
    actor: AdminActionContext,
  ) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw errors.notFound("Support ticket not found");
    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { priority: input.priority },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_SUPPORT_PRIORITY_UPDATED",
        entityType: "SupportTicket",
        entityId: ticketId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        reason: input.reason,
        before: { priority: ticket.priority },
        after: { priority: input.priority },
      },
    });
    this.emit(ticketId, ticket.createdByUserId);
    return updated;
  }

  async assign(
    ticketId: string,
    targetAdminId: string,
    reason: string | undefined,
    actor: AdminActionContext,
  ) {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support:${ticketId}`}))`;
        const [ticket, target] = await Promise.all([
          tx.supportTicket.findUnique({ where: { id: ticketId } }),
          tx.adminProfile.findUnique({
            where: { id: targetAdminId },
            include: { user: true },
          }),
        ]);
        if (!ticket) throw errors.notFound("Support ticket not found");
        if (!target || target.user.status !== "ACTIVE") {
          throw errors.conflict("Target admin is not active");
        }
        const updated = await tx.supportTicket.update({
          where: { id: ticketId },
          data: {
            assignedAdminId: targetAdminId,
            status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status,
          },
        });
        await tx.supportAssignmentHistory.create({
          data: {
            ticketId,
            assignedById: actor.adminId,
            assignedToId: targetAdminId,
            previousAdminId: ticket.assignedAdminId,
            reason,
          },
        });
        if (ticket.status === "OPEN") {
          await tx.supportStatusHistory.create({
            data: {
              ticketId,
              adminId: actor.adminId,
              fromStatus: "OPEN",
              toStatus: "IN_PROGRESS",
              reason: reason ?? "Ticket assigned to an administrator",
            },
          });
        }
        await this.audit(
          tx,
          actor,
          ticketId,
          "ADMIN_SUPPORT_ASSIGNED",
          reason,
          { assignedAdminId: ticket.assignedAdminId },
          { assignedAdminId: targetAdminId },
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    emitAdminRoom("support", "admin:support:ticket-updated", {
      ticketId,
      assignedAdminId: targetAdminId,
    });
    return result;
  }

  escalate(ticketId: string, reason: string, actor: AdminActionContext) {
    return this.updateStatus(ticketId, { status: "ESCALATED", reason }, actor);
  }

  categories() {
    return prisma.supportCategory.findMany({
      orderBy: { name: "asc" },
    });
  }

  async createCategory(
    input: {
      code: string;
      name: string;
      description?: string;
      isActive: boolean;
    },
    actor: AdminActionContext,
  ) {
    const category = await prisma.supportCategory.create({
      data: { ...input, createdByAdminId: actor.adminId },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_SUPPORT_CATEGORY_CREATED",
        entityType: "SupportCategory",
        entityId: category.id,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
    });
    return category;
  }

  async updateCategory(
    categoryId: string,
    input: Partial<{
      code: string;
      name: string;
      description: string;
      isActive: boolean;
    }>,
    actor: AdminActionContext,
  ) {
    const category = await prisma.supportCategory.update({
      where: { id: categoryId },
      data: input,
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_SUPPORT_CATEGORY_UPDATED",
        entityType: "SupportCategory",
        entityId: categoryId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
    });
    return category;
  }

  private emit(ticketId: string, userId: string) {
    const data = { ticketId };
    emitAdminRoom("support", "admin:support:ticket-updated", data);
    emitUser(userId, "support:ticket-updated", data);
    emitTicket(ticketId, "support:ticket-updated", data);
  }

  private sanitize(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AdminActionContext,
    ticketId: string,
    action: string,
    reason?: string,
    before?: Prisma.InputJsonObject,
    after?: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action,
        entityType: "SupportTicket",
        entityId: ticketId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        reason,
        before,
        after,
      },
    });
  }

  async createTicket(payload: {
    userId: string;
    categoryId: string;
    title: string;
    description: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  }) {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });
    if (!user) throw errors.notFound("User not found");
    const category = await prisma.supportCategory.findUnique({
      where: { id: payload.categoryId },
    });
    if (!category) throw errors.notFound("Support category not found");

    return withUniqueTicketNumber(async (ticketNumber) =>
      prisma.supportTicket.create({
        data: {
          ticketNumber,
          subject: payload.title,
          category: category.name,
          priority: payload.priority,
          createdByUserId: payload.userId,
          categoryId: payload.categoryId,
          status: "OPEN",
          messages: {
            create: {
              message: payload.description,
              senderUserId: payload.userId,
            },
          },
        },
      }),
    );
  }

  async updateTicket(
    ticketId: string,
    payload: {
      title?: string;
      description?: string;
      categoryId?: string;
      priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    },
  ) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw errors.notFound("Support ticket not found");

    let catName;
    if (payload.categoryId) {
      const category = await prisma.supportCategory.findUnique({
        where: { id: payload.categoryId },
      });
      if (!category) throw errors.notFound("Support category not found");
      catName = category.name;
    }

    return prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        ...(payload.title && { subject: payload.title }),
        ...(payload.categoryId && {
          categoryId: payload.categoryId,
          category: catName,
        }),
        ...(payload.priority && { priority: payload.priority }),
      },
    });
  }

  async deleteTicket(ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw errors.notFound("Support ticket not found");

    await prisma.supportTicket.delete({ where: { id: ticketId } });
    return { id: ticketId };
  }

  async statistics() {
    const [statusCounts, priorityCounts] = await Promise.all([
      prisma.supportTicket.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.supportTicket.groupBy({
        by: ["priority"],
        _count: true,
      }),
    ]);

    return {
      status: statusCounts,
      priority: priorityCounts,
    };
  }

  async exportTickets(page: number, limit: number, filter: any) {
    // For export, we just fetch a bunch of rows (can be used for CSV generation on client or server).
    // Re-use list query but with larger limit.
    const tickets = await prisma.supportTicket.findMany({
      where: filter,
      include: {
        createdBy: {
          select: { id: true, displayName: true, email: true, phone: true },
        },
        categoryDefinition: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return tickets;
  }
}
