import { z } from "zod";
import type { FastifyRequest, FastifyReply } from "fastify";
import { logDriver } from "../../common/chalk-logger";
import { success } from "../../common/response";
import { parse } from "../../common/validation";
import { DriverAuthService } from "./services/driver-auth.service";
import { DriverProfileService } from "./services/driver-profile.service";
import { DriverKycService } from "./services/driver-kyc.service";
import { DriverVehicleService } from "./services/driver-vehicle.service";
import { DriverAvailabilityService } from "./services/driver-availability.service";
import { DriverLocationService } from "./services/driver-location.service";
import { DriverDispatchService } from "./services/driver-dispatch.service";
import { TripsService } from "../trips/service";
import { DriverWalletService } from "./services/driver-wallet.service";
import { DriverIncentiveService } from "./services/driver-incentive.service";
import {
  DriverTripHistoryService,
  driverTripHistoryQuerySchema,
} from "./services/driver-trip-history.service";
import { DriverSupportService } from "./services/driver-support.service";
import { DriverSafetyService } from "./services/driver-safety.service";
import { DriverAccountService } from "./services/driver-account.service";
import { DriverDashboardService } from "./services/driver-dashboard.service";
import { DriverBookingJourneyService } from "./services/driver-booking-journey.service";
import { DriverSurgeService } from "./services/driver-surge.service";
import * as schemas from "./driver.validation";
import { env } from "../../config/env";
import { sessionCookieOptions } from "../../common/session-cookie";
import { prisma } from "../../database/prisma";
import { errors } from "../../common/errors";
import { buildFileUrl } from "../../common/url";

const authService = new DriverAuthService();
const profileService = new DriverProfileService();
const kycService = new DriverKycService();
const vehicleService = new DriverVehicleService();
const availabilityService = new DriverAvailabilityService();
const locationService = new DriverLocationService();
const dispatchService = new DriverDispatchService();
const tripService = new TripsService();
const walletService = new DriverWalletService();
const incentiveService = new DriverIncentiveService();
const tripHistoryService = new DriverTripHistoryService();
const supportService = new DriverSupportService();
const safetyService = new DriverSafetyService();
const accountService = new DriverAccountService();
const dashboardService = new DriverDashboardService();
const bookingJourneyService = new DriverBookingJourneyService();
const surgeService = new DriverSurgeService();

const getDriverId = async (userId: string) => {
  const driver = await prisma.driverProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!driver) throw errors.notFound("Driver profile not found");
  return driver.id;
};

const getIdempotencyKey = (request: FastifyRequest) => {
  const value = request.headers["x-idempotency-key"];
  if (typeof value !== "string" || !value.trim()) {
    throw errors.badRequest("x-idempotency-key header is required");
  }
  return value.trim();
};

const emptyToUndefined = (val: any) => {
  if (Buffer.isBuffer(val)) return undefined;
  if (typeof val === "string" && val.trim() === "") return undefined;
  return val;
};

const createVehicleSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const body = value as Record<string, unknown>;
    return {
      ...body,
      make: body.make ?? body.brand,
      registrationNo: body.registrationNo ?? body.registrationNumber,
      year: body.year ?? body.manufacturingYear,
    };
  },
  z.object({
    categoryId: z.string().uuid().optional().nullable(),
    brandId: z.string().uuid().optional().nullable(),
    modelId: z.string().uuid().optional().nullable(),
    make: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(80).optional(),
    registrationNo: z.string().trim().min(4).max(30),
    year: z.coerce
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1),
    color: z.preprocess(emptyToUndefined, z.string().max(40).optional()),
    fuelType: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(40).optional(),
    ),
    seatingCapacity: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(50).optional(),
    ),
    currentAddress: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(255).optional(),
    ),
    insuranceCompany: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(100).optional(),
    ),
    policyNumber: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(100).optional(),
    ),
    policyValidFrom: z.preprocess(
      emptyToUndefined,
      z.string().date("Invalid date format. Expected YYYY-MM-DD").optional(),
    ),
    policyValidTill: z.preprocess(
      emptyToUndefined,
      z.string().date("Invalid date format. Expected YYYY-MM-DD").optional(),
    ),
    drivingLicenseNumber: z.preprocess(
      emptyToUndefined,
      z.string().trim().toUpperCase().min(4).max(50).optional(),
    ),
  }),
);

const safetyReportSchema = z.object({
  description: z.string().trim().min(5).max(2_000),
});

export const driverController = {
  // --- AUTHENTICATION ---
  async requestOtp(request: FastifyRequest) {
    const input = parse(schemas.requestOtp, request.body);
    await authService.requestOtp(input.mobile, request.ip);
    return {
      success: true,
      message: "OTP sent successfully",
    };
  },

  async verifyOtp(request: FastifyRequest, reply: FastifyReply) {
    const input = parse(schemas.verifyOtp, request.body);
    const result = await authService.verifyOtp(input.mobile, input.otp, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      deviceId: input.deviceId,
    });

    const savedProfile = result.loginState.isNewDriver
      ? null
      : await profileService.getLoginProfile(result.session.session.userId);

    reply.setCookie(
      env.COOKIE_NAME,
      result.session.cookieValue,
      sessionCookieOptions(),
    );

    if (result.loginState.isNewDriver) {
      return {
        success: true,
        message: "OTP verified successfully",
        data: null,
      };
    }

    const isProfileCompleted = savedProfile?.isProfileCompleted ?? false;

    const { userId, driverId, hasAssignedVehicle, ...restLoginState } =
      result.loginState;

    logDriver("Logged In", {
      userId: result.session.session.userId,
      isNewDriver: false,
    });

    return {
      success: true,
      message: "Logged in successfully",
      data: {
        ...restLoginState,
        driverId,
        isProfileCompleted,
        canGoOnline: result.loginState.canGoOnline && isProfileCompleted,
        nextStep:
          isProfileCompleted || result.loginState.hasActiveBooking
            ? result.loginState.nextStep
            : "COMPLETE_PROFILE",
        profile: savedProfile?.profile ?? null,
      },
    };
  },

  async resendOtp(request: FastifyRequest) {
    const input = parse(schemas.requestOtp, request.body);
    await authService.resendOtp(input.mobile, request.ip);
    return success(null, "OTP resent successfully");
  },

  async logout(request: FastifyRequest, reply: FastifyReply) {
    try {
      if (request.authSession) {
        await authService.logout(
          request.authSession.userId,
          request.authSession.sessionId,
        );
      }
    } catch (error) {
      request.log.error(error);
    }
    reply.clearCookie(env.COOKIE_NAME, {
      path: "/",
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
    return success(null, "Logged out successfully");
  },

  async me(request: FastifyRequest) {
    const profile = await authService.me(request.authSession!.userId);
    return success(profile, "Profile retrieved");
  },

  async listSessions(request: FastifyRequest) {
    const sessions = await authService.listSessions(
      request.authSession!.userId,
    );
    return success(sessions, "Sessions retrieved");
  },

  async revokeSession(request: FastifyRequest) {
    const { sessionId } = request.params as { sessionId: string };
    await authService.revokeManagedSession(
      request.authSession!.userId,
      sessionId,
    );
    return success(null, "Session revoked");
  },

  // --- PROFILE & ONBOARDING ---
  async createProfile(request: FastifyRequest) {
    const data = parse(schemas.createProfile, request.body);
    const profile = await profileService.createProfile(
      request.authSession!.userId,
      data,
      {
        driverId: "", // Will be assigned inside
        userId: request.authSession!.userId,
        sessionId: request.authSession!.sessionId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: String(request.id),
      },
    );

    const {
      serviceAreaId,
      navigationPreference,
      landmark,
      userId,
      id: driverId,
      user: driver,
      onboardingStatus: _onboardingStatus,
      latitude,
      longitude,
      dateOfBirth,
      drivingLicenseIssueDate,
      drivingLicenseExpiryDate,
      createdAt,
      updatedAt,
      verifiedAt,
      ...restData
    } = profile;

    const formatDate = (d: any) =>
      d instanceof Date
        ? d.toISOString().split("T")[0]
        : d
          ? String(d).split("T")[0]
          : null;

    return {
      success: true,
      message: "Driver profile created successfully",
      data: {
        driverId,
        ...restData,
        driver,
        dateOfBirth: formatDate(dateOfBirth),
        drivingLicenseIssueDate: formatDate(drivingLicenseIssueDate),
        drivingLicenseExpiryDate: formatDate(drivingLicenseExpiryDate),
        createdAt: formatDate(createdAt),
        updatedAt: formatDate(updatedAt),
        verifiedAt: formatDate(verifiedAt),
        profileImageUrl: buildFileUrl(request, restData.profileImageUrl),
      },
    };
  },

  async getProfile(request: FastifyRequest) {
    const profile = await profileService.getProfile(
      request.authSession!.userId,
    );

    const {
      serviceAreaId,
      navigationPreference,
      landmark,
      userId,
      id: driverId,
      user: driver,
      onboardingStatus: _onboardingStatus,
      latitude,
      longitude,
      dateOfBirth,
      drivingLicenseIssueDate,
      drivingLicenseExpiryDate,
      createdAt,
      updatedAt,
      verifiedAt,
      ...restData
    } = profile;

    const formatDate = (d: any) =>
      d instanceof Date
        ? d.toISOString().split("T")[0]
        : d
          ? String(d).split("T")[0]
          : null;

    return {
      success: true,
      message: "Profile retrieved",
      data: {
        driverId,
        ...restData,
        driver,
        dateOfBirth: formatDate(dateOfBirth),
        drivingLicenseIssueDate: formatDate(drivingLicenseIssueDate),
        drivingLicenseExpiryDate: formatDate(drivingLicenseExpiryDate),
        createdAt: formatDate(createdAt),
        updatedAt: formatDate(updatedAt),
        verifiedAt: formatDate(verifiedAt),
        profileImageUrl: buildFileUrl(request, restData.profileImageUrl),
      },
    };
  },

  async updateProfile(request: FastifyRequest) {
    const data = parse(schemas.updateProfile, request.body);
    const profile = await profileService.updateProfile(
      request.authSession!.userId,
      data,
      {
        driverId: "", // Will be assigned inside
        userId: request.authSession!.userId,
        sessionId: request.authSession!.sessionId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: String(request.id),
      },
    );

    const {
      serviceAreaId,
      navigationPreference,
      landmark,
      userId,
      latitude,
      longitude,
      dateOfBirth,
      drivingLicenseIssueDate,
      drivingLicenseExpiryDate,
      createdAt,
      updatedAt,
      verifiedAt,
      ...restData
    } = profile;

    const formatDate = (d: any) =>
      d instanceof Date
        ? d.toISOString().split("T")[0]
        : d
          ? String(d).split("T")[0]
          : null;

    return {
      success: true,
      message: "Profile updated",
      data: {
        ...restData,
        dateOfBirth: formatDate(dateOfBirth),
        drivingLicenseIssueDate: formatDate(drivingLicenseIssueDate),
        drivingLicenseExpiryDate: formatDate(drivingLicenseExpiryDate),
        createdAt: formatDate(createdAt),
        updatedAt: formatDate(updatedAt),
        verifiedAt: formatDate(verifiedAt),
      },
    };
  },

  async submitDrivingLicense(request: FastifyRequest) {
    const data = parse(schemas.submitDrivingLicense, request.body);
    const profile = await profileService.updateProfile(
      request.authSession!.userId,
      {
        drivingLicenseNumber: data.drivingLicenseNumber,
        drivingLicenseIssueDate: data.drivingLicenseIssueDate,
        drivingLicenseExpiryDate: data.drivingLicenseExpiryDate,
        drivingExperienceYears: data.drivingExperienceYears,
      },
      {
        driverId: "",
        userId: request.authSession!.userId,
        sessionId: request.authSession!.sessionId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: String(request.id),
      },
    );

    const formatDate = (d: any) =>
      d instanceof Date
        ? d.toISOString().split("T")[0]
        : d
          ? String(d).split("T")[0]
          : null;

    return success(
      {
        licenseNumber: profile.licenseNumber,
        drivingLicenseIssueDate: formatDate(profile.drivingLicenseIssueDate),
        drivingLicenseExpiryDate: formatDate(profile.drivingLicenseExpiryDate),
        drivingExperienceYears: profile.drivingExperienceYears,
      },
      "Driving license details submitted successfully",
    );
  },

  async getOnboardingStatus(request: FastifyRequest) {
    const status = await profileService.getOnboardingStatus(
      request.authSession!.userId,
    );
    return success(status, "Onboarding status retrieved");
  },

  async getAccountInfo(request: FastifyRequest) {
    const info = await profileService.getAccountInfo(
      request.authSession!.userId,
    );
    return success(
      {
        ...info,
        personalInfo: {
          ...info.personalInfo,
          profileImageUrl: buildFileUrl(
            request,
            info.personalInfo.profileImageUrl,
          ),
        },
      },
      "Account information fetched successfully",
    );
  },

  async getAccountStatus(request: FastifyRequest) {
    const status = await profileService.getAccountStatus(
      request.authSession!.userId,
    );
    return success(status, "Account status retrieved");
  },

  async createProfileImageUploadUrl(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }

    const body: any = request.body;
    let file = body?.profileImage;
    if (Array.isArray(file)) {
      file = file[0];
    }

    if (!file || !file.buffer) {
      throw errors.badRequest("A single profileImage file field is required");
    }

    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      throw errors.badRequest("profileImage must be a JPEG or PNG file");
    }

    const imageBuffer = file.buffer;
    const contentType = file.mimetype;

    const { uploadDriverProfileImage } =
      await import("../../integrations/storage");
    const upload = await uploadDriverProfileImage(
      request.authSession!.userId,
      contentType,
      imageBuffer,
    );

    // Auto-update the profile image URL unconditionally so it shows up in GET /profile
    await profileService.updateProfile(
      request.authSession!.userId,
      { profileImageUrl: upload.uploadUrl },
      {
        driverId: "",
        userId: request.authSession!.userId,
        sessionId: request.authSession!.sessionId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: String(request.id),
      },
    );

    return {
      success: true,
      message: "Profile image uploaded",
      data: {
        uploadUrl: upload.uploadUrl,
      },
    };
  },

  async deleteProfileImage(request: FastifyRequest) {
    await profileService.updateProfile(
      request.authSession!.userId,
      { profileImageUrl: null },
      {
        driverId: "",
        userId: request.authSession!.userId,
        sessionId: request.authSession!.sessionId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: String(request.id),
      },
    );
    return success(null, "Profile image deleted");
  },

  // --- KYC & DOCUMENTS ---
  async getKycStatus(request: FastifyRequest) {
    const status = await kycService.getKycStatus(request.authSession!.userId);
    return success(status, "KYC status retrieved");
  },

  async getKycDetails(request: FastifyRequest) {
    const details = await kycService.getKycDetails(request.authSession!.userId);
    return success(details, "KYC details retrieved");
  },

  async uploadKycDocuments(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }

    const body = request.body as Record<string, unknown> | undefined;
    if (!body) throw errors.badRequest("No documents provided");

    const allowedFields = new Set([
      "DL_FRONT",
      "DL_BACK",
      "RC",
      "INSURANCE",
      "CHASSIS_PHOTO",
      "VEHICLE_PHOTO",
      "AADHAR_FRONT",
      "AADHAR_BACK",
      "PASSBOOK_IMAGE",
      "PAN_CARD",
      "COMMERCIAL_PERMIT",
    ]);

    const documentsToUpload: Array<{
      type: string;
      contentType: string;
      file: Buffer;
    }> = [];

    const getContentType = (field: string, file: Buffer) => {
      const isPdf =
        file.length >= 5 &&
        file.subarray(0, 5).equals(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]));
      const isJpeg =
        file.length >= 3 &&
        file[0] === 0xff &&
        file[1] === 0xd8 &&
        file[2] === 0xff;
      const pngSignature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const isPng =
        file.length >= pngSignature.length &&
        file.subarray(0, pngSignature.length).equals(pngSignature);
      if (isPdf || isJpeg || isPng) {
        return isPdf ? "application/pdf" : isPng ? "image/png" : "image/jpeg";
      }
      throw errors.badRequest(`${field} must be a PDF, JPEG, or PNG document`);
    };

    for (const field of allowedFields) {
      if ((body[field] as any)?.buffer) {
        const file = (body[field] as any).buffer as Buffer;
        documentsToUpload.push({
          type: field,
          contentType: getContentType(field, file),
          file,
        });
      }
    }

    if (documentsToUpload.length === 0) {
      throw errors.badRequest("At least one valid document must be provided");
    }

    const result = await kycService.uploadKycDocuments(
      request.authSession!.userId,
      documentsToUpload,
    );
    return success(result, "KYC documents uploaded successfully");
  },

  async uploadKycDraft(request: FastifyRequest) {
    const input = parse(
      z.object({
        type: z.string().trim().min(2).max(50),
        documentNo: z.string().trim().max(50).optional(),
        file: z.string().min(1, "File is required"),
      }),
      request.body,
    );

    const result = await kycService.uploadDocumentDraft(
      request.authSession!.userId,
      input.type,
      input.documentNo,
      input.file,
    );
    return success(result, "KYC document draft uploaded");
  },

  async submitKyc(request: FastifyRequest) {
    const submission = await kycService.submitKyc(request.authSession!.userId);
    return success(submission, "KYC submitted successfully");
  },

  async getDocuments(request: FastifyRequest) {
    const docs = await kycService.getDocuments(request.authSession!.userId);
    return success(docs, "Documents retrieved");
  },

  async getDocument(request: FastifyRequest) {
    const { documentId } = request.params as { documentId: string };
    const doc = await kycService.getDocument(
      request.authSession!.userId,
      documentId,
    );
    return success(doc, "Document retrieved");
  },

  async createDocumentUploadUrl(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }

    const body = request.body as Record<string, unknown> | undefined;
    const requiredFileFields = [
      "DL_FRONT",
      "DL_BACK",
      "AADHAR_FRONT",
      "AADHAR_BACK",
      "PAN_CARD",
    ] as const;
    const allowedFields = new Set([
      ...requiredFileFields,
      "PROFILE_PHOTO",
      "aadharNumber",
      "panNumber",
      "bankAccountNumber",
      "ifscCode",
      "confirmIfscCode",
      "PASSBOOK_IMAGE",
    ]);
    if (
      !body ||
      Object.keys(body).some((field) => !allowedFields.has(field)) ||
      requiredFileFields.some((field) => {
        const file: any = body[field];
        return !file || !file.buffer;
      })
    ) {
      throw errors.badRequest(
        "All required KYC document file fields must be provided",
      );
    }

    const input = parse(
      z
        .object({
          aadharNumber: z
            .string()
            .trim()
            .regex(/^\d{12}$/, "aadharNumber must contain exactly 12 digits"),
          panNumber: z
            .string()
            .trim()
            .toUpperCase()
            .regex(
              /^[A-Z]{5}[0-9]{4}[A-Z]$/,
              "panNumber must be a valid PAN number",
            ),
          bankAccountNumber: z.preprocess(
            (value) =>
              typeof value === "string" && value.trim() === ""
                ? undefined
                : value,
            z
              .string()
              .trim()
              .regex(/^\d{5,35}$/)
              .optional(),
          ),
          ifscCode: z.preprocess(
            (value) =>
              typeof value === "string" && value.trim() === ""
                ? undefined
                : value,
            z
              .string()
              .trim()
              .toUpperCase()
              .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/)
              .optional(),
          ),
          confirmIfscCode: z.preprocess(
            (value) =>
              typeof value === "string" && value.trim() === ""
                ? undefined
                : value,
            z
              .string()
              .trim()
              .toUpperCase()
              .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/)
              .optional(),
          ),
        })
        .superRefine((data, context) => {
          const hasBankDetails =
            data.bankAccountNumber !== undefined ||
            data.ifscCode !== undefined ||
            data.confirmIfscCode !== undefined ||
            body.PASSBOOK_IMAGE !== undefined;
          if (!hasBankDetails) return;

          if (
            !data.bankAccountNumber ||
            !data.ifscCode ||
            !data.confirmIfscCode ||
            !(body.PASSBOOK_IMAGE as any)?.buffer
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "bankAccountNumber, ifscCode, confirmIfscCode, and PASSBOOK_IMAGE must be provided together",
            });
          } else if (data.ifscCode !== data.confirmIfscCode) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["confirmIfscCode"],
              message: "IFSC codes do not match",
            });
          }
        }),
      {
        aadharNumber: body.aadharNumber,
        panNumber: body.panNumber,
        bankAccountNumber: body.bankAccountNumber,
        ifscCode: body.ifscCode,
        confirmIfscCode: body.confirmIfscCode,
      },
    );

    const getContentType = (field: string, file: Buffer, imageOnly = false) => {
      const isPdf =
        file.length >= 5 &&
        file.subarray(0, 5).equals(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]));
      const isJpeg =
        file.length >= 3 &&
        file[0] === 0xff &&
        file[1] === 0xd8 &&
        file[2] === 0xff;
      const pngSignature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const isPng =
        file.length >= pngSignature.length &&
        file.subarray(0, pngSignature.length).equals(pngSignature);
      if ((!imageOnly && isPdf) || isJpeg || isPng) {
        return isPdf ? "application/pdf" : isPng ? "image/png" : "image/jpeg";
      }
      throw errors.badRequest(
        `${field} must be ${imageOnly ? "a JPEG or PNG image" : "a PDF, JPEG, or PNG document"}`,
      );
    };

    const documents: Array<{
      type: string;
      documentNo?: string;
      contentType: string;
      file: Buffer;
    }> = requiredFileFields.map((type) => {
      const file = (body[type] as any).buffer as Buffer;
      return {
        type,
        documentNo:
          type === "AADHAR_FRONT" || type === "AADHAR_BACK"
            ? input.aadharNumber
            : type === "PAN_CARD"
              ? input.panNumber
              : undefined,
        contentType: getContentType(type, file, false),
        file,
      };
    });
    if ((body.PASSBOOK_IMAGE as any)?.buffer) {
      documents.push({
        type: "PASSBOOK_IMAGE",
        contentType: getContentType(
          "PASSBOOK_IMAGE",
          (body.PASSBOOK_IMAGE as any).buffer,
          true,
        ),
        file: (body.PASSBOOK_IMAGE as any).buffer,
      });
    }
    if ((body.PROFILE_PHOTO as any)?.buffer) {
      documents.push({
        type: "PROFILE_PHOTO",
        contentType: getContentType(
          "PROFILE_PHOTO",
          (body.PROFILE_PHOTO as any).buffer,
          true,
        ),
        file: (body.PROFILE_PHOTO as any).buffer,
      });
    }

    const result = await kycService.createDocumentUploadUrl(
      request.authSession!.userId,
      documents,
      input.bankAccountNumber && input.ifscCode
        ? {
            accountNumber: input.bankAccountNumber,
            ifscCode: input.ifscCode,
          }
        : undefined,
    );
    return {
      success: true,
      message: "KYC documents uploaded",
      data: result,
    };
  },

  async getExpiringDocuments(request: FastifyRequest) {
    const query = parse(
      z.object({
        withinDays: z.coerce.number().int().min(1).max(365).default(30),
      }),
      request.query,
    );
    const documents = await kycService.getExpiringDocuments(
      request.authSession!.userId,
      query.withinDays,
    );
    return success(documents, "Expiring documents retrieved");
  },

  async reuploadDocument(request: FastifyRequest) {
    const { documentId: pathDocumentId } = request.params as {
      documentId?: string;
    };
    const input = parse(
      z.object({
        documentId: z.string().uuid().optional(),
        contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024),
      }),
      request.body,
    );
    const documentId = pathDocumentId ?? input.documentId;
    if (!documentId) throw errors.badRequest("documentId is required");
    const document = await kycService.reuploadDocument(
      request.authSession!.userId,
      documentId,
      input.contentType,
      input.sizeBytes,
    );
    return success(document, "Document reuploaded for review");
  },

  // --- VEHICLES & CATEGORIES ---
  async getCategories(_request: FastifyRequest) {
    const categories = await vehicleService.getCategories();
    return success(categories, "Vehicle categories retrieved");
  },

  async getCategory(request: FastifyRequest) {
    const { categoryId } = request.params as { categoryId: string };
    const category = await vehicleService.getCategory(categoryId);
    return success(category, "Vehicle category retrieved");
  },

  async getVehicles(request: FastifyRequest) {
    const vehicles = await vehicleService.getVehicles(
      request.authSession!.userId,
    );
    return success(vehicles, "Vehicles retrieved");
  },

  async getVehicle(request: FastifyRequest) {
    const { vehicleId } = request.params as { vehicleId: string };
    const vehicle = await vehicleService.getVehicle(
      request.authSession!.userId,
      vehicleId,
    );
    return success(vehicle, "Vehicle retrieved");
  },

  async getAssignedVehicle(request: FastifyRequest) {
    const assignment = await vehicleService.getAssignedVehicle(
      request.authSession!.userId,
    );
    return success(assignment, "Assigned vehicle retrieved");
  },

  async getVehicleInfo(request: FastifyRequest) {
    const info = await vehicleService.getVehicleInfo(
      request.authSession!.userId,
    );
    return success(info, "Vehicle information fetched successfully");
  },

  async createVehicle(request: FastifyRequest) {
    const input = parse(createVehicleSchema, request.body);
    if (input.drivingLicenseNumber) {
      try {
        await profileService.updateProfile(
          request.authSession!.userId,
          { drivingLicenseNumber: input.drivingLicenseNumber },
          {
            driverId: "",
            userId: request.authSession!.userId,
            sessionId: request.authSession!.sessionId,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
            requestId: String(request.id),
          },
        );
      } catch (err) {
        // Ignore non-fatal profile update errors
      }
    }
    const vehicle = await vehicleService.createVehicle(
      request.authSession!.userId,
      input,
    );

    const { id: vehicleId, category, ...restVehicle } = vehicle;
    const formattedCategory = category
      ? { categoryId: category.id, name: category.name, slug: category.slug }
      : null;

    return success(
      {
        vehicleId,
        ...restVehicle,
        category: formattedCategory,
      },
      "Vehicle created",
    );
  },

  async updateVehicle(request: FastifyRequest) {
    const { vehicleId } = request.params as { vehicleId: string };
    const input = parse(
      z.object({
        categoryId: z.string().uuid().optional(),
        brandId: z.string().uuid().optional().nullable(),
        modelId: z.string().uuid().optional().nullable(),
        make: z.string().trim().min(1).max(80).optional(),
        model: z.string().trim().min(1).max(80).optional(),
        registrationNo: z.string().trim().min(4).max(30).optional(),
        year: z.coerce
          .number()
          .int()
          .min(1900)
          .max(new Date().getFullYear() + 1)
          .optional(),
        color: z.preprocess(emptyToUndefined, z.string().max(40).optional()),
        fuelType: z.preprocess(emptyToUndefined, z.string().max(40).optional()),
        seatingCapacity: z.preprocess(
          emptyToUndefined,
          z.coerce.number().int().min(1).max(50).optional(),
        ),
        currentAddress: z.preprocess(
          emptyToUndefined,
          z.string().trim().max(255).optional(),
        ),
        insuranceCompany: z.preprocess(
          emptyToUndefined,
          z.string().trim().max(100).optional(),
        ),
        policyNumber: z.preprocess(
          emptyToUndefined,
          z.string().trim().max(100).optional(),
        ),
        policyValidFrom: z.preprocess(
          emptyToUndefined,
          z
            .string()
            .date("Invalid date format. Expected YYYY-MM-DD")
            .optional(),
        ),
        policyValidTill: z.preprocess(
          emptyToUndefined,
          z
            .string()
            .date("Invalid date format. Expected YYYY-MM-DD")
            .optional(),
        ),
      }),
      request.body,
    );
    const vehicle = await vehicleService.updateVehicle(
      request.authSession!.userId,
      vehicleId,
      input,
    );
    return success(vehicle, "Vehicle updated");
  },

  async deleteVehicle(request: FastifyRequest) {
    const { vehicleId } = request.params as { vehicleId: string };
    await vehicleService.deleteVehicle(request.authSession!.userId, vehicleId);
    return success(null, "Vehicle deleted");
  },

  async createVehicleDocumentUploadUrl(request: FastifyRequest) {
    const { vehicleId } = request.params as { vehicleId: string };
    const input = parse(
      z.object({
        type: z.string().trim().min(2).max(50),
        contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024),
      }),
      request.body,
    );
    const upload = await vehicleService.createVehicleDocumentUploadUrl(
      request.authSession!.userId,
      vehicleId,
      input.type,
      input.contentType,
      input.sizeBytes,
    );
    return success(upload, "Signed upload URL created");
  },

  async uploadVehicleDocuments(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }
    const { vehicleId } = request.params as { vehicleId: string };
    const body = request.body as Record<string, unknown> | undefined;

    if (!body) {
      throw errors.badRequest("Request body is empty");
    }

    const documents: Array<{
      type: string;
      documentNo?: string;
      contentType: string;
      file: Buffer;
    }> = [];

    const getContentType = (field: string, file: Buffer) => {
      const isPdf =
        file.length >= 5 &&
        file.subarray(0, 5).equals(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]));
      const isJpeg =
        file.length >= 3 &&
        file[0] === 0xff &&
        file[1] === 0xd8 &&
        file[2] === 0xff;
      const pngSignature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const isPng =
        file.length >= pngSignature.length &&
        file.subarray(0, pngSignature.length).equals(pngSignature);

      if (isPdf || isJpeg || isPng) {
        return isPdf ? "application/pdf" : isPng ? "image/png" : "image/jpeg";
      }
      throw errors.badRequest(`${field} must be a PDF, JPEG, or PNG document`);
    };

    for (const [key, value] of Object.entries(body)) {
      if ((value as any)?.buffer) {
        documents.push({
          type: key.toUpperCase(),
          contentType: getContentType(key, (value as any).buffer),
          file: (value as any).buffer,
        });
      }
    }

    if (documents.length === 0) {
      throw errors.badRequest(
        "No valid document files provided in the request body",
      );
    }

    const result = await vehicleService.uploadVehicleDocuments(
      request.authSession!.userId,
      vehicleId,
      documents,
    );

    return success(result, "Vehicle documents uploaded");
  },

  async getVehicleDocuments(request: FastifyRequest) {
    const { vehicleId } = request.params as { vehicleId: string };
    const docs = await vehicleService.getVehicleDocuments(
      request.authSession!.userId,
      vehicleId,
    );
    return success(docs, "Vehicle documents retrieved");
  },

  async submitVehicleForVerification(request: FastifyRequest) {
    const { vehicleId } = request.params as { vehicleId: string };
    const result = await vehicleService.submitVehicleForVerification(
      request.authSession!.userId,
      vehicleId,
    );
    return success(result, "Vehicle submitted for verification");
  },

  async getVehicleVerificationStatus(request: FastifyRequest) {
    const { vehicleId } = request.params as { vehicleId: string };
    const status = await vehicleService.getVehicleVerificationStatus(
      request.authSession!.userId,
      vehicleId,
    );
    return success(status, "Vehicle verification status retrieved");
  },

  async selectVehicle(request: FastifyRequest) {
    const { vehicleId } = request.params as { vehicleId: string };
    const result = await vehicleService.selectVehicle(
      request.authSession!.userId,
      vehicleId,
    );
    return success(result, "Vehicle selected successfully");
  },

  // --- AVAILABILITY ---
  async getAvailability(request: FastifyRequest) {
    const availability = await availabilityService.getAvailability(
      request.authSession!.userId,
    );
    return success(availability, "Availability retrieved");
  },

  async setAvailability(request: FastifyRequest) {
    const { availability } = parse(
      z.object({
        availability: z.enum(["OFFLINE", "ONLINE", "BUSY"]),
      }),
      request.body,
    );
    const updated = await availabilityService.setAvailability(
      request.authSession!.userId,
      availability,
    );
    return success(updated, "Availability updated");
  },

  async goOnline(request: FastifyRequest) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver not found");
    const updated = await availabilityService.goOnline(driver.id);
    logDriver("Went Online", { driverId: driver.id });
    return success(updated, "Availability updated to online");
  },

  async goOffline(request: FastifyRequest) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver not found");
    const updated = await availabilityService.goOffline(
      driver.id,
      "DRIVER_MANUAL_OFFLINE",
    );
    return success(updated, "Availability updated to offline");
  },

  async pauseAvailability(request: FastifyRequest) {
    const updated = await availabilityService.pause(
      request.authSession!.userId,
    );
    return success(updated, "Availability paused");
  },

  async resumeAvailability(request: FastifyRequest) {
    const updated = await availabilityService.resume(
      request.authSession!.userId,
    );
    return success(updated, "Availability resumed");
  },

  // --- LOCATION & DISPATCH ---
  async updateLocation(request: FastifyRequest) {
    const input = parse(
      z.object({
        latitude: z.coerce.number().min(-90).max(90),
        longitude: z.coerce.number().min(-180).max(180),
        heading: z.coerce.number().optional().nullable(),
        speed: z.coerce.number().optional().nullable(),
        accuracy: z.coerce.number().optional().nullable(),
        timestamp: z.coerce
          .date()
          .optional()
          .default(() => new Date()),
      }),
      request.body,
    );
    await locationService.updateLocation(request.authSession!.userId, {
      ...input,
      heading: input.heading ?? undefined,
      speed: input.speed ?? undefined,
      accuracy: input.accuracy ?? undefined,
    });
    return success(null, "Location updated");
  },

  async getCurrentLocation(request: FastifyRequest) {
    const location = await locationService.getCurrentLocation(
      request.authSession!.userId,
    );
    return success(location, "Current location retrieved");
  },

  // --- DASHBOARD & PERFORMANCE ---
  async getDashboard(request: FastifyRequest) {
    const dashboard = await dashboardService.getDashboard(
      request.authSession!.userId,
    );
    return success(dashboard, "Driver dashboard retrieved");
  },

  async getStatistics(request: FastifyRequest) {
    const query = parse(
      z.object({
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
      }),
      request.query,
    );
    const statistics = await dashboardService.getStatistics(
      request.authSession!.userId,
      query.startDate,
      query.endDate,
    );
    return success(statistics, "Driver statistics retrieved");
  },

  async getPerformance(request: FastifyRequest) {
    const performance = await dashboardService.getPerformance(
      request.authSession!.userId,
    );
    return success(performance, "Driver performance retrieved");
  },

  async getActiveBooking(request: FastifyRequest) {
    const activeBooking = await bookingJourneyService.getActiveBooking(
      request.authSession!.userId,
    );
    if (activeBooking) {
      return success(activeBooking, "Active booking retrieved");
    }
    const offeredBooking = await dispatchService.getActiveRequest(
      await getDriverId(request.authSession!.userId),
    );
    return success(offeredBooking, "Active booking retrieved");
  },

  async getBookings(request: FastifyRequest) {
    const query = parse(
      z.object({
        status: z
          .enum([
            "PENDING",
            "SEARCHING_DRIVER",
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVING",
            "DRIVER_ARRIVED",
            "TRIP_STARTED",
            "TRIP_COMPLETED",
            "CANCELLED",
            "NO_DRIVER_FOUND",
            "PAYMENT_PENDING",
            "PAYMENT_COMPLETED",
          ])
          .optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        vehicleCategoryId: z.string().uuid().optional(),
        paymentMethod: z
          .enum([
            "CASH",
            "UPI",
            "CREDIT_CARD",
            "DEBIT_CARD",
            "NET_BANKING",
            "WALLET",
          ])
          .optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    const bookings = await bookingJourneyService.listBookings(
      request.authSession!.userId,
      query,
    );
    return success(bookings, "Bookings retrieved");
  },

  async getBooking(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const booking = await bookingJourneyService.getBooking(
      request.authSession!.userId,
      bookingId,
    );
    return success(booking, "Booking retrieved");
  },

  async getPickupRoute(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const route = await bookingJourneyService.getPickupRoute(
      request.authSession!.userId,
      bookingId,
    );
    return success(route, "Pickup route retrieved");
  },

  async getPickupEta(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const eta = await bookingJourneyService.getPickupEta(
      request.authSession!.userId,
      bookingId,
    );
    return success(eta, "Pickup ETA retrieved");
  },

  async navigateToPickup(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const trip = await bookingJourneyService.navigate(
      request.authSession!.userId,
      bookingId,
    );
    return success(trip, "Navigation to pickup started");
  },

  async getBookingMessages(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const messages = await bookingJourneyService.getMessages(
      request.authSession!.userId,
      bookingId,
    );
    return success(messages, "Booking messages retrieved");
  },

  async sendBookingMessage(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const input = parse(
      z.object({
        message: z.string().trim().min(1).max(2_000),
        attachments: z
          .array(z.record(z.string(), z.unknown()))
          .max(5)
          .optional(),
      }),
      request.body,
    );
    const message = await bookingJourneyService.sendMessage(
      request.authSession!.userId,
      bookingId,
      input.message,
      input.attachments,
    );
    return success(message, "Message sent");
  },

  async callCustomer(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const call = await bookingJourneyService.callCustomer(
      request.authSession!.userId,
      bookingId,
    );
    return success(call, "Masked call request processed");
  },

  async acceptRide(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const body = (
      typeof request.body === "object" && request.body !== null
        ? request.body
        : {}
    ) as Record<string, any>;
    const targetRequestId =
      body.requestId || body.offerId || body.bookingId || bookingId;

    console.log(`
================================================================================
=== ACCEPT RIDE DEBUG ===
--------------------------------------------------------------------------------
bookingId       : ${bookingId}
tripId          : ${bookingId}
driverId        : ${request.authSession!.userId}
targetRequestId : ${targetRequestId}
endpoint        : ${request.url}
method          : ${request.method}
payload         : ${JSON.stringify(body)}
================================================================================
`);

    const result = await dispatchService.acceptRide(
      request.authSession!.userId,
      bookingId,
      targetRequestId,
    );
    logDriver("Accepted Ride", {
      bookingId,
      driverId: request.authSession!.userId,
    });
    return success(result, "Ride accepted");
  },

  async rejectRide(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const body = (
      typeof request.body === "object" && request.body !== null
        ? request.body
        : {}
    ) as Record<string, any>;
    const targetRequestId =
      body.requestId || body.offerId || body.bookingId || bookingId;
    const reasonCode = body.reasonCode || body.reason || "REST_API_REJECT";

    console.log(`
================================================================================
=== REJECT RIDE DEBUG ===
--------------------------------------------------------------------------------
bookingId       : ${bookingId}
driverId        : ${request.authSession!.userId}
targetRequestId : ${targetRequestId}
reasonCode      : ${reasonCode}
endpoint        : ${request.url}
================================================================================
`);

    await dispatchService.rejectRide(
      request.authSession!.userId,
      bookingId,
      targetRequestId,
      reasonCode,
    );
    return success(null, "Ride rejected");
  },

  async cancelAssignedRide(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { reason } = parse(
      z.object({ reason: z.string().trim().min(2).max(100).optional() }),
      request.body,
    );
    const result = await dispatchService.cancelAssignedRide(
      request.authSession!.userId,
      bookingId,
      reason,
    );
    return success(result, "Ride released for redispatch");
  },

  // --- TRIPS ---
  async reportArrival(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await tripService.arrivedByBooking(
      bookingId,
      request.authSession!.userId,
    );
    return success(result, "Arrival reported");
  },

  async verifyPickupOtp(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { otp } = parse(
      z.object({ otp: z.string().regex(/^\d{4,8}$/) }),
      request.body,
    );
    const result = await bookingJourneyService.verifyPickupOtp(
      request.authSession!.userId,
      bookingId,
      otp,
    );
    return success(result, "Pickup OTP verified");
  },

  async startBookingTrip(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { otp } = parse(
      z.object({ otp: z.string().optional() }),
      request.body ?? {},
    );
    const result = await bookingJourneyService.startTrip(
      request.authSession!.userId,
      bookingId,
      otp,
    );
    return success(result, "Trip started");
  },

  async getTripRoute(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const route = await bookingJourneyService.getTripRoute(
      request.authSession!.userId,
      bookingId,
    );
    return success(route, "Trip route retrieved");
  },

  async getTripStops(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const stops = await bookingJourneyService.getStops(
      request.authSession!.userId,
      bookingId,
    );
    return success(stops, "Trip stops retrieved");
  },

  async arriveAtTripStop(request: FastifyRequest) {
    const { bookingId, stopId } = request.params as {
      bookingId: string;
      stopId: string;
    };
    const event = await bookingJourneyService.arriveAtStop(
      request.authSession!.userId,
      bookingId,
      stopId,
    );
    return success(event, "Stop arrival recorded");
  },

  async completeTripStop(request: FastifyRequest) {
    const { bookingId, stopId } = request.params as {
      bookingId: string;
      stopId: string;
    };
    const event = await bookingJourneyService.completeStop(
      request.authSession!.userId,
      bookingId,
      stopId,
    );
    return success(event, "Stop completed");
  },

  async getBookingLiveStatus(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const status = await bookingJourneyService.getLiveStatus(
      request.authSession!.userId,
      bookingId,
    );
    return success(status, "Live trip status retrieved");
  },

  async reportCustomerNoShow(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { note } = parse(
      z.object({ note: z.string().trim().max(500).optional() }),
      request.body ?? {},
    );
    const result = await bookingJourneyService.customerNoShow(
      request.authSession!.userId,
      bookingId,
      note,
    );
    return success(result, "Customer no-show recorded");
  },

  async completeBookingTrip(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingJourneyService.completeTrip(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Trip completed");
  },

  async confirmCashPayment(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const payment = await bookingJourneyService.confirmCashPayment(
      request.authSession!.userId,
      bookingId,
      getIdempotencyKey(request),
    );
    return success(payment, "Cash payment confirmed");
  },

  async getBookingPaymentStatus(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const payment = await bookingJourneyService.getPaymentStatus(
      request.authSession!.userId,
      bookingId,
    );
    return success(payment, "Payment status retrieved");
  },

  async requestStartOtp(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    await tripService.requestOtpForAssignedDriver(
      tripId,
      request.authSession!.userId,
    );
    return success(null, "Start OTP sent");
  },

  async startTrip(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const { otp } = parse(z.object({ otp: z.string() }), request.body);
    const result = await tripService.start(
      tripId,
      otp,
      request.authSession!.userId,
    );
    return success(result, "Trip started");
  },

  async completeTrip(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const result = await tripService.complete(
      tripId,
      request.authSession!.userId,
      {},
    );
    return success(result, "Trip completed");
  },

  // --- FINANCIALS ---
  async getEarnings(request: FastifyRequest) {
    const query = parse(
      z.object({
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    const earnings = await walletService.listEarnings(
      await getDriverId(request.authSession!.userId),
      query,
    );
    return success(earnings, "Earnings retrieved");
  },

  async getDailyEarnings(request: FastifyRequest) {
    const { date } = parse(
      z.object({ date: z.coerce.date().optional() }),
      request.query,
    );
    const earnings = await walletService.getEarningsByPeriod(
      await getDriverId(request.authSession!.userId),
      "daily",
      date,
    );
    return success(earnings, "Daily earnings retrieved");
  },

  async getWeeklyEarnings(request: FastifyRequest) {
    const { date } = parse(
      z.object({ date: z.coerce.date().optional() }),
      request.query,
    );
    const earnings = await walletService.getEarningsByPeriod(
      await getDriverId(request.authSession!.userId),
      "weekly",
      date,
    );
    return success(earnings, "Weekly earnings retrieved");
  },

  async getMonthlyEarnings(request: FastifyRequest) {
    const { date } = parse(
      z.object({ date: z.coerce.date().optional() }),
      request.query,
    );
    const earnings = await walletService.getEarningsByPeriod(
      await getDriverId(request.authSession!.userId),
      "monthly",
      date,
    );
    return success(earnings, "Monthly earnings retrieved");
  },

  async getBookingEarning(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const earning = await walletService.getEarningByBooking(
      await getDriverId(request.authSession!.userId),
      bookingId,
    );
    return success(earning, "Trip earning retrieved");
  },

  async getEarningsSummary(request: FastifyRequest) {
    const query = parse(
      z.object({
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
      }),
      request.query,
    );
    const summary = await walletService.getEarningsSummary(
      await getDriverId(request.authSession!.userId),
      query.startDate,
      query.endDate,
    );
    return success(summary, "Earnings summary retrieved");
  },

  async getEarningDetails(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const details = await walletService.getEarningDetails(
      await getDriverId(request.authSession!.userId),
      tripId,
    );
    return success(details, "Earning details retrieved");
  },

  async getWallet(request: FastifyRequest) {
    const wallet = await walletService.getWallet(
      await getDriverId(request.authSession!.userId),
    );
    return success(wallet, "Wallet retrieved");
  },

  async getWalletTransactions(request: FastifyRequest) {
    const query = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    const transactions = await walletService.getWalletTransactions(
      await getDriverId(request.authSession!.userId),
      query.limit,
      query.offset,
    );
    return success(transactions, "Wallet transactions retrieved");
  },

  async getSettlements(request: FastifyRequest) {
    const query = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    const settlements = await walletService.getSettlements(
      await getDriverId(request.authSession!.userId),
      query.limit,
      query.offset,
    );
    return success(settlements, "Settlements retrieved");
  },

  async getPayoutAccounts(request: FastifyRequest) {
    const accounts = await walletService.getPayoutAccounts(
      await getDriverId(request.authSession!.userId),
    );
    return success(accounts, "Payout accounts retrieved");
  },

  async addPayoutAccount(request: FastifyRequest) {
    const input = parse(
      z
        .object({
          accountName: z.string().min(2).max(100),
          accountNumber: z.string().min(5).max(100),
          confirmAccountNumber: z.string().min(5).max(100).optional(),
          bankCode: z.string().min(2).max(50),
          bankName: z.string().min(2).max(100),
        })
        .refine(
          (data) =>
            !data.confirmAccountNumber ||
            data.accountNumber === data.confirmAccountNumber,
          { message: "Account numbers do not match" },
        ),
      request.body,
    );
    const { confirmAccountNumber: _confirmation, ...accountInput } = input;
    const account = await walletService.addPayoutAccount(
      await getDriverId(request.authSession!.userId),
      accountInput,
    );
    return success(account, "Payout account added");
  },

  async addWalletMoney(request: FastifyRequest) {
    const { amount } = parse(
      z.object({ amount: z.number().positive().max(100_000) }),
      request.body,
    );
    const order = await walletService.createTopupOrder(
      await getDriverId(request.authSession!.userId),
      amount,
      getIdempotencyKey(request),
    );
    return success(order, "Wallet top-up order created");
  },

  async withdrawWallet(request: FastifyRequest) {
    const input = parse(
      z.object({
        amount: z.number().positive().max(1_000_000),
        payoutAccountId: z.string().uuid().optional(),
      }),
      request.body,
    );
    const payout = await walletService.requestWithdrawal(
      await getDriverId(request.authSession!.userId),
      { ...input, idempotencyKey: getIdempotencyKey(request) },
    );
    return success(payout, "Withdrawal requested");
  },

  async getWithdrawals(request: FastifyRequest) {
    return driverController.getSettlements(request);
  },

  async getWithdrawal(request: FastifyRequest) {
    const { withdrawalId } = request.params as { withdrawalId: string };
    const payout = await walletService.getSettlement(
      await getDriverId(request.authSession!.userId),
      withdrawalId,
    );
    return success(payout, "Withdrawal retrieved");
  },

  async updatePayoutAccount(request: FastifyRequest) {
    const { accountId } = request.params as { accountId: string };
    const input = parse(
      z
        .object({
          accountName: z.string().trim().min(2).max(100).optional(),
          accountNumber: z.string().trim().min(5).max(100).optional(),
          confirmAccountNumber: z.string().trim().min(5).max(100).optional(),
          bankCode: z.string().trim().min(2).max(50).optional(),
          bankName: z.string().trim().min(2).max(100).optional(),
        })
        .refine(
          (data) =>
            !data.accountNumber ||
            !data.confirmAccountNumber ||
            data.accountNumber === data.confirmAccountNumber,
          { message: "Account numbers do not match" },
        ),
      request.body,
    );
    const { confirmAccountNumber: _confirmation, ...data } = input;
    const account = await walletService.updatePayoutAccount(
      await getDriverId(request.authSession!.userId),
      accountId,
      data,
    );
    return success(account, "Bank account updated");
  },

  async deletePayoutAccount(request: FastifyRequest) {
    const { accountId } = request.params as { accountId: string };
    await walletService.deletePayoutAccount(
      await getDriverId(request.authSession!.userId),
      accountId,
    );
    return success(null, "Bank account deleted");
  },

  async setDefaultPayoutAccount(request: FastifyRequest) {
    const { accountId } = request.params as { accountId: string };
    const account = await walletService.setDefaultPayoutAccount(
      await getDriverId(request.authSession!.userId),
      accountId,
    );
    return success(account, "Default bank account updated");
  },

  async requestPayout(request: FastifyRequest) {
    return driverController.withdrawWallet(request);
  },

  async getPayout(request: FastifyRequest) {
    const { payoutId } = request.params as { payoutId: string };
    const payout = await walletService.getSettlement(
      await getDriverId(request.authSession!.userId),
      payoutId,
    );
    return success(payout, "Payout retrieved");
  },

  // --- INCENTIVES ---
  async getActiveIncentives(request: FastifyRequest) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const incentives = await incentiveService.getActiveIncentives(driver.id);
    return success(incentives, "Active incentives retrieved");
  },

  async getIncentives(request: FastifyRequest) {
    const driverId = await getDriverId(request.authSession!.userId);
    const [active, progress, history] = await Promise.all([
      incentiveService.getActiveIncentives(driverId),
      incentiveService.getProgress(driverId),
      incentiveService.getIncentiveHistory(driverId),
    ]);
    return success({ active, progress, history }, "Incentives retrieved");
  },

  async getIncentiveProgress(request: FastifyRequest) {
    const progress = await incentiveService.getProgress(
      await getDriverId(request.authSession!.userId),
    );
    return success(progress, "Incentive progress retrieved");
  },

  async getIncentiveHistory(request: FastifyRequest) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const history = await incentiveService.getIncentiveHistory(driver.id);
    return success(history, "Incentive history retrieved");
  },

  // --- TRIP HISTORY & RATINGS ---
  async getTripHistory(request: FastifyRequest) {
    const query = parse(driverTripHistoryQuerySchema, request.query);
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const history = await tripHistoryService.getTripHistory(driver.id, query);
    return success(history, "Trip history retrieved");
  },

  async getTripDetails(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const details = await tripHistoryService.getTripDetails(driver.id, tripId);
    return success(details, "Trip details retrieved");
  },

  async getRatingsSummary(request: FastifyRequest) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const summary = await tripHistoryService.getRatingsSummary(driver.id);
    return success(summary, "Ratings summary retrieved");
  },

  async getRatings(request: FastifyRequest) {
    const query = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    const ratings = await tripHistoryService.getRatings(
      await getDriverId(request.authSession!.userId),
      query.limit,
      query.offset,
    );
    return success(ratings, "Ratings retrieved");
  },

  async rateBookingCustomer(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const input = parse(
      z.object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().max(1_000).optional(),
      }),
      request.body,
    );
    const rating = await bookingJourneyService.rateCustomer(
      request.authSession!.userId,
      bookingId,
      input.rating,
      input.comment,
    );
    return success(rating, "Customer rated successfully");
  },

  async getBookingCustomerRating(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const rating = await bookingJourneyService.getCustomerRating(
      request.authSession!.userId,
      bookingId,
    );
    return success(rating, "Customer rating retrieved");
  },

  async rateCustomer(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const { rating, comment } = parse(
      z.object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().optional(),
      }),
      request.body,
    );
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const result = await tripHistoryService.rateCustomer(
      driver.id,
      tripId,
      rating,
      comment,
    );
    return success(result, "Customer rated successfully");
  },

  // --- SUPPORT & NOTIFICATIONS ---
  async getNotifications(request: FastifyRequest) {
    const notifications = await supportService.getNotifications(
      request.authSession!.userId,
    );
    return success(notifications, "Notifications retrieved");
  },

  async getUnreadCount(request: FastifyRequest) {
    const count = await supportService.getUnreadCount(
      request.authSession!.userId,
    );
    return success(count, "Unread count retrieved");
  },

  async markNotificationRead(request: FastifyRequest) {
    const { notificationId } = request.params as { notificationId: string };
    await supportService.markRead(request.authSession!.userId, notificationId);
    return success(null, "Notification marked as read");
  },

  async markAllRead(request: FastifyRequest) {
    await supportService.markAllRead(request.authSession!.userId);
    return success(null, "All notifications marked as read");
  },

  async deleteNotification(request: FastifyRequest) {
    const { notificationId } = request.params as { notificationId: string };
    await supportService.deleteNotification(
      request.authSession!.userId,
      notificationId,
    );
    return success(null, "Notification deleted");
  },

  async addDeviceToken(request: FastifyRequest) {
    const { token, platform } = parse(
      z.object({
        token: z.string(),
        platform: z.preprocess(
          (val) => (typeof val === "string" ? val.toUpperCase() : val),
          z.enum(["IOS", "ANDROID", "WEB"]),
        ),
      }),
      request.body,
    );
    await supportService.addDeviceToken(
      request.authSession!.userId,
      token,
      platform,
    );
    console.log(`[FCM][TOKEN_REGISTERED] driverUserId=${request.authSession!.userId} platform=${platform} tokenPrefix=${token.substring(0, 15)}...`);
    return success(null, "Device token added");
  },

  async removeDeviceToken(request: FastifyRequest) {
    const params = request.params as { token?: string };
    const query = request.query as { token?: string };
    const token = params.token || query.token;
    if (!token) throw errors.badRequest("Token parameter required");
    await supportService.removeDeviceToken(request.authSession!.userId, token);
    return success(null, "Device token removed");
  },

  async addDevice(request: FastifyRequest) {
    const { token, platform } = parse(
      z.object({
        token: z.string().trim().min(10).max(4_096),
        platform: z.preprocess(
          (val) => (typeof val === "string" ? val.toUpperCase() : val),
          z.enum(["IOS", "ANDROID", "WEB"]),
        ),
      }),
      request.body,
    );
    const device = await supportService.addDeviceToken(
      request.authSession!.userId,
      token,
      platform,
    );
    return success(device, "Device registered");
  },

  async removeDevice(request: FastifyRequest) {
    const { deviceId } = request.params as { deviceId: string };
    await supportService.removeDevice(request.authSession!.userId, deviceId);
    return success(null, "Device removed");
  },

  async getSupportCategories(_request: FastifyRequest) {
    const categories = await supportService.getCategories();
    return success(categories, "Support categories retrieved");
  },

  async createTicket(request: FastifyRequest) {
    const input = parse(
      z.object({
        subject: z.string().min(2).max(100),
        description: z.string().min(10),
        bookingId: z.string().uuid().optional(),
        tripId: z.string().uuid().optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
      }),
      request.body,
    );
    const ticket = await supportService.createTicket(
      request.authSession!.userId,
      input,
    );
    return success(ticket, "Support ticket created");
  },

  async getTickets(request: FastifyRequest) {
    const tickets = await supportService.getTickets(
      request.authSession!.userId,
    );
    return success(tickets, "Support tickets retrieved");
  },

  async getTicket(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const ticket = await supportService.getTicket(
      request.authSession!.userId,
      ticketId,
    );
    return success(ticket, "Support ticket retrieved");
  },

  async addTicketMessage(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const { message } = parse(
      z.object({ message: z.string().trim().min(1).max(2_000) }),
      request.body,
    );
    const created = await supportService.addTicketMessage(
      request.authSession!.userId,
      ticketId,
      message,
    );
    return success(created, "Support message sent");
  },

  async getSupportMessages(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const result = await supportService.getMessages(
      request.authSession!.userId,
      ticketId,
    );
    return success(result, "Support ticket messages retrieved");
  },

  async markSupportMessagesRead(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const result = await supportService.markMessagesRead(
      request.authSession!.userId,
      ticketId,
    );
    return success(result, "Support messages marked as read");
  },

  async uploadSupportAttachment(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }

    const body: any = request.body;
    let file = body?.attachment;
    if (Array.isArray(file)) {
      file = file[0];
    }

    if (!file || !file.buffer) {
      throw errors.badRequest("attachment file is required");
    }

    if (
      ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        file.mimetype,
      ) === false
    ) {
      throw errors.badRequest(
        "Support attachment must be a JPEG, PNG, WebP image or PDF file",
      );
    }

    const result = await supportService.uploadAttachment(
      request.authSession!.userId,
      file.mimetype as
        "image/jpeg" | "image/png" | "image/webp" | "application/pdf",
      file.buffer,
      file.filename,
    );

    return success(result, "Support attachment uploaded");
  },

  async closeSupportTicket(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const result = await supportService.closeTicket(
      request.authSession!.userId,
      ticketId,
    );
    return success(result, "Ticket closed successfully");
  },

  async reportBooking(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const input = parse(
      z.object({
        category: z.enum([
          "PAYMENT_MISSING",
          "WRONG_FARE",
          "CUSTOMER_BEHAVIOUR",
          "CANCELLATION_PENALTY",
          "VEHICLE_ISSUE",
          "APP_ISSUE",
          "KYC_ISSUE",
          "DOCUMENT_ISSUE",
          "PAYOUT_ISSUE",
          "SAFETY_ISSUE",
          "OTHER",
        ]),
        description: z.string().trim().min(10).max(2_000),
      }),
      request.body,
    );
    const ticket = await supportService.reportBooking(
      request.authSession!.userId,
      bookingId,
      input,
    );
    return success(ticket, "Booking report submitted");
  },

  // --- SAFETY & SOS ---
  async raiseSos(request: FastifyRequest) {
    const input = parse(
      z.object({
        tripId: z.string().uuid().optional(),
        latitude: z.number(),
        longitude: z.number(),
        message: z.string().optional(),
      }),
      request.body,
    );
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const sos = await safetyService.raiseSos(driver.id, input);
    return success(sos, "SOS raised successfully");
  },

  async raiseBookingSos(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const input = parse(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        message: z.string().trim().max(1_000).optional(),
      }),
      request.body,
    );
    const sos = await bookingJourneyService.raiseSos(
      request.authSession!.userId,
      bookingId,
      input,
    );
    return success(sos, "SOS raised successfully");
  },

  async reportBookingSafetyIssue(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const input = parse(
      safetyReportSchema.extend({
        type: z
          .enum([
            "UNSAFE_CUSTOMER",
            "CUSTOMER_MISCONDUCT",
            "ACCIDENT",
            "VEHICLE_BREAKDOWN",
            "ROUTE_SAFETY",
            "MEDICAL_EMERGENCY",
            "OTHER",
          ])
          .default("OTHER"),
      }),
      request.body,
    );
    const incident = await bookingJourneyService.reportSafetyIssue(
      request.authSession!.userId,
      bookingId,
      input.type,
      input.description,
    );
    return success(incident, "Safety issue reported");
  },

  async reportCustomer(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { description } = parse(safetyReportSchema, request.body);
    const incident = await bookingJourneyService.reportSafetyIssue(
      request.authSession!.userId,
      bookingId,
      "CUSTOMER_MISCONDUCT",
      description,
    );
    return success(incident, "Customer reported");
  },

  async reportAccident(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { description } = parse(safetyReportSchema, request.body);
    const incident = await bookingJourneyService.reportSafetyIssue(
      request.authSession!.userId,
      bookingId,
      "ACCIDENT",
      description,
    );
    return success(incident, "Accident reported");
  },

  async reportBreakdown(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { description } = parse(safetyReportSchema, request.body);
    const incident = await bookingJourneyService.reportSafetyIssue(
      request.authSession!.userId,
      bookingId,
      "VEHICLE_BREAKDOWN",
      description,
    );
    return success(incident, "Vehicle breakdown reported");
  },

  async getSosDetails(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const sos = await safetyService.getSosDetails(driver.id, sosId);
    return success(sos, "SOS details retrieved");
  },

  async listSos(request: FastifyRequest) {
    const query = parse(
      z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      request.query,
    );
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const result = await safetyService.listSos(
      driver.id,
      query.page,
      query.limit,
    );
    return success(result.items, "SOS history retrieved", {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / query.limit),
    });
  },

  async activeSos(request: FastifyRequest) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const sos = await safetyService.activeSos(driver.id);
    return success(sos, "Active SOS retrieved");
  },

  async getSosMessages(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const messages = await safetyService.getMessages(driver.id, sosId);
    return success(messages, "SOS messages retrieved");
  },

  async createSosMessage(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const input = parse(
      z.object({ message: z.string().trim().min(1).max(4000) }),
      request.body,
    );
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const message = await safetyService.createSosMessage(
      driver.id,
      sosId,
      input,
    );
    return success(message, "SOS message sent");
  },

  async markSosMessagesRead(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const result = await safetyService.markMessagesRead(driver.id, sosId);
    return success(result, "SOS messages marked as read");
  },

  async cancelSos(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    await safetyService.cancelSos(driver.id, sosId);
    return success(null, "SOS cancelled");
  },

  // --- ACCOUNT STATUS ---
  async getAccountRestrictions(request: FastifyRequest) {
    const restrictions = await accountService.getRestrictions(
      request.authSession!.userId,
    );
    return success(restrictions, "Account restrictions retrieved");
  },

  async requestDataExport(request: FastifyRequest) {
    const result = await accountService.requestDataExport(
      request.authSession!.userId,
    );
    return success(result, "Data export requested");
  },

  async requestAccountDeletion(request: FastifyRequest) {
    const result = await accountService.requestAccountDeletion(
      request.authSession!.userId,
    );
    return success(result, "Account deletion requested");
  },

  async deleteAccount(request: FastifyRequest, reply: FastifyReply) {
    const result = await accountService.requestAccountDeletion(
      request.authSession!.userId,
    );
    await authService.logoutAll(request.authSession!.userId);
    reply.clearCookie(env.COOKIE_NAME, {
      path: "/",
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
    return success(result, "Driver account deleted");
  },

  async getHeatmap(request: FastifyRequest) {
    const data = await surgeService.getHeatmap();
    return success(data);
  },

  async addCharges(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { tollCharge, parkingCharge } = request.body as {
      tollCharge?: number;
      parkingCharge?: number;
    };

    const driver = await getDriverId(request.authSession!.userId);

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, assignedDriverId: driver },
      include: {
        fareBreakdowns: { orderBy: { createdAt: "desc" }, take: 1 },
        trip: true,
      },
    });
    if (!booking) throw new Error("Booking not found");

    const latestFare = booking.fareBreakdowns[0];
    if (!latestFare) throw new Error("Fare breakdown not found");

    const additionalTotal = (tollCharge || 0) + (parkingCharge || 0);
    if (additionalTotal <= 0) throw new Error("Invalid charges amount");

    await prisma.$transaction(async (tx) => {
      // Update the fare breakdown
      await tx.fareBreakdown.update({
        where: { id: latestFare.id },
        data: {
          tollCharge: { increment: tollCharge || 0 },
          parkingCharge: { increment: parkingCharge || 0 },
          total: { increment: additionalTotal },
        },
      });

      // Update the booking estimated fare and total amount
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          estimatedFare: { increment: additionalTotal },
        },
      });

      // Update trip total if it exists
      if (booking.trip) {
        await tx.trip.update({
          where: { id: booking.trip.id },
          data: {
            tollCharges: { increment: tollCharge || 0 },
            parkingCharges: { increment: parkingCharge || 0 },
          },
        });
      }
    });

    const { emitBooking } = require("../../infrastructure/realtime");
    emitBooking(bookingId, "booking:fare_updated", {
      type: "EXTRA_CHARGES",
      tollCharge,
      parkingCharge,
      amount: additionalTotal,
    });

    return success(
      { bookingId, tollCharge, parkingCharge, additionalTotal },
      "Charges added successfully",
    );
  },
};
