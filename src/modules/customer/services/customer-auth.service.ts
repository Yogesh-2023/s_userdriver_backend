import { randomInt, createHash } from "node:crypto";
import { UserStatus } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { errors } from "../../../common/errors";
import { SessionsService } from "../../sessions/service";
import { CUSTOMER_CACHE_KEYS, CUSTOMER_LIMITS } from "../customer.constants";
import { sendOtp } from "../../../integrations/sms";
import { sendEmail } from "../../../integrations/email";
import { env } from "../../../config/env";
export class CustomerAuthService {
  private readonly sessions = new SessionsService();

  private getIpHash(ip?: string): string {
    if (!ip) return "unknown";
    return createHash("sha256").update(ip).digest("hex");
  }

  async requestOtp(
    identifier: string,
    type: "mobile" | "email",
    ipAddress?: string,
  ) {
    // 1. IP rate limiting (e.g., max 10 requests per hour per IP)
    const ipHash = this.getIpHash(ipAddress);
    const ipLimitKey = `ratelimit:customer:otp:ip:${ipHash}`;
    const ipRequests = await redis.incr(ipLimitKey);
    if (ipRequests === 1) await redis.expire(ipLimitKey, 3600);
    if (ipRequests > 10) {
      throw errors.rateLimited(
        "Too many OTP requests from this IP. Please try again later.",
      );
    }

    const otp = env.SMS_WEBHOOK_URL
      ? randomInt(1000, 9999).toString()
      : env.OTP_FIXED_CODE;

    const otpHash = createHash("sha256").update(otp).digest("hex");

    // Store OTP hash and verify attempts counter
    await redis.setex(
      `customer:otp:verify:${identifier}`,
      CUSTOMER_LIMITS.OTP_EXPIRY_SECONDS,
      otpHash,
    );

    // Clear verify failed attempts for new request
    await redis.del(`customer:otp:verify-attempts:${identifier}`);

    if (process.env.NODE_ENV === "production") {
      if (type === "mobile") {
        await sendOtp(identifier, otp, CUSTOMER_LIMITS.OTP_EXPIRY_SECONDS);
      } else {
        await sendEmail({
          to: identifier,
          subject: "Your Login OTP - Fleet Go",
          body: `Your OTP for login is ${otp}. It will expire in ${CUSTOMER_LIMITS.OTP_EXPIRY_SECONDS / 60} minutes.`,
        });
      }
    }
  }

  async resendOtp(
    identifier: string,
    type: "mobile" | "email",
    ipAddress?: string,
  ) {
    // Just reuse requestOtp as the core logic is identical, verifying cooldown/limits.
    await this.requestOtp(identifier, type, ipAddress);
  }

  async verifyOtp(
    identifier: string,
    type: "mobile" | "email",
    otp: string,
    context: { ipAddress?: string; userAgent?: string; deviceId?: string },
  ) {
    const attemptsKey = `customer:otp:verify-attempts:${identifier}`;
    const failedAttempts = await redis.get(attemptsKey);
    if (failedAttempts && parseInt(failedAttempts, 10) >= 5) {
      throw errors.rateLimited(
        "Too many failed verification attempts. Please request a new OTP.",
      );
    }

    const otpHash = createHash("sha256").update(otp).digest("hex");

    const storedHash = await redis.get(`customer:otp:verify:${identifier}`);
    if (!storedHash) {
      throw errors.unauthorized("OTP is invalid or has expired");
    }

    if (storedHash !== otpHash) {
      const currentAttempts = await redis.incr(attemptsKey);
      if (currentAttempts === 1) await redis.expire(attemptsKey, 600); // 10 min ban on this OTP
      if (currentAttempts >= 5) {
        await redis.del(`customer:otp:verify:${identifier}`);
        throw errors.rateLimited(
          "Too many failed verification attempts. OTP has been invalidated.",
        );
      }
      throw errors.unauthorized("OTP is invalid or has expired");
    }

    // OTP verified successfully
    await redis.del(`customer:otp:verify:${identifier}`);
    await redis.del(`customer:otp:verify-attempts:${identifier}`);
    await redis.del(CUSTOMER_CACHE_KEYS.OTP_ATTEMPTS(identifier));

    let user =
      type === "mobile"
        ? await prisma.user.findUnique({
            where: { phone: identifier },
            include: { customerProfile: true },
          })
        : await prisma.user.findUnique({
            where: { email: identifier },
            include: { customerProfile: true },
          });

    let isNewUser = false;

    if (user && user.status !== UserStatus.ACTIVE) {
      throw errors.forbidden(`Customer account is ${user.status}`);
    }

    if (!user) {
      isNewUser = true;
      user = await prisma.$transaction(async (tx) => {
        const dummyPhone =
          type === "email"
            ? `+000${Date.now()}${randomInt(100, 999)}`
            : identifier;
        const newUser = await tx.user.create({
          data: {
            phone: dummyPhone,
            email: type === "email" ? identifier : undefined,
            status: UserStatus.ACTIVE,
            customerProfile: {
              create: {
                referralCode: `REF${randomInt(10000, 99999)}`,
              },
            },
          },
          include: { customerProfile: true },
        });

        const customerRole = await tx.role.findUnique({
          where: { name: "CUSTOMER" },
        });
        if (customerRole) {
          await tx.userRole.create({
            data: { userId: newUser.id, roleId: customerRole.id },
          });
        }
        return newUser;
      });
    } else if (!user.customerProfile) {
      isNewUser = true;
      // User exists but isn't a customer yet
      const profile = await prisma.customerProfile.create({
        data: {
          userId: user.id,
          referralCode: `REF${randomInt(10000, 99999)}`,
        },
      });
      user.customerProfile = profile;

      const customerRole = await prisma.role.findUnique({
        where: { name: "CUSTOMER" },
      });
      if (customerRole) {
        await prisma.userRole.upsert({
          where: {
            userId_roleId: { userId: user.id, roleId: customerRole.id },
          },
          create: { userId: user.id, roleId: customerRole.id },
          update: {},
        });
      }
    }

    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        identifier: identifier,
        phone: user.phone,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        successful: true,
      },
    });

    const sessionData = await this.sessions.create(user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceInfo: { deviceId: context.deviceId },
    });

    const loginState = await this.getLoginState(user.id);

    return {
      session: sessionData,
      isNewCustomer: isNewUser,
      ...loginState,
    };
  }

  async getLoginState(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerProfile: {
          include: {
            bookings: {
              where: {
                status: {
                  in: [
                    "PENDING",
                    "SEARCHING_DRIVER",
                    "DRIVER_ASSIGNED",
                    "DRIVER_ARRIVING",
                    "DRIVER_ARRIVED",
                    "TRIP_STARTED",
                    "PAYMENT_PENDING",
                  ],
                },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!user || !user.customerProfile) {
      throw errors.notFound("Customer profile not found");
    }

    const isProfileCompleted = Boolean(user.displayName && user.email);
    const activeBooking = user.customerProfile.bookings[0] || null;

    return {
      customerId: user.customerProfile.id,
      isAuthenticated: true,
      isProfileCompleted,
      hasActiveBooking: !!activeBooking,
      activeBooking: activeBooking
        ? {
            id: activeBooking.id,
            status: activeBooking.status,
            pickup: {
              address: activeBooking.pickupAddress,
              latitude: Number(activeBooking.pickupLatitude),
              longitude: Number(activeBooking.pickupLongitude),
            },
            drop: {
              address: activeBooking.dropAddress,
              latitude: Number(activeBooking.dropLatitude),
              longitude: Number(activeBooking.dropLongitude),
            },
            vehicleTypeId: activeBooking.vehicleCategoryId,
            paymentStatus: "PENDING",
          }
        : null,
      profile: {
        id: user.customerProfile.id,
        fullName: user.displayName,
        phoneNumber: user.phone,
        email: user.email,
        gender: user.customerProfile.gender,
        profileImage: user.customerProfile.profileImageUrl,
      },
    };
  }

  async logout(userId: string, sessionId: string) {
    await this.sessions.revoke(sessionId, userId);
  }

  async logoutAll(userId: string) {
    await this.sessions.revokeAllForUser(userId, userId, "CUSTOMER_LOGOUT_ALL");
  }

  async me(userId: string) {
    return this.getLoginState(userId);
  }

  async listSessions(userId: string) {
    return prisma.session.findMany({
      where: { userId, isRevoked: false },
      orderBy: { lastActiveAt: "desc" },
    });
  }
}
