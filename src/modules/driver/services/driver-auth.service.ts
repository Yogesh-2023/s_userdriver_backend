import { activeSubscriptionWhere } from "./subscription-state";
import { randomInt, createHash } from "node:crypto";
import { UserStatus } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { externalKycStatus } from "../driver-status";
import { errors } from "../../../common/errors";
import { SessionsService } from "../../sessions/service";
import { DRIVER_CACHE_KEYS, DRIVER_LIMITS } from "../driver.constants";
import { sendOtp } from "../../../integrations/sms";
import { env } from "../../../config/env";

export class DriverAuthService {
  private readonly sessions = new SessionsService();

  private getIpHash(ip?: string): string {
    if (!ip) return "unknown";
    return createHash("sha256").update(ip).digest("hex");
  }

  async requestOtp(phone: string, ipAddress?: string) {
    // 1. IP rate limiting (e.g., max 10 requests per hour per IP)
    const ipHash = this.getIpHash(ipAddress);
    const ipLimitKey = `ratelimit:driver:otp:ip:${ipHash}`;
    const ipRequests = await redis.incr(ipLimitKey);
    if (ipRequests === 1) await redis.expire(ipLimitKey, 3600);
    if (ipRequests > 10) {
      throw errors.rateLimited(
        "Too many OTP requests from this IP. Please try again later.",
      );
    }

    // 2. Mobile rate limiting (e.g., max 5 requests per hour per mobile)
    const mobileLimitKey = `ratelimit:driver:otp:mobile:${phone}`;
    const mobileRequests = await redis.incr(mobileLimitKey);
    if (mobileRequests === 1) await redis.expire(mobileLimitKey, 3600);
    if (mobileRequests > DRIVER_LIMITS.MAX_OTP_ATTEMPTS) {
      throw errors.rateLimited("Maximum OTP requests exceeded for this hour");
    }

    // 3. Resend cooldown check (60 seconds)
    const cooldownKey = DRIVER_CACHE_KEYS.OTP_COOLDOWN(phone);
    if (await redis.get(cooldownKey)) {
      throw errors.rateLimited("Please wait before requesting another OTP");
    }

    const otp = env.SMS_WEBHOOK_URL
      ? randomInt(1000, 9999).toString()
      : env.OTP_FIXED_CODE || "1234";

    const otpHash = createHash("sha256").update(otp).digest("hex");

    await redis.setex(
      `driver:otp:verify:${phone}`,
      DRIVER_LIMITS.OTP_EXPIRY_SECONDS,
      otpHash,
    );
    await redis.setex(cooldownKey, DRIVER_LIMITS.OTP_COOLDOWN_SECONDS, "1");
    // Clear verify failed attempts for new request
    await redis.del(`driver:otp:verify-attempts:${phone}`);

    if (process.env.NODE_ENV === "production") {
      await sendOtp(phone, otp, DRIVER_LIMITS.OTP_EXPIRY_SECONDS);
    }
  }

  async resendOtp(phone: string, ipAddress?: string) {
    await this.requestOtp(phone, ipAddress);
  }

  async verifyOtp(
    phone: string,
    otp: string,
    context: { ipAddress?: string; userAgent?: string; deviceId?: string },
  ) {
    const attemptsKey = `driver:otp:verify-attempts:${phone}`;
    const failedAttempts = await redis.get(attemptsKey);
    if (failedAttempts && parseInt(failedAttempts, 10) >= 5) {
      throw errors.rateLimited(
        "Too many failed verification attempts. Please request a new OTP.",
      );
    }

    const otpHash = createHash("sha256").update(otp).digest("hex");

    const otpKey = `driver:otp:verify:${phone}`;
    const storedHash = await redis.get(otpKey);
    if (!storedHash) {
      throw errors.unauthorized("OTP is invalid or has expired");
    }

    if (storedHash !== otpHash) {
      const currentAttempts = await redis.incr(attemptsKey);
      if (currentAttempts === 1) await redis.expire(attemptsKey, 600); // 10 min lockout
      if (currentAttempts >= 5) {
        await redis.del(otpKey);
        throw errors.rateLimited(
          "Too many failed verification attempts. OTP has been invalidated.",
        );
      }
      throw errors.unauthorized("OTP is invalid or has expired");
    }

    // Consume the matching OTP atomically. A concurrent verification request
    // cannot reuse the same code after this point.
    const consumed = await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('del', KEYS[1]); return 1 else return 0 end",
      1,
      otpKey,
      otpHash,
    );
    if (Number(consumed) !== 1) {
      throw errors.unauthorized("OTP is invalid or has expired");
    }
    await redis.del(`driver:otp:verify-attempts:${phone}`);
    await redis.del(DRIVER_CACHE_KEYS.OTP_ATTEMPTS(phone));

    let user = await prisma.user.findUnique({
      where: { phone },
      include: { driverProfile: true },
    });

    if (user && user.status !== UserStatus.ACTIVE) {
      throw errors.forbidden(`Driver account is ${user.status}`);
    }

    const isNewDriver = !user?.driverProfile;

    if (!user) {
      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            phone,
            status: UserStatus.ACTIVE,
            driverProfile: {
              create: {
                verificationStatus: "PENDING",
              },
            },
          },
          include: { driverProfile: true },
        });

        const driverRole = await tx.role.findUnique({
          where: { name: "DRIVER" },
        });
        if (driverRole) {
          await tx.userRole.create({
            data: { userId: newUser.id, roleId: driverRole.id },
          });
        }
        return newUser;
      });
    } else if (!user.driverProfile) {
      const profile = await prisma.driverProfile.create({
        data: {
          userId: user.id,
          verificationStatus: "PENDING",
        },
      });
      user.driverProfile = profile;

      const driverRole = await prisma.role.findUnique({
        where: { name: "DRIVER" },
      });
      if (driverRole) {
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: driverRole.id } },
          create: { userId: user.id, roleId: driverRole.id },
          update: {},
        });
      }
    }

    // Ensure all authenticated drivers have the DRIVER role (useful for legacy test accounts)
    const driverRole = await prisma.role.findUnique({
      where: { name: "DRIVER" },
    });
    if (driverRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: driverRole.id } },
        create: { userId: user.id, roleId: driverRole.id },
        update: {},
      });
    }

    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        identifier: phone,
        phone,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        successful: true,
      },
    });

    // Enforce single active session for drivers
    await this.sessions.revokeAllForUser(
      user.id,
      user.id,
      "NEW_LOGIN_REVOKED_PREVIOUS",
    );

    const sessionData = await this.sessions.create(user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceInfo: { deviceId: context.deviceId },
    });

    return {
      session: sessionData,
      driver: user.driverProfile!,
      loginState: await this.getLoginState(
        user.id,
        user.driverProfile!.id,
        isNewDriver,
      ),
    };
  }

  async logout(userId: string, sessionId: string) {
    await this.sessions.revoke(sessionId, userId);
  }

  async revokeManagedSession(userId: string, managementId: string) {
    await this.sessions.revokeForUser(managementId, userId);
  }

  async logoutAll(userId: string) {
    await this.sessions.revokeAllForUser(userId, userId, "DRIVER_LOGOUT_ALL");
  }

  async me(userId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { phone: true, email: true, displayName: true, status: true },
        },
      },
    });
    if (!profile) throw errors.notFound("Driver not found");
    return profile;
  }

  async listSessions(userId: string) {
    return this.sessions.list(userId);
  }

  private async getLoginState(
    userId: string,
    driverId: string,
    isNewDriver: boolean,
  ) {
    const now = new Date();
    const driver = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driverId },
      include: {
        user: { select: { status: true } },
        documents: {
          select: { type: true, status: true, expiresAt: true },
        },
        kycSubmissions: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { status: true },
        },
        vehicleAssignments: {
          where: { isActive: true, endedAt: null },
          orderBy: { assignedAt: "desc" },
          take: 1,
          include: {
            vehicle: {
              include: {
                documents: {
                  select: { type: true, status: true, expiresAt: true },
                },
              },
            },
          },
        },
        subscriptions: {
          where: activeSubscriptionWhere(),
          take: 1,
        },
      },
    });
    const activeBooking = await prisma.booking.findFirst({
      where: {
        assignedDriverId: driverId,
        status: {
          in: [
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVING",
            "DRIVER_ARRIVED",
            "TRIP_STARTED",
          ],
        },
      },
      select: { id: true, status: true },
    });
    const assignedVehicle = driver.vehicleAssignments[0]?.vehicle ?? null;
    const requiredDriverDocuments = [
      "DL_FRONT",
      "DL_BACK",
      "AADHAR_FRONT",
      "AADHAR_BACK",
      "PAN_CARD",
      "PROFILE_PHOTO",
    ];
    const requiredVehicleDocuments = ["REGISTRATION_CERTIFICATE", "INSURANCE"];
    const validDocument = (document: {
      status: string;
      expiresAt: Date | null;
    }) =>
      document.status === "VERIFIED" &&
      (!document.expiresAt || document.expiresAt > now);
    const documentsValid =
      requiredDriverDocuments.every((type) =>
        driver.documents.some(
          (document) => document.type === type && validDocument(document),
        ),
      ) &&
      Boolean(
        assignedVehicle &&
        requiredVehicleDocuments.every((type) =>
          assignedVehicle.documents.some(
            (document) => document.type === type && validDocument(document),
          ),
        ),
      );
    const isProfileCompleted =
      driver.onboardingStatus === "PROFILE_COMPLETED" ||
      [
        "KYC_PENDING",
        "KYC_UNDER_REVIEW",
        "KYC_APPROVED",
        "VEHICLE_PENDING",
        "VEHICLE_UNDER_REVIEW",
        "READY_TO_DRIVE",
      ].includes(driver.onboardingStatus);
    const internalKycStatus =
      driver.kycSubmissions[0]?.status ?? "NOT_SUBMITTED";
    const hasExpiredDocuments = [
      ...driver.documents,
      ...(assignedVehicle?.documents ?? []),
    ].some(
      (document) =>
        document.status === "EXPIRED" ||
        (document.expiresAt && document.expiresAt <= now),
    );
    const kycStatus = externalKycStatus(
      internalKycStatus,
      driver.onboardingStatus,
      hasExpiredDocuments,
    );
    const hasAssignedVehicle = Boolean(assignedVehicle);
    const vehicleApproved =
      assignedVehicle?.status === "ACTIVE" &&
      assignedVehicle.verificationStatus === "APPROVED";
    const hasActiveSubscription = driver.subscriptions.length > 0;
    const canGoOnline =
      driver.user.status === "ACTIVE" &&
      isProfileCompleted &&
      driver.verificationStatus === "VERIFIED" &&
      hasAssignedVehicle &&
      vehicleApproved &&
      documentsValid &&
      hasActiveSubscription &&
      !activeBooking;

    let nextStep = "DASHBOARD";
    if (activeBooking) nextStep = "ACTIVE_TRIP";
    else if (driver.user.status === "SUSPENDED") nextStep = "ACCOUNT_SUSPENDED";
    else if (!isProfileCompleted) nextStep = "COMPLETE_PROFILE";
    else if (internalKycStatus === "NOT_SUBMITTED") nextStep = "SUBMIT_KYC";
    else if (
      internalKycStatus === "PENDING" &&
      driver.onboardingStatus !== "KYC_UNDER_REVIEW"
    )
      nextStep = "KYC_PENDING";
    else if (driver.verificationStatus === "REJECTED")
      nextStep = "REUPLOAD_KYC";
    else if (driver.verificationStatus !== "VERIFIED")
      nextStep = "KYC_UNDER_REVIEW";
    else if (!hasAssignedVehicle || !vehicleApproved)
      nextStep = "WAIT_FOR_VEHICLE";
    else if (!documentsValid) nextStep = "RENEW_DOCUMENTS";
    else if (!hasActiveSubscription) nextStep = "BUY_SUBSCRIPTION";

    return {
      driverId,
      userId,
      isNewDriver,
      isProfileCompleted,
      kycStatus,
      hasAssignedVehicle,
      vehicleApproved,
      documentsValid,
      accountStatus: driver.user.status,
      availability: driver.availability,
      canGoOnline,
      hasActiveBooking: Boolean(activeBooking),
      activeBooking,
      nextStep,
    };
  }
}
