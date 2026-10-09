import { Prisma, SosStatus, SupportPriority } from "@prisma/client";
import { errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import {
  emitAdminRoom,
  emitSos,
  emitUser,
} from "../../../infrastructure/realtime";
import { NotificationsService } from "../../notifications/service";
import type { AdminActionContext } from "../admin.constants";

export type SosListFilters = {
  status?: SosStatus;
  requesterType?: "USER" | "DRIVER";
  priority?: SupportPriority;
  assignedAdminId?: string;
  userId?: string;
  bookingId?: string;
  search?: string;
  from?: string;
  to?: string;
};

const chooseStatusEvent = (current: SosStatus, next: SosStatus) => {
  if (next === "RESOLVED" || next === "FALSE_ALARM")
    return "admin:sos:resolved";
  if (next === "CLOSED") return "admin:sos:closed";
  return "admin:sos:updated";
};

export class AdminSafetyService {
  private readonly notifications = new NotificationsService();

  async listSos(page: number, limit: number, filters?: SosListFilters) {
    const where: Prisma.SosRequestWhereInput = {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.requesterType
        ? { requesterType: filters.requesterType }
        : {}),
      ...(filters?.priority ? { priority: filters.priority } : {}),
      ...(filters?.assignedAdminId
        ? { assignedAdminId: filters.assignedAdminId }
        : {}),
      ...(filters?.userId ? { createdByUserId: filters.userId } : {}),
      ...(filters?.bookingId ? { bookingId: filters.bookingId } : {}),
      createdAt: {
        gte: filters?.from ? new Date(filters.from) : undefined,
        lte: filters?.to ? new Date(filters.to) : undefined,
      },
      ...(filters?.search
        ? {
            OR: [
              { sosNumber: { contains: filters.search, mode: "insensitive" } },
              {
                createdBy: {
                  OR: [
                    {
                      phone: { contains: filters.search, mode: "insensitive" },
                    },
                    {
                      displayName: {
                        contains: filters.search,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    if (!filters?.from && !filters?.to) delete where.createdAt;

    const [items, total] = await prisma.$transaction([
      prisma.sosRequest.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              displayName: true,
              phone: true,
              customerProfile: { select: { id: true } },
              driverProfile: { select: { id: true } },
            },
          },
          acknowledgedBy: { select: { id: true, displayName: true } },
          assignedAdmin: {
            include: { user: { select: { displayName: true, phone: true } } },
          },
          booking: {
            select: {
              id: true,
              status: true,
              assignedVehicle: {
                select: { id: true, registrationNo: true, model: true },
              },
              trip: { select: { id: true, status: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sosRequest.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        requester: {
          id: item.createdBy.id,
          name: item.createdBy.displayName,
          phone: item.createdBy.phone,
          customerId: item.createdBy.customerProfile?.id ?? null,
          driverId: item.createdBy.driverProfile?.id ?? null,
        },
      })),
      total,
    };
  }

  async getSos(sosId: string) {
    const sos = await prisma.sosRequest.findUnique({
      where: { id: sosId },
      include: {
        createdBy: {
          select: {
            id: true,
            displayName: true,
            phone: true,
            customerProfile: { select: { id: true } },
            driverProfile: { select: { id: true } },
          },
        },
        acknowledgedBy: {
          select: { id: true, displayName: true, phone: true },
        },
        assignedAdmin: {
          include: {
            user: { select: { id: true, displayName: true, phone: true } },
          },
        },
        booking: {
          include: {
            trip: true,
            customer: {
              include: { user: { select: { displayName: true, phone: true } } },
            },
            assignedDriver: {
              include: {
                user: { select: { displayName: true, phone: true } },
                vehicles: {
                  select: {
                    id: true,
                    registrationNo: true,
                    model: true,
                    make: true,
                  },
                  take: 1,
                },
              },
            },
            assignedVehicle: true,
          },
        },
        messages: {
          where: { isInternal: false },
          include: {
            sender: {
              select: {
                id: true,
                displayName: true,
                phone: true,
                adminProfile: { select: { id: true } },
              },
            },
            sosAdminMessageReads: { select: { adminId: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        sosActivities: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!sos) throw errors.notFound("SOS request not found");

    const requester =
      sos.requesterType === "DRIVER" ? sos.booking.assignedDriver : undefined;
    const counterpart =
      sos.requesterType === "DRIVER"
        ? {
            id: sos.booking.customer.id,
            name: sos.booking.customer.user.displayName,
            phone: sos.booking.customer.user.phone,
          }
        : requester
          ? {
              id: requester.id,
              name: requester.user.displayName,
              phone: requester.user.phone,
            }
          : undefined;

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
      resolution: sos.resolution,
      assignedAdminId: sos.assignedAdminId,
      acknowledgedAt: sos.acknowledgedAt,
      resolvedAt: sos.resolvedAt,
      closedAt: sos.closedAt,
      locationUpdatedAt: sos.locationUpdatedAt,
      createdAt: sos.createdAt,
      updatedAt: sos.updatedAt,
      requester: {
        id: sos.createdBy.id,
        name: sos.createdBy.displayName,
        phone: sos.createdBy.phone,
        customerId: sos.createdBy.customerProfile?.id ?? null,
        driverId: sos.createdBy.driverProfile?.id ?? null,
      },
      counterpart,
      booking: {
        id: sos.booking.id,
        vehicleId: sos.booking.assignedVehicle?.id ?? null,
        tripId: sos.booking.trip?.id ?? null,
        tripStatus: sos.booking.trip?.status ?? null,
        customer: sos.booking.customer.user,
        driver: requester
          ? {
              id: requester.id,
              name: requester.user.displayName,
              phone: requester.user.phone,
            }
          : undefined,
        vehicle: sos.booking.assignedVehicle
          ? {
              id: sos.booking.assignedVehicle.id,
              vehicleNumber: sos.booking.assignedVehicle.registrationNo,
              model: sos.booking.assignedVehicle.model,
            }
          : null,
      },
      activities: sos.sosActivities,
      messages: sos.messages.map((m) => ({
        id: m.id,
        sosId: m.sosId,
        senderId: m.senderId,
        senderRole: m.sender.adminProfile ? "ADMIN" : "USER",
        senderName: m.sender.adminProfile
          ? (m.sender.displayName ?? "Support Agent")
          : m.sender.displayName,
        message: m.message,
        isInternal: m.isInternal,
        createdAt: m.createdAt,
      })),
    };
  }

  async getMessages(sosId: string) {
    const sos = await prisma.sosRequest.findUnique({
      where: { id: sosId },
      select: { id: true },
    });
    if (!sos) throw errors.notFound("SOS request not found");
    return prisma.emergencySosMessage.findMany({
      where: { sosId },
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
    });
  }

  async unreadCount(adminId: string) {
    const count = await prisma.emergencySosMessage.count({
      where: {
        sender: { adminProfile: null },
        sosAdminMessageReads: { none: { adminId } },
      },
    });
    return { unreadCount: count };
  }

  async markRead(actor: AdminActionContext, sosId: string) {
    const admin = await prisma.adminProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!admin) throw errors.forbidden("Admin profile not found");
    const unread = await prisma.emergencySosMessage.findMany({
      where: {
        sosId,
        senderId: { not: actor.userId },
        sosAdminMessageReads: { none: { adminId: admin.id } },
      },
      select: { id: true },
    });
    if (unread.length) {
      await prisma.sosAdminMessageRead.createMany({
        data: unread.map(({ id }) => ({
          adminId: admin.id,
          messageId: id,
          sosRequestId: sosId,
        })),
        skipDuplicates: true,
      });
    }
    return { success: true, marked: unread.length };
  }

  async createMessage(
    actor: AdminActionContext,
    sosId: string,
    input: { message: string; isInternal?: boolean },
  ) {
    const admin = await prisma.adminProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!admin) throw errors.forbidden("Admin profile not found");
    const sos = await prisma.sosRequest.findUnique({ where: { id: sosId } });
    if (!sos) throw errors.notFound("SOS request not found");
    if (
      ["RESOLVED", "FALSE_ALARM", "CLOSED"].includes(sos.status) &&
      input.isInternal !== true
    ) {
      throw errors.conflict("A closed SOS alert cannot be updated");
    }
    const message = await prisma.emergencySosMessage.create({
      data: {
        sosId,
        senderId: actor.userId,
        message: input.message,
        isInternal: input.isInternal ?? false,
      },
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
    });
    if (!input.isInternal) {
      emitSos(sosId, "sos:message", {
        id: message.id,
        sosId,
        senderId: actor.userId,
        senderRole: "ADMIN",
        senderName: message.sender.displayName ?? "Support Agent",
        message: message.message,
        isInternal: false,
        createdAt: message.createdAt,
      });
      emitUser(sos.createdByUserId, "sos:message", message);
      emitAdminRoom("safety", "admin:sos:message", message);
      void this.notifications.enqueue({
        userId: sos.createdByUserId,
        bookingId: sos.bookingId,
        channel: "PUSH",
        templateKey: "SOS_MESSAGE_RECEIVED",
        title: "New SOS message",
        body: message.message,
        data: {
          type: "SOS_UPDATE",
          sosId,
          sosNumber: sos.sosNumber,
          bookingId: sos.bookingId,
          requesterType: sos.requesterType,
          route: `/safety/sos/${sosId}`,
        },
      });
    }
    return message;
  }

  async assignSos(
    actor: AdminActionContext,
    sosId: string,
    input: { adminId?: string; reason?: string },
  ) {
    const admin = await prisma.adminProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!admin) throw errors.forbidden("Admin profile not found");
    const sos = await prisma.sosRequest.findUnique({ where: { id: sosId } });
    if (!sos) throw errors.notFound("SOS request not found");

    let assignedAdminId = input.adminId ?? admin.id;
    if (input.adminId) {
      const target = await prisma.adminProfile.findUnique({
        where: { id: input.adminId },
        select: { id: true },
      });
      if (!target) throw errors.notFound("Target admin not found");
      assignedAdminId = target.id;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.sosRequest.update({
        where: { id: sosId },
        data: {
          assignedAdminId,
          status:
            sos.status === "OPEN" || sos.status === "ACKNOWLEDGED"
              ? "IN_PROGRESS"
              : sos.status,
        },
      });
      await tx.sosActivity.create({
        data: {
          sosRequestId: sosId,
          adminId: admin.id,
          action: "ASSIGNED",
          note:
            input.reason ??
            (assignedAdminId === admin.id
              ? "Assigned to self"
              : `Assigned to admin ${assignedAdminId}`),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_SOS_ASSIGNED",
          entityType: "SosRequest",
          entityId: sosId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          before: { assignedAdminId: sos.assignedAdminId },
          after: { assignedAdminId },
        },
      });
      return result;
    });
    emitSos(sosId, "sos:updated", {
      sosId,
      status: updated.status,
      assignedAdminId,
    });
    emitAdminRoom("safety", "admin:sos:assigned", {
      sosId,
      sosNumber: sos.sosNumber,
      assignedAdminId,
    });
    return updated;
  }

  async updateSos(
    actor: AdminActionContext,
    sosId: string,
    input: {
      status: SosStatus;
      reason?: string;
      resolution?: string;
      priority?: SupportPriority;
    },
  ) {
    const admin = await prisma.adminProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!admin) throw errors.forbidden("Admin profile not found");
    const sos = await prisma.sosRequest.findUnique({ where: { id: sosId } });
    if (!sos) throw errors.notFound("SOS request not found");

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.sosRequest.update({
        where: { id: sosId },
        data: {
          status: input.status,
          priority: input.priority,
          resolution: input.resolution,
          acknowledgedByUserId:
            input.status === "ACKNOWLEDGED" || input.status === "IN_PROGRESS"
              ? actor.userId
              : sos.acknowledgedByUserId,
          acknowledgedAt:
            input.status === "ACKNOWLEDGED" || input.status === "IN_PROGRESS"
              ? (sos.acknowledgedAt ?? new Date())
              : sos.acknowledgedAt,
          resolvedAt:
            input.status === "RESOLVED" || input.status === "FALSE_ALARM"
              ? (sos.resolvedAt ?? new Date())
              : undefined,
          closedAt: input.status === "CLOSED" ? new Date() : undefined,
          assignedAdminId:
            input.status === "OPEN"
              ? undefined
              : (sos.assignedAdminId ?? admin.id),
        },
      });
      await tx.sosActivity.create({
        data: {
          sosRequestId: sosId,
          adminId: admin.id,
          action: "STATUS_UPDATED",
          note: input.reason ?? `Status changed to ${input.status}`,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_SOS_STATUS_UPDATED",
          entityType: "SosRequest",
          entityId: sosId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason: input.reason ?? null,
          before: { status: sos.status },
          after: {
            status: input.status,
            priority: input.priority ?? sos.priority,
          },
        },
      });
      return result;
    });

    const event = chooseStatusEvent(sos.status, input.status);
    emitSos(sosId, "sos:updated", {
      sosId,
      sosNumber: sos.sosNumber,
      status: updated.status,
      priority: updated.priority,
      resolution: updated.resolution,
    });
    emitAdminRoom("safety", event, {
      sosId,
      sosNumber: sos.sosNumber,
      status: updated.status,
    });
    emitUser(sos.createdByUserId, "sos:updated", {
      sosId,
      sosNumber: sos.sosNumber,
      status: updated.status,
    });

    void this.notifications.enqueue({
      userId: sos.createdByUserId,
      bookingId: sos.bookingId,
      channel: "PUSH",
      templateKey: "SOS_STATUS_UPDATED",
      title:
        updated.status === "RESOLVED"
          ? "SOS resolved"
          : updated.status === "CLOSED"
            ? "SOS closed"
            : "SOS update",
      body: input.resolution || input.reason || `SOS status: ${updated.status}`,
      data: {
        type: "SOS_UPDATE",
        sosId,
        sosNumber: sos.sosNumber,
        bookingId: sos.bookingId,
        requesterType: sos.requesterType,
        status: updated.status,
        route: `/safety/sos/${sosId}`,
      },
    });

    return updated;
  }

  async listEmergencyContacts(userId: string) {
    return prisma.emergencyContact.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async incidentHistory(
    page: number,
    limit: number,
    filters: { tripId?: string } = {},
  ) {
    const where: Prisma.SosRequestWhereInput = {};
    if (filters.tripId) {
      where.booking = { trip: { id: filters.tripId } };
    }

    const [items, total] = await prisma.$transaction([
      prisma.sosRequest.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              displayName: true,
              phone: true,
              customerProfile: { select: { id: true } },
              driverProfile: { select: { id: true } },
            },
          },
          assignedAdmin: {
            include: { user: { select: { displayName: true } } },
          },
          booking: {
            select: { id: true, trip: { select: { id: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sosRequest.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        sosNumber: item.sosNumber,
        requesterType: item.requesterType,
        status: item.status,
        priority: item.priority,
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        message: item.message,
        tripId: item.booking.trip?.id ?? null,
        createdAt: item.createdAt,
        resolvedAt: item.resolvedAt,
        closedAt: item.closedAt,
        requester: {
          id: item.createdBy.id,
          name: item.createdBy.displayName,
          phone: item.createdBy.phone,
          customerId: item.createdBy.customerProfile?.id ?? null,
          driverId: item.createdBy.driverProfile?.id ?? null,
        },
        assignedAdmin: item.assignedAdmin?.user.displayName ?? null,
      })),
      total,
    };
  }
}

export type SosStatusHistoryAction =
  "CREATED" | "ASSIGNED" | "STATUS_UPDATED" | "CANCELLED_BY_REQUESTER";
