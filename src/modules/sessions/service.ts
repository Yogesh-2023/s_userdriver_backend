import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import { redis } from "../../infrastructure/redis";
import { disconnectSession } from "../../infrastructure/realtime";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type StoredSession = {
  sessionId: string;
  userId: string;
  roles: string[];
  permissions: string[];
  tokenHash: string;
  previousTokenHash?: string;
  previousTokenExpiresAt?: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  isRevoked: boolean;
  deviceInfo?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};

export class SessionsService {
  async create(
    userId: string,
    context: {
      ipAddress?: string;
      userAgent?: string;
      deviceInfo?: Record<string, unknown>;
    },
  ) {
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const cookieValue = `${sessionId}.${secret}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + env.SESSION_TTL_SECONDS * 1_000);
    const principal = await this.loadPrincipal(userId);
    const stored = {
      sessionId,
      userId,
      roles: principal.roles,
      permissions: principal.permissions,
      tokenHash: digest(cookieValue),
      deviceInfo: context.deviceInfo ?? {},
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      createdAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      isRevoked: false,
    };

    await prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: {
          id: sessionId,
          userId,
          tokenHash: stored.tokenHash,
          deviceInfo: stored.deviceInfo as Prisma.InputJsonValue,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "SESSION_CREATED",
          entityType: "Session",
          entityId: digest(sessionId),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
    });
    await redis.set(
      this.key(sessionId),
      JSON.stringify(stored),
      "EX",
      env.SESSION_TTL_SECONDS,
    );
    return { cookieValue, session: stored };
  }

  async validate(cookieValue: string | undefined) {
    if (!cookieValue) return null;
    const [sessionId, secret, extra] = cookieValue.split(".");
    if (!sessionId || !secret || extra) return null;
    const raw = await redis.get(this.key(sessionId));
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    const tokenHash = digest(cookieValue);
    const matchesCurrentToken = this.safeEqual(session.tokenHash, tokenHash);
    const previousTokenHash = session.previousTokenHash;
    const previousTokenExpiresAt = session.previousTokenExpiresAt;
    const matchesPreviousToken =
      typeof previousTokenHash === "string" &&
      typeof previousTokenExpiresAt === "string" &&
      new Date(previousTokenExpiresAt).getTime() > Date.now() &&
      this.safeEqual(previousTokenHash, tokenHash);

    if (
      session.isRevoked ||
      new Date(session.expiresAt).getTime() <= Date.now() ||
      (!matchesCurrentToken && !matchesPreviousToken)
    ) {
      return null;
    }
    const idleAge = Date.now() - new Date(session.lastActiveAt).getTime();
    if (idleAge > env.SESSION_IDLE_TTL_SECONDS * 1_000) {
      await this.revoke(sessionId, session.userId, "IDLE_TIMEOUT");
      return null;
    }
    session.lastActiveAt = new Date().toISOString();
    const remaining = Math.max(
      1,
      Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1_000),
    );
    await redis.set(
      this.key(sessionId),
      JSON.stringify(session),
      "EX",
      remaining,
    );
    if (idleAge > 300_000) {
      await prisma.session.updateMany({
        where: { id: sessionId, isRevoked: false },
        data: { lastActiveAt: new Date(session.lastActiveAt) },
      });
    }
    return session;
  }

  async rotate(
    cookieValue: string,
    context: {
      ipAddress?: string;
      userAgent?: string;
      deviceInfo?: Record<string, unknown>;
    },
  ) {
    const sessionId = cookieValue.split(".")[0];
    if (!sessionId) throw errors.unauthorized("Session is invalid or expired");
    const lockKey = `lock:session-rotate:${sessionId}`;
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
    if (!locked) {
      const current = await this.validate(cookieValue);
      if (!current) throw errors.unauthorized("Session is invalid or expired");
      return { cookieValue, session: current };
    }
    try {
      const current = await this.validate(cookieValue);
      if (!current) throw errors.unauthorized("Session is invalid or expired");
      const now = new Date();
      const nextCookieValue = `${current.sessionId}.${randomBytes(32).toString("base64url")}`;
      const rotated: StoredSession = {
        ...current,
        tokenHash: digest(nextCookieValue),
        previousTokenHash: current.tokenHash,
        previousTokenExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
        createdAt: now.toISOString(),
        lastActiveAt: now.toISOString(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceInfo: context.deviceInfo ?? current.deviceInfo,
      };
      const remaining = Math.max(
        1,
        Math.floor(
          (new Date(rotated.expiresAt).getTime() - Date.now()) / 1_000,
        ),
      );

      await prisma.session.updateMany({
        where: { id: current.sessionId, isRevoked: false },
        data: {
          tokenHash: rotated.tokenHash,
          lastActiveAt: now,
        },
      });
      await redis.set(
        this.key(current.sessionId),
        JSON.stringify(rotated),
        "EX",
        remaining,
      );

      return { cookieValue: nextCookieValue, session: rotated };
    } finally {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async revoke(sessionId: string, actorUserId: string, reason = "LOGOUT") {
    const changed = await prisma.session.updateMany({
      where: { id: sessionId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    await redis.del(this.key(sessionId));

    disconnectSession(sessionId);

    if (changed.count) {
      await prisma.auditLog.create({
        data: {
          actorUserId,
          action: "SESSION_REVOKED",
          entityType: "Session",
          entityId: digest(sessionId),
          metadata: { reason },
        },
      });
    }
  }

  async revokeForUser(sessionId: string, ownerUserId: string) {
    const session = await prisma.session.findFirst({
      where: { managementId: sessionId, userId: ownerUserId },
      select: { id: true },
    });
    if (!session) throw errors.notFound("Session not found");
    await this.revoke(session.id, ownerUserId, "USER_REVOKED");
  }

  list(userId: string) {
    return prisma.session
      .findMany({
        where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
        select: {
          managementId: true,
          deviceInfo: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          lastActiveAt: true,
          expiresAt: true,
        },
        orderBy: { lastActiveAt: "desc" },
      })
      .then((items) =>
        items.map(({ managementId, ...session }) => ({
          sessionId: managementId,
          ...session,
        })),
      );
  }

  async revokeAllForUser(
    userId: string,
    actorUserId: string,
    reason = "LOGOUT_ALL",
  ) {
    const active = await prisma.session.findMany({
      where: { userId, isRevoked: false },
      select: { id: true },
    });
    if (!active.length) return 0;
    await prisma.session.updateMany({
      where: { id: { in: active.map(({ id }) => id) }, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    await redis.del(...active.map(({ id }) => this.key(id)));
    for (const { id } of active) disconnectSession(id);
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action: "ALL_SESSIONS_REVOKED",
        entityType: "User",
        entityId: userId,
        reason,
        metadata: { revokedCount: active.length },
      },
    });
    return active.length;
  }

  async revokeAllOtherForUser(
    userId: string,
    excludedSessionId: string,
    actorUserId: string,
    reason = "NEW_LOGIN",
  ) {
    const active = await prisma.session.findMany({
      where: {
        userId,
        id: { not: excludedSessionId },
        isRevoked: false,
      },
      select: { id: true },
    });
    if (!active.length) return 0;
    await prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: {
          id: { in: active.map(({ id }) => id) },
          userId,
          isRevoked: false,
        },
        data: { isRevoked: true, revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: "OTHER_SESSIONS_REVOKED",
          entityType: "User",
          entityId: userId,
          reason,
          metadata: { revokedCount: active.length },
        },
      });
    });
    await redis.del(...active.map(({ id }) => this.key(id)));
    for (const { id } of active) disconnectSession(id);
    return active.length;
  }

  shouldRotate(session: { createdAt: string }) {
    return (
      Date.now() - new Date(session.createdAt).getTime() >
      env.SESSION_ROTATION_SECONDS * 1_000
    );
  }

  private async loadPrincipal(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
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
    });
    if (!user || user.status !== "ACTIVE") {
      throw errors.unauthorized("Account is not active");
    }
    return {
      roles: user.roles.map(({ role }) => role.name),
      permissions: [
        ...new Set(
          user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ],
    };
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private key(sessionId: string) {
    return `session:${sessionId}`;
  }
}
