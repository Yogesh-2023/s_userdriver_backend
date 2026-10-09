import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import { redis } from "../../infrastructure/redis";
import { sendOtp } from "../../integrations/sms";
import { SessionsService } from "../sessions/service";

export class AuthService {
  private readonly sessions = new SessionsService();

  async requestOtp(input: { phone: string; role: "CUSTOMER" | "DRIVER" }) {
    const cooldown = await redis.set(
      `otp:cooldown:${input.phone}`,
      "1",
      "EX",
      env.OTP_REQUEST_WINDOW_SECONDS,
      "NX",
    );
    if (!cooldown)
      throw errors.rateLimited("Please wait before requesting OTP");
    const id = randomUUID();
    const otp = env.OTP_FIXED_CODE;
    const verification = await prisma.otpVerification.create({
      data: {
        id,
        phone: input.phone,
        purpose: `LOGIN:${input.role}`,
        otpHash: this.otpHash(id, otp),
        maxAttempts: env.OTP_MAX_ATTEMPTS,
        expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1_000),
      },
    });
    try {
      await sendOtp(input.phone, otp, env.OTP_TTL_SECONDS);
    } catch (error) {
      await prisma.otpVerification.update({
        where: { id: verification.id },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
    return {
      requestId: id,
      expiresInSeconds: env.OTP_TTL_SECONDS,
      ...(env.NODE_ENV !== "production"
        ? { developmentOtp: env.OTP_FIXED_CODE }
        : {}),
    };
  }

  async verifyOtp(
    input: {
      phone: string;
      role: "CUSTOMER" | "DRIVER";
      otp: string;
      deviceInfo?: Record<string, unknown>;
    },
    context: { ipAddress?: string; userAgent?: string },
  ) {
    const loginContext = { ...context, deviceInfo: input.deviceInfo };
    const verification = await prisma.otpVerification.findFirst({
      where: {
        phone: input.phone,
        purpose: `LOGIN:${input.role}`,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      !verification ||
      verification.expiresAt <= new Date() ||
      verification.attempts >= verification.maxAttempts
    ) {
      await this.loginHistory(
        input.phone,
        false,
        loginContext,
        "OTP_EXPIRED_OR_LOCKED",
      );
      throw errors.unauthorized(
        "OTP has expired or maximum attempts reached. Please request a new one.",
      );
    }
    if (
      !this.safeEqual(
        verification.otpHash,
        this.otpHash(verification.id, input.otp),
      )
    ) {
      await prisma.otpVerification.updateMany({
        where: {
          id: verification.id,
          consumedAt: null,
          attempts: { lt: verification.maxAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      await this.loginHistory(input.phone, false, loginContext, "OTP_MISMATCH");
      throw errors.unauthorized("Incorrect OTP entered. Please try again.");
    }
    const claimed = await prisma.otpVerification.updateMany({
      where: {
        id: verification.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: verification.maxAttempts },
      },
      data: { attempts: { increment: 1 }, consumedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await this.loginHistory(
        input.phone,
        false,
        loginContext,
        "OTP_ALREADY_CONSUMED",
      );
      throw errors.unauthorized(
        "This OTP has already been used. Please request a new one.",
      );
    }
    const user = await this.createOrFindUser(input.phone, input.role);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), phoneVerifiedAt: new Date() },
    });
    await this.loginHistory(
      input.phone,
      true,
      loginContext,
      undefined,
      user.id,
    );
    const session = await this.sessions.create(user.id, {
      ...context,
      deviceInfo: input.deviceInfo,
    });
    return {
      user: {
        id: user.id,
        phone: user.phone,
        roles: session.session.roles,
        permissions: session.session.permissions,
      },
      ...session,
    };
  }

  private async createOrFindUser(
    phone: string,
    roleName: "CUSTOMER" | "DRIVER",
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phone } });
      if (existing) {
        if (existing.status !== "ACTIVE") {
          throw errors.unauthorized("Account is not available");
        }
        const profileCount =
          roleName === "CUSTOMER"
            ? await tx.customerProfile.count({ where: { userId: existing.id } })
            : await tx.driverProfile.count({ where: { userId: existing.id } });
        if (!profileCount) {
          throw errors.conflict(
            "Phone is registered for a different account type",
          );
        }
        return existing;
      }
      const role = await tx.role.upsert({
        where: { name: roleName },
        update: {},
        create: { name: roleName, isSystem: true },
      });
      const user = await tx.user.create({
        data: {
          phone,
          phoneVerifiedAt: new Date(),
          roles: { create: { roleId: role.id } },
        },
      });
      if (roleName === "CUSTOMER") {
        await tx.customerProfile.create({
          data: {
            userId: user.id,
            referralCode: `FM${user.id.replaceAll("-", "").slice(0, 10).toUpperCase()}`,
          },
        });
      } else if (roleName === "DRIVER") {
        await tx.driverProfile.create({ data: { userId: user.id } });
      }
      return user;
    });
  }

  private loginHistory(
    phone: string,
    successful: boolean,
    context: {
      ipAddress?: string;
      userAgent?: string;
      deviceInfo?: Record<string, unknown>;
    },
    failureCode?: string,
    userId?: string,
  ) {
    return prisma.loginHistory.create({
      data: {
        phone,
        identifier: phone,
        successful,
        failureCode,
        userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceInfo: context.deviceInfo as Prisma.InputJsonObject | undefined,
      },
    });
  }

  private otpHash(id: string, otp: string) {
    return createHmac("sha256", env.COOKIE_SECRET)
      .update(`${id}:${otp}`)
      .digest("hex");
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
