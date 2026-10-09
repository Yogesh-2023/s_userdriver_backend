import { Prisma, UserStatus } from "@prisma/client";
import { errors } from "../../common/errors";
import { hashPassword } from "../../common/password";
import { prisma } from "../../database/prisma";
import { redis } from "../../infrastructure/redis";
import { disconnectSession } from "../../infrastructure/realtime";
import { SessionsService } from "../sessions/service";
import type { AdminActionContext } from "./admin.constants";

export class AdminService {
  private readonly sessions = new SessionsService();

  async list(page: number, limit: number) {
    const where = { adminProfile: { isNot: null } };
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          phone: true,
          email: true,
          displayName: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          adminProfile: true,
          roles: {
            include: {
              role: {
                include: {
                  permissions: { include: { permission: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  async create(
    input: {
      phone: string;
      displayName: string;
      email: string;
      password: string;
      title?: string;
      role: "ADMIN" | "SUPER_ADMIN";
    },
    actor: AdminActionContext,
  ) {
    const passwordHash = await hashPassword(input.password);
    return prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: {
          OR: [{ phone: input.phone }, { email: input.email }],
        },
      });
      if (existing) {
        throw errors.conflict("Phone or email is already registered");
      }
      const role = await tx.role.findUnique({ where: { name: input.role } });
      if (!role) throw errors.conflict("Admin role is not configured");
      const user = await tx.user.create({
        data: {
          phone: input.phone,
          displayName: input.displayName,
          email: input.email,
          roles: { create: { roleId: role.id } },
          adminProfile: {
            create: {
              title: input.title,
              credential: { create: { passwordHash } },
            },
          },
        },
        include: { adminProfile: true, roles: { include: { role: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_ACCOUNT_CREATED",
          entityType: "AdminProfile",
          entityId: user.adminProfile!.id,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          after: { userId: user.id, role: input.role },
        },
      });
      return user;
    });
  }

  async update(
    adminId: string,
    input: {
      displayName?: string;
      email?: string;
      title?: string | null;
      role?: "ADMIN" | "SUPER_ADMIN";
    },
    actor: AdminActionContext,
  ) {
    const updated = await prisma.$transaction(async (tx) => {
      const admin = await tx.adminProfile.findUnique({
        where: { id: adminId },
        include: { user: { include: { roles: { include: { role: true } } } } },
      });
      if (!admin) throw errors.notFound("Admin not found");
      if (input.role) {
        if (
          input.role !== "SUPER_ADMIN" &&
          admin.user.roles.some(({ role }) => role.name === "SUPER_ADMIN")
        ) {
          await this.assertAnotherActiveSuperAdmin(tx, admin.userId);
        }
        const role = await tx.role.findUnique({ where: { name: input.role } });
        if (!role) throw errors.conflict("Admin role is not configured");
        const currentRoleIds = admin.user.roles
          .filter(({ role: assigned }) =>
            ["ADMIN", "SUPER_ADMIN"].includes(assigned.name),
          )
          .map(({ roleId }) => roleId);
        await tx.userRole.deleteMany({
          where: { userId: admin.userId, roleId: { in: currentRoleIds } },
        });
        await tx.userRole.create({
          data: { userId: admin.userId, roleId: role.id },
        });
      }
      const updated = await tx.adminProfile.update({
        where: { id: adminId },
        data: {
          title: input.title,
          user: {
            update: {
              displayName: input.displayName,
              email: input.email,
            },
          },
        },
        include: { user: { include: { roles: { include: { role: true } } } } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_ACCOUNT_UPDATED",
          entityType: "AdminProfile",
          entityId: adminId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          before: {
            title: admin.title,
            displayName: admin.user.displayName,
            email: admin.user.email,
            role: admin.user.roles.map(({ role }) => role.name),
          },
          after: {
            title: updated.title,
            displayName: updated.user.displayName,
            email: updated.user.email,
            role: updated.user.roles.map(({ role }) => role.name),
          },
        },
      });
      return updated;
    });
    if (input.role || input.email) {
      await this.sessions.revokeAllForUser(
        updated.userId,
        actor.userId,
        input.role ? "ADMIN_ROLE_CHANGED" : "ADMIN_EMAIL_CHANGED",
      );
    }
    return updated;
  }

  async updatePassword(
    adminId: string,
    password: string,
    reason: string,
    actor: AdminActionContext,
  ) {
    const passwordHash = await hashPassword(password);
    const target = await prisma.$transaction(async (tx) => {
      const admin = await tx.adminProfile.findUnique({
        where: { id: adminId },
        select: { id: true, userId: true },
      });
      if (!admin) throw errors.notFound("Admin not found");
      const activeSessions = await tx.session.findMany({
        where: { userId: admin.userId, isRevoked: false },
        select: { id: true },
      });
      await tx.adminCredential.upsert({
        where: { adminId },
        update: { passwordHash },
        create: { adminId, passwordHash },
      });
      await tx.session.updateMany({
        where: {
          id: { in: activeSessions.map(({ id }) => id) },
          isRevoked: false,
        },
        data: { isRevoked: true, revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_PASSWORD_RESET",
          entityType: "AdminProfile",
          entityId: adminId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason,
          metadata: { revokedSessions: activeSessions.length },
        },
      });
      return { ...admin, activeSessions };
    });
    for (const { id } of target.activeSessions) disconnectSession(id);
    if (target.activeSessions.length) {
      await redis.del(
        ...target.activeSessions.map(({ id }) => `session:${id}`),
      );
    }
    return {
      adminId: target.id,
      revokedSessions: target.activeSessions.length,
    };
  }

  async updateStatus(
    adminId: string,
    status: UserStatus,
    reason: string,
    actor: AdminActionContext,
  ) {
    if (adminId === actor.adminId && status !== UserStatus.ACTIVE) {
      throw errors.conflict("An admin cannot disable their own account");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const admin = await tx.adminProfile.findUnique({
        where: { id: adminId },
        include: { user: { include: { roles: { include: { role: true } } } } },
      });
      if (!admin) throw errors.notFound("Admin not found");
      if (
        status !== UserStatus.ACTIVE &&
        admin.user.roles.some(({ role }) => role.name === "SUPER_ADMIN")
      ) {
        await this.assertAnotherActiveSuperAdmin(tx, admin.userId);
      }
      const result = await tx.adminProfile.update({
        where: { id: adminId },
        data: {
          user: {
            update: {
              status,
              deletedAt: status === "DELETED" ? new Date() : null,
            },
          },
        },
        include: { user: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_ACCOUNT_STATUS_UPDATED",
          entityType: "AdminProfile",
          entityId: adminId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason,
          before: { status: admin.user.status },
          after: { status },
        },
      });
      return result;
    });
    if (status !== UserStatus.ACTIVE) {
      await this.sessions.revokeAllForUser(
        updated.userId,
        actor.userId,
        `ADMIN_${status}`,
      );
    }
    return updated;
  }

  permissionMatrix() {
    return prisma.role.findMany({
      where: { name: { in: ["ADMIN", "SUPER_ADMIN"] } },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  }

  private async assertAnotherActiveSuperAdmin(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const count = await tx.user.count({
      where: {
        id: { not: userId },
        status: "ACTIVE",
        adminProfile: { isNot: null },
        roles: { some: { role: { name: "SUPER_ADMIN" } } },
      },
    });
    if (!count) {
      throw errors.conflict(
        "The last active super-admin cannot be disabled or demoted",
      );
    }
  }

  async get(adminId: string) {
    const admin = await prisma.adminProfile.findUnique({
      where: { id: adminId },
      include: {
        user: {
          include: {
            roles: { include: { role: true } },
          },
        },
      },
    });
    if (!admin) throw errors.notFound("Admin not found");
    return admin;
  }

  async listRoles() {
    return prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async assignRole(adminId: string, roleId: string, actor: AdminActionContext) {
    const admin = await prisma.adminProfile.findUnique({
      where: { id: adminId },
      select: { userId: true },
    });
    if (!admin) throw errors.notFound("Admin not found");

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw errors.notFound("Role not found");

    await prisma.$transaction(async (tx) => {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: admin.userId, roleId } },
        create: { userId: admin.userId, roleId },
        update: {},
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_ROLE_ASSIGNED",
          entityType: "AdminProfile",
          entityId: adminId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          metadata: { role: role.name },
        },
      });
    });
  }

  async removeRole(adminId: string, roleId: string, actor: AdminActionContext) {
    const admin = await prisma.adminProfile.findUnique({
      where: { id: adminId },
      select: { userId: true },
    });
    if (!admin) throw errors.notFound("Admin not found");

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw errors.notFound("Role not found");

    if (role.name === "SUPER_ADMIN") {
      // Note: We use tx inside assertAnotherActiveSuperAdmin normally, but here we can just use prisma.
      // Wait, assertAnotherActiveSuperAdmin expects a transaction object usually, let's cast it or pass prisma.
      // The method is: private async assertAnotherActiveSuperAdmin(tx: Prisma.TransactionClient, userId: string)
      // I will wrap this in a transaction.
    }

    await prisma.$transaction(async (tx) => {
      if (role.name === "SUPER_ADMIN") {
        await this.assertAnotherActiveSuperAdmin(tx, admin.userId);
      }
      await tx.userRole.deleteMany({
        where: { userId: admin.userId, roleId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_ROLE_REMOVED",
          entityType: "AdminProfile",
          entityId: adminId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          metadata: { role: role.name },
        },
      });
    });

    await this.sessions.revokeAllForUser(
      admin.userId,
      actor.userId,
      "ADMIN_ROLE_REMOVED",
    );
  }

  async listSessions(adminId: string) {
    const admin = await prisma.adminProfile.findUnique({
      where: { id: adminId },
      select: { userId: true },
    });
    if (!admin) throw errors.notFound("Admin not found");
    return prisma.session.findMany({
      where: { userId: admin.userId },
      orderBy: { lastActiveAt: "desc" },
    });
  }

  async revokeSession(
    adminId: string,
    sessionId: string,
    actor: AdminActionContext,
  ) {
    const admin = await prisma.adminProfile.findUnique({
      where: { id: adminId },
      select: { userId: true },
    });
    if (!admin) throw errors.notFound("Admin not found");
    await this.sessions.revoke(sessionId, actor.userId, "ADMIN_REVOKED");
  }

  async logoutAllSessions(adminId: string, actor: AdminActionContext) {
    const admin = await prisma.adminProfile.findUnique({
      where: { id: adminId },
      select: { userId: true },
    });
    if (!admin) throw errors.notFound("Admin not found");
    return this.sessions.revokeAllForUser(
      admin.userId,
      actor.userId,
      "ADMIN_LOGOUT_ALL",
    );
  }
}
