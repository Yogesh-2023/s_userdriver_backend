import { Prisma, SupportPriority } from "@prisma/client";
import { errors } from "../../common/errors";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../database/prisma";
import {
  emitAdminRoom,
  emitAdmins,
  emitBooking,
  emitSos,
  emitUser,
} from "../../infrastructure/realtime";
import { NotificationsService } from "../notifications/service";
import { withUniqueSosNumber } from "./sos-number";

const ACTIVE_STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] as const;
const TERMINAL_STATUSES = ["RESOLVED", "FALSE_ALARM", "CLOSED"] as const;

type SosInput = {
  bookingId?: string;
  tripId?: string;
  latitude: number;
  longitude: number;
  message?: string;
};

type RequesterContext = {
  userId: string;
  requesterType: "USER" | "DRIVER";
  bookingId: string;
  otherUserId?: string;
  customerId?: string;
  driverId?: string;
  tripId?: string;
};

const shapeMessage = (message: {
  id: string;
  sosId: string;
  senderId: string;
  sender: { adminProfile: { id: string } | null; displayName: string | null };
  message: string;
  isInternal: boolean;
  attachments: Prisma.JsonValue | null;
  createdAt: Date;
}) => ({
  id: message.id,
  sosId: message.sosId,
  senderId: message.senderId,
  senderRole: message.sender.adminProfile ? "ADMIN" : "USER",
  senderName: message.sender.displayName,
  message: message.message,
  isInternal: message.isInternal,
  attachments: message.attachments,
  createdAt: message.createdAt,
});

export class SafetyService {
  private readonly notifications = new NotificationsService();

  private async resolveRequester(
    userId: string,
    input: SosInput,
  ): Promise<RequesterContext> {
    let bookingId = input.bookingId;
    let tripId = input.tripId;

    if (tripId) {
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        include: { driver: { select: { id: true, userId: true } } },
      });
      if (!trip) throw errors.notFound("Trip not found");
      bookingId = trip.bookingId;
      if (trip.driver.userId !== userId) {
        throw errors.forbidden("SOS access denied");
      }
    }

    if (!bookingId) throw errors.badRequest("Booking is required for SOS");

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: { select: { id: true, userId: true } },
        assignedDriver: { select: { id: true, userId: true } },
        dispatchOffers: {
          where: { status: "ACCEPTED" },
          select: { driver: { select: { id: true, userId: true } } },
        },
        trip: { select: { id: true } },
      },
    });
    if (!booking) throw errors.notFound("Booking not found");
    if (booking.trip) tripId = booking.trip.id;

    const isCustomer = booking.customer.userId === userId;
    const isDriver =
      booking.assignedDriver?.userId === userId ||
      booking.dispatchOffers.some(({ driver }) => driver.userId === userId);
    if (!isCustomer && !isDriver) {
      throw errors.forbidden("SOS access denied");
    }

    return {
      userId,
      requesterType: isDriver ? "DRIVER" : "USER",
      bookingId,
      customerId: booking.customer.id,
      tripId,
      otherUserId: isCustomer
        ? (booking.assignedDriver?.userId ??
          booking.dispatchOffers[0]?.driver.userId)
        : booking.customer.userId,
    };
  }

  /**
   * Unified entry point for both customers and drivers. The requester is
   * resolved from booking ownership so each app uses the exact same code path.
   */
  async createSos(userId: string, input: SosInput) {
    const ctx = await this.resolveRequester(userId, input);

    const existing = await prisma.sosRequest.findFirst({
      where: {
        bookingId: ctx.bookingId,
        createdByUserId: userId,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
    if (existing) {
      const refreshed = await prisma.sosRequest.update({
        where: { id: existing.id },
        data: {
          latitude: input.latitude,
          longitude: input.longitude,
          locationUpdatedAt: new Date(),
        },
      });
      this.notifyAlerts(refreshed, ctx);
      return this.shapeSos(refreshed);
    }

    let sos;
    try {
      sos = await withUniqueSosNumber(async (sosNumber) =>
        prisma.$transaction(async (tx) => {
          const created = await tx.sosRequest.create({
            data: {
              sosNumber,
              bookingId: ctx.bookingId,
              createdByUserId: userId,
              requesterType: ctx.requesterType,
              latitude: input.latitude,
              longitude: input.longitude,
              message: input.message,
              status: "OPEN",
              priority: SupportPriority.HIGH,
              locationUpdatedAt: new Date(),
            },
          });
          await tx.sosActivity.create({
            data: {
              sosRequestId: created.id,
              action: "CREATED",
              note:
                ctx.requesterType === "DRIVER"
                  ? "SOS raised by driver"
                  : "SOS raised by user",
            },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: userId,
              action: "SOS_CREATED",
              entityType: "SosRequest",
              entityId: created.id,
              metadata: {
                sosNumber,
                bookingId: ctx.bookingId,
                tripId: ctx.tripId,
                requesterType: ctx.requesterType,
                latitude: input.latitude,
                longitude: input.longitude,
              },
            },
          });
          return created;
        }),
      );
    } catch (error) {
      if (this.isActiveSosConflict(error)) {
        const active = await prisma.sosRequest.findFirstOrThrow({
          where: {
            bookingId: ctx.bookingId,
            createdByUserId: userId,
            status: { in: [...ACTIVE_STATUSES] },
          },
        });
        return this.shapeSos(active);
      }
      throw error;
    }

    this.emitCreated(sos, ctx);
    this.notifyAlerts(sos, ctx);
    return this.shapeSos(sos);
  }

  async listForRequester(userId: string, page: number, limit: number) {
    const where = { createdByUserId: userId };
    const [items, total] = await prisma.$transaction([
      prisma.sosRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sosRequest.count({ where }),
    ]);
    const shaped = await Promise.all(items.map((item) => this.shapeSos(item)));
    return { items: shaped, total, page, limit };
  }

  async activeForRequester(userId: string) {
    const active = await prisma.sosRequest.findFirst({
      where: {
        createdByUserId: userId,
        status: { in: [...ACTIVE_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
    });
    return active ? this.shapeSos(active) : null;
  }

  async getSosForRequester(userId: string, sosId: string) {
    const sos = await this.requireOwnedSos(userId, sosId);
    const messages = await prisma.emergencySosMessage.findMany({
      where: { sosId, isInternal: false },
      include: {
        sender: {
          select: { adminProfile: { select: { id: true } }, displayName: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      ...(await this.shapeSos(sos)),
      messages: messages.map(shapeMessage),
    };
  }

  async getMessages(userId: string, sosId: string) {
    await this.requireOwnedSos(userId, sosId);
    const messages = await prisma.emergencySosMessage.findMany({
      where: { sosId, isInternal: false },
      include: {
        sender: {
          select: { adminProfile: { select: { id: true } }, displayName: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return messages.map(shapeMessage);
  }

  async createSosMessage(
    userId: string,
    sosId: string,
    input: { message: string },
  ) {
    const sos = await this.requireOwnedSos(userId, sosId);
    if (
      TERMINAL_STATUSES.includes(
        sos.status as (typeof TERMINAL_STATUSES)[number],
      )
    ) {
      throw errors.conflict("A closed SOS alert cannot be updated");
    }
    const message = await prisma.emergencySosMessage.create({
      data: {
        sosId,
        senderId: userId,
        message: input.message,
        isInternal: false,
      },
      include: {
        sender: {
          select: { adminProfile: { select: { id: true } }, displayName: true },
        },
      },
    });
    const shaped = shapeMessage(message);
    emitSos(sosId, "sos:message", shaped);
    emitAdminRoom("safety", "admin:sos:message", shaped);
    emitUser(userId, "sos:message", shaped);
    return shaped;
  }

  async markMessagesRead(userId: string, sosId: string) {
    await this.requireOwnedSos(userId, sosId);
    const unread = await prisma.emergencySosMessage.findMany({
      where: {
        sosId,
        senderId: { not: userId },
        sosUserMessageReads: { none: { userId } },
      },
      select: { id: true },
    });
    if (unread.length) {
      await prisma.sosUserMessageRead.createMany({
        data: unread.map(({ id }) => ({
          userId,
          messageId: id,
          sosRequestId: sosId,
        })),
        skipDuplicates: true,
      });
    }
    return { success: true, marked: unread.length };
  }

  async cancelSos(userId: string, sosId: string) {
    const sos = await prisma.sosRequest.findFirst({
      where: { id: sosId, createdByUserId: userId },
    });
    if (!sos) throw errors.notFound("SOS request not found");
    if (
      TERMINAL_STATUSES.includes(
        sos.status as (typeof TERMINAL_STATUSES)[number],
      )
    ) {
      return { success: true, sosNumber: sos.sosNumber };
    }
    await prisma.$transaction(async (tx) => {
      await tx.sosRequest.update({
        where: { id: sosId },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await tx.sosActivity.create({
        data: {
          sosRequestId: sosId,
          action: "CANCELLED_BY_REQUESTER",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "SOS_CANCELLED",
          entityType: "SosRequest",
          entityId: sosId,
        },
      });
    });
    emitSos(sosId, "sos:cancelled", { sosId, sosNumber: sos.sosNumber });
    emitAdminRoom("safety", "admin:sos:resolved", {
      sosId,
      sosNumber: sos.sosNumber,
    });
    return { success: true, sosNumber: sos.sosNumber };
  }

  createContact(
    userId: string,
    input: { name: string; phone: string; relationship?: string },
  ) {
    return prisma.emergencyContact.create({
      data: { ownerUserId: userId, ...input },
    });
  }

  async createTripShare(
    bookingId: string,
    userId: string,
    input: {
      recipientName?: string;
      recipientPhone?: string;
      expiresInMinutes: number;
    },
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true },
    });
    if (!booking || booking.customer.userId !== userId) {
      throw errors.forbidden("Trip share access denied");
    }
    const rawToken = randomUUID() + randomUUID();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const share = await prisma.tripShare.create({
      data: {
        bookingId,
        tokenHash,
        expiresAt: new Date(Date.now() + input.expiresInMinutes * 60_000),
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
      },
    });
    return { id: share.id, token: rawToken, expiresAt: share.expiresAt };
  }

  async requireOwnedSos(userId: string, sosId: string) {
    const sos = await prisma.sosRequest.findFirst({
      where: { id: sosId, createdByUserId: userId },
    });
    if (!sos) throw errors.notFound("SOS request not found");
    return sos;
  }

  private async unreadForUser(userId: string, sosId: string) {
    return prisma.emergencySosMessage.count({
      where: {
        sosId,
        senderId: { not: userId },
        sosUserMessageReads: { none: { userId } },
      },
    });
  }

  private async shapeSos(sos: {
    id: string;
    sosNumber: string;
    bookingId: string;
    createdByUserId: string;
    requesterType: "USER" | "DRIVER";
    status: string;
    priority: string;
    latitude: unknown;
    longitude: unknown;
    message: string | null;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    locationUpdatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: sos.id,
      sosNumber: sos.sosNumber,
      bookingId: sos.bookingId,
      requesterType: sos.requesterType,
      status: sos.status,
      priority: sos.priority,
      latitude: Number(sos.latitude),
      longitude: Number(sos.longitude),
      message: sos.message,
      acknowledgedAt: sos.acknowledgedAt,
      resolvedAt: sos.resolvedAt,
      closedAt: sos.closedAt,
      locationUpdatedAt: sos.locationUpdatedAt,
      createdAt: sos.createdAt,
      updatedAt: sos.updatedAt,
      unreadMessages: await this.unreadForUser(sos.createdByUserId, sos.id),
    };
  }

  private isActiveSosConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      (error.meta.target as string[]).some((t) => t === "createdByUserId")
    );
  }

  private emitCreated(
    sos: { id: string; sosNumber: string; bookingId: string },
    ctx: RequesterContext,
  ) {
    const safe = {
      sosId: sos.id,
      sosNumber: sos.sosNumber,
      bookingId: sos.bookingId,
      status: "OPEN",
      requesterType: ctx.requesterType,
      tripId: ctx.tripId,
      createdAt: new Date(),
    };
    emitSos(sos.id, "sos:created", safe);
    emitUser(ctx.userId, "sos:created", safe);
    emitAdmins("sos:created", safe);
    emitAdminRoom("safety", "admin:sos:created", safe);
    emitBooking(sos.bookingId, "sos:created", safe);
  }

  private notifyAlerts(
    sos: { id: string; sosNumber: string; bookingId: string },
    ctx: RequesterContext,
  ) {
    if (ctx.otherUserId && ctx.otherUserId !== ctx.userId) {
      void this.notifications.enqueue({
        userId: ctx.otherUserId,
        bookingId: ctx.bookingId,
        channel: "PUSH",
        templateKey: "SOS_CREATED",
        title: "SOS alert",
        body:
          ctx.requesterType === "DRIVER"
            ? "Your driver triggered an SOS on this trip."
            : "Your customer triggered an SOS on this trip.",
        data: {
          type: "SOS_UPDATE",
          sosId: sos.id,
          sosNumber: sos.sosNumber,
          bookingId: ctx.bookingId,
          requesterType: ctx.requesterType,
          route: `/safety/sos/${sos.id}`,
        },
      });
    }
  }
}
