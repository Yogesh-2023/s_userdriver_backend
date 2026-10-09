import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { errors } from "../../../common/errors";
import { hashPassword, verifyPassword } from "../../../common/password";
import { env } from "../../../config/env";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { SessionsService } from "../../sessions/service";
import { ADMIN_ROLES } from "../admin.constants";

const dummyPasswordHash = hashPassword(
  "invalid-admin-password-used-for-timing-equality",
);

type LoginContext = {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

export class AdminAuthService {
  private readonly sessions = new SessionsService();

  async login(
    input: {
      email: string;
      password: string;
      deviceInfo?: Record<string, unknown>;
    },
    context: LoginContext,
  ) {
    const email = input.email.trim().toLowerCase();
    const attemptKey = `rate:admin-login:${this.digest(email)}`;
    const attempts = Number((await redis.get(attemptKey)) ?? 0);
    if (attempts >= env.ADMIN_LOGIN_MAX_ATTEMPTS) {
      await this.recordLogin(
        email,
        false,
        input.deviceInfo,
        context,
        "TOO_MANY_ATTEMPTS",
      );
      const ttl = await redis.ttl(attemptKey);
      throw errors.rateLimited(
        "Too many login attempts; please try again later",
        { retryAfterSeconds: ttl > 0 ? ttl : env.ADMIN_LOGIN_LOCK_SECONDS },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        adminProfile: { include: { credential: true } },
        roles: { include: { role: true } },
      },
    });
    const passwordMatches = await verifyPassword(
      input.password,
      user?.adminProfile?.credential?.passwordHash ?? (await dummyPasswordHash),
    );
    const isAdmin =
      user?.adminProfile &&
      user.status === "ACTIVE" &&
      user.roles.some(({ role }) =>
        ADMIN_ROLES.includes(role.name as (typeof ADMIN_ROLES)[number]),
      );

    if (!passwordMatches || !isAdmin) {
      const failedAttempts = await redis.incr(attemptKey);
      if (failedAttempts === 1) {
        await redis.expire(attemptKey, env.ADMIN_LOGIN_LOCK_SECONDS);
      }
      await this.recordLogin(
        email,
        false,
        input.deviceInfo,
        context,
        "INVALID_CREDENTIALS",
        user?.id,
        user?.phone,
      );
      throw errors.unauthorized("Email or password is invalid");
    }

    const lockKey = `lock:admin-login:${user.id}`;
    const lockToken = randomUUID();
    const locked = await redis.set(lockKey, lockToken, "PX", 30_000, "NX");
    if (!locked) throw errors.conflict("Admin login is already in progress");

    let newSession: { sessionId: string; userId: string } | undefined;
    try {
      const session = await this.sessions.create(user.id, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceInfo: input.deviceInfo,
      });
      newSession = {
        sessionId: session.session.sessionId,
        userId: user.id,
      };
      const profile = await this.resolvePrincipal(user.id);
      const revokedSessions = await this.sessions.revokeAllOtherForUser(
        user.id,
        session.session.sessionId,
        user.id,
        "ADMIN_SINGLE_SESSION_LOGIN",
      );
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        }),
        prisma.loginHistory.create({
          data: {
            identifier: email,
            phone: user.phone,
            successful: true,
            userId: user.id,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            deviceInfo: input.deviceInfo as Prisma.InputJsonObject | undefined,
          },
        }),
        prisma.auditLog.create({
          data: {
            actorUserId: user.id,
            actorRole: profile.roles.includes("SUPER_ADMIN")
              ? "SUPER_ADMIN"
              : "ADMIN",
            action: "ADMIN_LOGIN",
            entityType: "AdminProfile",
            entityId: profile.id,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: {
              deviceInfo: (input.deviceInfo ?? {}) as Prisma.InputJsonObject,
              revokedSessions,
            },
          },
        }),
      ]);
      await redis.del(attemptKey);
      return {
        cookieValue: session.cookieValue,

        admin: profile,
      };
    } catch (error) {
      if (newSession) {
        await this.sessions.revoke(
          newSession.sessionId,
          newSession.userId,
          "ADMIN_LOGIN_FAILED",
        );
      }
      throw error;
    } finally {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async logout(sessionId: string, userId: string, context: LoginContext) {
    const principal = await this.resolvePrincipal(userId);
    await this.sessions.revoke(sessionId, userId, "ADMIN_LOGOUT");
    await this.auditLogout(principal.id, userId, "ADMIN_LOGOUT", context);
  }

  async logoutAll(userId: string, context: LoginContext) {
    const principal = await this.resolvePrincipal(userId);
    const count = await this.sessions.revokeAllForUser(
      userId,
      userId,
      "ADMIN_LOGOUT_ALL",
    );
    await this.auditLogout(
      principal.id,
      userId,
      "ADMIN_LOGOUT_ALL",
      context,
      count,
    );
    return count;
  }

  me(userId: string) {
    return this.resolvePrincipal(userId);
  }

  listSessions(userId: string) {
    return this.sessions.list(userId);
  }

  async revokeSession(managementId: string, userId: string) {
    await this.sessions.revokeForUser(managementId, userId);
  }

  async forgotPassword(email: string, context: LoginContext) {
    const userEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      include: {
        adminProfile: true,
        roles: { include: { role: true } },
      },
    });

    if (!user || !user.adminProfile || user.status !== "ACTIVE") {
      // Return success to prevent email enumeration
      return {
        success: true,
        message: "If the email is registered, an OTP has been sent.",
      };
    }

    const isAdmin = user.roles.some(({ role }) =>
      ADMIN_ROLES.includes(role.name as (typeof ADMIN_ROLES)[number]),
    );

    if (!isAdmin) {
      return {
        success: true,
        message: "If the email is registered, an OTP has been sent.",
      };
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await hashPassword(otp);

    const resetKey = `admin-pwd-reset:${userEmail}`;
    await redis.set(
      resetKey,
      JSON.stringify({ otpHash, attempts: 0 }),
      "EX",
      15 * 60, // 15 minutes
    );

    // In a real system, send email here. For now, we log it
    console.log(`[DEV] Admin Password Reset OTP for ${userEmail}: ${otp}`);

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "ADMIN_FORGOT_PASSWORD_REQUESTED",
        entityType: "AdminProfile",
        entityId: user.adminProfile.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    return {
      success: true,
      message: "If the email is registered, an OTP has been sent.",
    };
  }

  async verifyResetOtp(email: string, otp: string) {
    const userEmail = email.trim().toLowerCase();
    const resetKey = `admin-pwd-reset:${userEmail}`;
    const data = await redis.get(resetKey);

    if (!data) {
      throw errors.badRequest("OTP expired or invalid");
    }

    const { otpHash, attempts } = JSON.parse(data);

    if (attempts >= 5) {
      await redis.del(resetKey);
      throw errors.rateLimited(
        "Too many failed attempts. Please request a new OTP.",
      );
    }

    const isValid = await verifyPassword(otp, otpHash);

    if (!isValid) {
      await redis.set(
        resetKey,
        JSON.stringify({ otpHash, attempts: attempts + 1 }),
        "KEEPTTL",
      );
      throw errors.badRequest("Invalid OTP");
    }

    const resetToken = randomUUID();
    const verifiedKey = `admin-pwd-verified:${userEmail}`;
    await redis.set(verifiedKey, resetToken, "EX", 15 * 60);
    await redis.del(resetKey);

    return { resetToken };
  }

  async resetPassword(
    email: string,
    resetToken: string,
    newPassword: string,
    context: LoginContext,
  ) {
    const userEmail = email.trim().toLowerCase();
    const verifiedKey = `admin-pwd-verified:${userEmail}`;
    const validToken = await redis.get(verifiedKey);

    if (!validToken || validToken !== resetToken) {
      throw errors.badRequest("Invalid or expired reset session");
    }

    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      include: { adminProfile: true },
    });

    if (!user || !user.adminProfile) {
      throw errors.notFound("User not found");
    }

    const newPasswordHash = await hashPassword(newPassword);

    await prisma.adminCredential.update({
      where: { adminId: user.adminProfile.id },
      data: { passwordHash: newPasswordHash },
    });

    await redis.del(verifiedKey);
    await this.sessions.revokeAllForUser(
      user.id,
      user.id,
      "ADMIN_PASSWORD_RESET",
    );

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "ADMIN_PASSWORD_RESET",
        entityType: "AdminProfile",
        entityId: user.adminProfile.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
    context: LoginContext,
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { adminProfile: { include: { credential: true } } },
    });

    if (!user || !user.adminProfile || !user.adminProfile.credential) {
      throw errors.unauthorized("Unauthorized");
    }

    const isValid = await verifyPassword(
      oldPassword,
      user.adminProfile.credential.passwordHash,
    );

    if (!isValid) {
      throw errors.badRequest("Incorrect current password");
    }

    const newPasswordHash = await hashPassword(newPassword);

    await prisma.adminCredential.update({
      where: { adminId: user.adminProfile.id },
      data: { passwordHash: newPasswordHash },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "ADMIN_PASSWORD_CHANGED",
        entityType: "AdminProfile",
        entityId: user.adminProfile.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  }

  async resolvePrincipal(userId: string, sessionId?: string) {
    const [admin, activeSession] = await Promise.all([
      prisma.adminProfile.findUnique({
        where: { userId },
        include: {
          user: {
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
          },
        },
      }),
      sessionId
        ? prisma.session.count({
            where: {
              id: sessionId,
              userId,
              isRevoked: false,
              expiresAt: { gt: new Date() },
            },
          })
        : Promise.resolve(1),
    ]);
    const roles = admin?.user.roles.map(({ role }) => role.name) ?? [];
    if (
      !admin ||
      activeSession !== 1 ||
      admin.user.status !== "ACTIVE" ||
      !roles.some((role) =>
        ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]),
      )
    ) {
      throw errors.unauthorized("Admin authentication failed");
    }
    return {
      id: admin.id,
      userId: admin.userId,
      title: admin.title,
      displayName: admin.user.displayName,
      phone: admin.user.phone,
      email: admin.user.email,
      status: admin.user.status,
      roles,
      permissions: [
        ...new Set(
          admin.user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ],
    };
  }

  private async recordLogin(
    identifier: string,
    successful: boolean,
    deviceInfo: Record<string, unknown> | undefined,
    context: LoginContext,
    failureCode?: string,
    userId?: string,
    phone?: string,
  ) {
    await prisma.loginHistory.create({
      data: {
        identifier,
        phone,
        successful,
        failureCode,
        userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceInfo: deviceInfo as Prisma.InputJsonObject | undefined,
      },
    });
  }

  private async auditLogout(
    adminId: string,
    userId: string,
    action: string,
    context: LoginContext,
    revokedCount?: number,
  ) {
    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action,
        entityType: "AdminProfile",
        entityId: adminId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: revokedCount === undefined ? undefined : { revokedCount },
      },
    });
  }

  private digest(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
}
