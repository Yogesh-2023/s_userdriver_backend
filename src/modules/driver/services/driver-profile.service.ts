import { activeSubscriptionWhere } from "./subscription-state";
import { prisma } from "../../../database/prisma";
import { externalKycStatus } from "../driver-status";
import { errors, AppError } from "../../../common/errors";
import { DriverActionContext } from "../driver.constants";
import { env } from "../../../config/env";

type CreateProfileInput = {
  fullName: string;
  email?: string | null;
  dateOfBirth?: Date | null;
  gender: "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";
  profileImageUrl?: string | null;
  currentNumber?: string | null;
  alternateNumber?: string | null;

  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;

  drivingLicenseNumber?: string | null;
  drivingLicenseIssueDate?: Date | null;
  drivingLicenseExpiryDate?: Date | null;
  drivingExperienceYears?: number | null;

  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?:
    "PARENT" | "SPOUSE" | "SIBLING" | "FRIEND" | "RELATIVE" | "OTHER" | null;

  preferredLanguage?: string | null;
  navigationPreference?: "GOOGLE_MAPS" | "APPLE_MAPS" | "IN_APP" | null;
  serviceAreaId?: string | null;
};

type UpdateProfileInput = Partial<CreateProfileInput>;

export type DriverLoginProfile = {
  fullName: string | null;
  phoneNumber: string;
  email: string | null;
  profileImage: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  preferredLanguage: string | null;
  address: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

const hasCompletedProfile = (data: {
  fullName?: string | null;
  dateOfBirth?: Date | null;
  profileImageUrl?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}) =>
  Boolean(
    data.fullName?.trim() &&
    data.dateOfBirth &&
    data.profileImageUrl &&
    data.addressLine1?.trim() &&
    data.city?.trim() &&
    data.state?.trim() &&
    data.postalCode?.trim() &&
    data.country?.trim(),
  );

export class DriverProfileService {
  async getProfile(userId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { displayName: true, phone: true, email: true, status: true },
        },
      },
    });
    if (!profile)
      throw new AppError(
        404,
        "DRIVER_PROFILE_NOT_FOUND",
        "Driver profile not found",
      );
    return profile;
  }

  async getAccountInfo(userId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            displayName: true,
            phone: true,
            email: true,
            phoneVerifiedAt: true,
            status: true,
          },
        },
        documents: { orderBy: { type: "asc" } },
        kycSubmissions: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: {
            status: true,
            notes: true,
            submittedAt: true,
            reviewedAt: true,
            reviewedByAdminId: true,
          },
        },
        payoutAccounts: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!profile)
      throw new AppError(
        404,
        "DRIVER_PROFILE_NOT_FOUND",
        "Driver profile not found",
      );

    const formatDate = (value: Date | null | undefined) =>
      value ? value.toISOString().split("T")[0] : null;

    const maskNumber = (value: string | null | undefined) =>
      value
        ? `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`
        : null;

    const findDocument = (type: string) =>
      profile.documents.find((document) => document.type === type) ?? null;

    const getDocImageUrl = (fileKey?: string | null) => {
      if (!fileKey) return null;
      const baseUrl =
        env.NODE_ENV === "production"
          ? "https://tuk.technogigz.co.in"
          : `http://localhost:${env.PORT}`;
      return env.AWS_S3_BUCKET
        ? `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`
        : `${baseUrl}/images/${fileKey}`;
    };

    const hasExpiredDocuments = profile.documents.some(
      (document) =>
        document.status === "EXPIRED" ||
        (document.expiresAt && document.expiresAt <= new Date()),
    );

    const aadhaar = findDocument("AADHAR_FRONT") ?? findDocument("AADHAR_BACK");
    const pan = findDocument("PAN_CARD");
    const licenseFront = findDocument("DL_FRONT");
    const licenseBack = findDocument("DL_BACK");
    const licenseDocument = licenseFront ?? licenseBack;
    const bankAccount = profile.payoutAccounts[0] ?? null;

    return {
      personalInfo: {
        fullName: profile.user.displayName,
        email: profile.user.email,
        phone: profile.user.phone,
        phoneVerified: Boolean(profile.user.phoneVerifiedAt),
        accountStatus: profile.user.status,
        gender: profile.gender,
        dateOfBirth: formatDate(profile.dateOfBirth),
        alternatePhone: profile.alternatePhone,
        profileImageUrl: profile.profileImageUrl,
        address: {
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          landmark: profile.landmark,
          city: profile.city,
          state: profile.state,
          postalCode: profile.postalCode,
          country: profile.country,
        },
      },
      kyc: {
        status: externalKycStatus(
          profile.verificationStatus,
          profile.onboardingStatus,
          hasExpiredDocuments,
        ),
        onboardingStatus: profile.onboardingStatus,
        verifiedAt: formatDate(profile.verifiedAt),
        submission: profile.kycSubmissions[0]
          ? {
              status: externalKycStatus(
                profile.kycSubmissions[0].status,
                profile.onboardingStatus,
                hasExpiredDocuments,
              ),
              submittedAt: profile.kycSubmissions[0].submittedAt,
              reviewedAt: profile.kycSubmissions[0].reviewedAt,
            }
          : null,
        aadhaar: {
          documentNo: maskNumber(aadhaar?.documentNo),
          status: aadhaar?.status ?? "NOT_SUBMITTED",
          expiresAt: aadhaar?.expiresAt ?? null,
          imageUrl: getDocImageUrl(findDocument("AADHAR_FRONT")?.fileKey),
          frontImageUrl: getDocImageUrl(findDocument("AADHAR_FRONT")?.fileKey),
          backImageUrl: getDocImageUrl(findDocument("AADHAR_BACK")?.fileKey),
        },
        pan: {
          documentNo: maskNumber(pan?.documentNo),
          status: pan?.status ?? "NOT_SUBMITTED",
          imageUrl: getDocImageUrl(pan?.fileKey),
        },
      },
      drivingLicense: {
        licenseNumber: profile.licenseNumber,
        issueDate: formatDate(profile.drivingLicenseIssueDate),
        expiryDate: formatDate(profile.drivingLicenseExpiryDate),
        experienceYears: profile.drivingExperienceYears,
        frontDocument: licenseFront
          ? {
              status: licenseFront.status,
              expiresAt: licenseFront.expiresAt ?? null,
              verifiedAt: licenseFront.verifiedAt ?? null,
              imageUrl: getDocImageUrl(licenseFront.fileKey),
            }
          : null,
        backDocument: licenseBack
          ? {
              status: licenseBack.status,
              expiresAt: licenseBack.expiresAt ?? null,
              verifiedAt: licenseBack.verifiedAt ?? null,
              imageUrl: getDocImageUrl(licenseBack.fileKey),
            }
          : null,
        status: licenseDocument?.status ?? "NOT_SUBMITTED",
      },
      bankAccount: bankAccount
        ? {
            accountId: bankAccount.id,
            accountName: bankAccount.accountName,
            accountNumber: maskNumber(bankAccount.accountNumber),
            bankName: bankAccount.bankName,
            ifscCode: bankAccount.bankCode,
            isDefault: bankAccount.isDefault,
            status: bankAccount.status,
          }
        : null,
    };
  }

  async getLoginProfile(userId: string): Promise<{
    profile: DriverLoginProfile;
    isProfileCompleted: boolean;
  } | null> {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        dateOfBirth: true,
        gender: true,
        profileImageUrl: true,
        preferredLanguage: true,
        addressLine1: true,
        addressLine2: true,
        landmark: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            displayName: true,
            phone: true,
            email: true,
          },
        },
      },
    });

    if (!profile) return null;

    const decimalToNumber = (
      value: { toNumber(): number } | number | null,
    ): number | null => {
      if (value === null) return null;
      return typeof value === "number" ? value : value.toNumber();
    };

    return {
      isProfileCompleted: hasCompletedProfile({
        fullName: profile.user.displayName,
        dateOfBirth: profile.dateOfBirth,
        profileImageUrl: profile.profileImageUrl,
        addressLine1: profile.addressLine1,
        city: profile.city,
        state: profile.state,
        postalCode: profile.postalCode,
        country: profile.country,
      }),
      profile: {
        fullName: profile.user.displayName,
        phoneNumber: profile.user.phone,
        email: profile.user.email,
        profileImage: profile.profileImageUrl,
        gender: profile.gender,
        dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        preferredLanguage: profile.preferredLanguage,
        address: {
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          city: profile.city,
          state: profile.state,
          postalCode: profile.postalCode,
          country: profile.country,
        },
        createdAt: profile.createdAt.toISOString().slice(0, 10),
        updatedAt: profile.updatedAt.toISOString().slice(0, 10),
      },
    };
  }

  async createProfile(
    userId: string,
    data: CreateProfileInput,
    context: DriverActionContext,
  ) {
    if (data.dateOfBirth) {
      this.assertMinimumAge(data.dateOfBirth);
    }
    this.assertLicenseDates(
      data.drivingLicenseIssueDate,
      data.drivingLicenseExpiryDate,
    );
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true },
    });

    if (!user)
      throw new AppError(404, "DRIVER_NOT_FOUND", "Driver account not found");
    if (user.status !== "ACTIVE")
      throw new AppError(
        403,
        "DRIVER_ACCOUNT_BLOCKED",
        "Driver account is not active",
      );
    // OTP verification intentionally creates a minimal DriverProfile so the
    // session always has a stable driver identity. Completing that shell is
    // an update, not a duplicate profile creation.
    if (user.driverProfile) {
      if (
        !["ACCOUNT_CREATED", "PROFILE_PENDING"].includes(
          user.driverProfile.onboardingStatus,
        )
      ) {
        throw new AppError(
          409,
          "DRIVER_PROFILE_ALREADY_EXISTS",
          "Driver profile already exists",
        );
      }
      return this.updateProfile(userId, data, context);
    }

    if (user.phone === data.emergencyContactPhone) {
      throw new AppError(
        400,
        "EMERGENCY_CONTACT_SAME_AS_DRIVER",
        "Emergency contact cannot be the same as driver's mobile number",
      );
    }

    if (data.email) {
      const existingEmail = await prisma.user.findFirst({
        where: { email: data.email, id: { not: userId } },
      });
      if (existingEmail)
        throw new AppError(
          409,
          "DRIVER_EMAIL_ALREADY_EXISTS",
          "Email is already in use by another account",
        );
    }

    if (data.drivingLicenseNumber) {
      const existingLicense = await prisma.driverProfile.findUnique({
        where: { licenseNumber: data.drivingLicenseNumber },
      });
      if (existingLicense && existingLicense.userId !== userId)
        throw new AppError(
          409,
          "DRIVING_LICENSE_ALREADY_EXISTS",
          "Driving license is already registered",
        );
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          displayName: data.fullName,
          ...(data.email ? { email: data.email } : {}),
        },
      });

      const profileCompleted = hasCompletedProfile(data);
      const newProfile = await tx.driverProfile.create({
        data: {
          userId,
          licenseNumber: data.drivingLicenseNumber,
          dateOfBirth: data.dateOfBirth,
          gender: data.gender,
          profileImageUrl: data.profileImageUrl,
          alternatePhone: data.alternateNumber,

          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          landmark: data.landmark,
          city: data.city,
          state: data.state,
          postalCode: data.postalCode,
          country: data.country,
          latitude: data.latitude,
          longitude: data.longitude,

          drivingLicenseIssueDate: data.drivingLicenseIssueDate,
          drivingLicenseExpiryDate: data.drivingLicenseExpiryDate,
          drivingExperienceYears: data.drivingExperienceYears,

          emergencyContactName: data.emergencyContactName,
          emergencyContactPhone: data.emergencyContactPhone,
          emergencyContactRelation: data.emergencyContactRelation,

          preferredLanguage: data.preferredLanguage,
          navigationPreference: data.navigationPreference,
          serviceAreaId: data.serviceAreaId,

          onboardingStatus: profileCompleted
            ? "PROFILE_COMPLETED"
            : "PROFILE_PENDING",
          verificationStatus: "PENDING",
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorRole: "DRIVER",
          action: "DRIVER_PROFILE_CREATED",
          entityType: "DriverProfile",
          entityId: newProfile.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });

      return newProfile;
    });

    return this.getProfile(userId);
  }

  async updateProfile(
    userId: string,
    data: UpdateProfileInput,
    context: DriverActionContext,
  ) {
    if (data.dateOfBirth) this.assertMinimumAge(data.dateOfBirth);
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!profile)
      throw new AppError(
        404,
        "DRIVER_PROFILE_NOT_FOUND",
        "Driver profile not found",
      );
    if (profile.user.status !== "ACTIVE")
      throw errors.forbidden("Driver account is not active");
    this.assertLicenseDates(
      data.drivingLicenseIssueDate ?? profile.drivingLicenseIssueDate,
      data.drivingLicenseExpiryDate ?? profile.drivingLicenseExpiryDate,
    );

    if (data.email) {
      const existingEmail = await prisma.user.findFirst({
        where: { email: data.email, id: { not: userId } },
      });
      if (existingEmail)
        throw new AppError(
          409,
          "DRIVER_EMAIL_ALREADY_EXISTS",
          "Email is already in use by another account",
        );
    }

    if (
      data.emergencyContactPhone &&
      data.emergencyContactPhone === profile.user.phone
    ) {
      throw new AppError(
        400,
        "EMERGENCY_CONTACT_SAME_AS_DRIVER",
        "Emergency contact cannot be the same as driver's mobile number",
      );
    }

    if (data.drivingLicenseNumber) {
      const existingLicense = await prisma.driverProfile.findFirst({
        where: {
          licenseNumber: data.drivingLicenseNumber,
          userId: { not: userId },
        },
      });
      if (existingLicense)
        throw new AppError(
          409,
          "DRIVING_LICENSE_ALREADY_EXISTS",
          "Driving license is already registered",
        );
    }

    const requiresReverification = !!(
      data.fullName ||
      data.dateOfBirth ||
      data.drivingLicenseNumber ||
      data.drivingLicenseIssueDate ||
      data.drivingLicenseExpiryDate ||
      data.profileImageUrl
    );
    const profileCompleted = hasCompletedProfile({
      fullName: data.fullName ?? profile.user.displayName,
      dateOfBirth: data.dateOfBirth ?? profile.dateOfBirth,
      profileImageUrl:
        data.profileImageUrl === undefined || data.profileImageUrl === null
          ? profile.profileImageUrl
          : data.profileImageUrl,
      addressLine1: data.addressLine1 ?? profile.addressLine1,
      city: data.city ?? profile.city,
      state: data.state ?? profile.state,
      postalCode: data.postalCode ?? profile.postalCode,
      country: data.country ?? profile.country,
    });

    await prisma.$transaction(async (tx) => {
      if (data.fullName !== undefined || data.email !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(data.fullName !== undefined
              ? { displayName: data.fullName }
              : {}),
            ...(data.email !== undefined ? { email: data.email } : {}),
          },
        });
      }

      await tx.driverProfile.update({
        where: { userId },
        data: {
          ...(data.drivingLicenseNumber !== undefined
            ? { licenseNumber: data.drivingLicenseNumber }
            : {}),
          ...(data.dateOfBirth !== undefined
            ? { dateOfBirth: data.dateOfBirth }
            : {}),
          ...(data.gender !== undefined ? { gender: data.gender } : {}),
          ...(data.profileImageUrl !== undefined &&
          data.profileImageUrl !== null
            ? { profileImageUrl: data.profileImageUrl }
            : {}),
          ...(data.alternateNumber !== undefined
            ? { alternatePhone: data.alternateNumber }
            : {}),

          ...(data.addressLine1 !== undefined
            ? { addressLine1: data.addressLine1 }
            : {}),
          ...(data.addressLine2 !== undefined
            ? { addressLine2: data.addressLine2 }
            : {}),
          ...(data.landmark !== undefined ? { landmark: data.landmark } : {}),
          ...(data.city !== undefined ? { city: data.city } : {}),
          ...(data.state !== undefined ? { state: data.state } : {}),
          ...(data.postalCode !== undefined
            ? { postalCode: data.postalCode }
            : {}),
          ...(data.country !== undefined ? { country: data.country } : {}),
          ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
          ...(data.longitude !== undefined
            ? { longitude: data.longitude }
            : {}),

          ...(data.drivingLicenseIssueDate !== undefined
            ? { drivingLicenseIssueDate: data.drivingLicenseIssueDate }
            : {}),
          ...(data.drivingLicenseExpiryDate !== undefined
            ? { drivingLicenseExpiryDate: data.drivingLicenseExpiryDate }
            : {}),
          ...(data.drivingExperienceYears !== undefined
            ? { drivingExperienceYears: data.drivingExperienceYears }
            : {}),

          ...(data.emergencyContactName !== undefined
            ? { emergencyContactName: data.emergencyContactName }
            : {}),
          ...(data.emergencyContactPhone !== undefined
            ? { emergencyContactPhone: data.emergencyContactPhone }
            : {}),
          ...(data.emergencyContactRelation !== undefined
            ? { emergencyContactRelation: data.emergencyContactRelation }
            : {}),

          ...(data.preferredLanguage !== undefined
            ? { preferredLanguage: data.preferredLanguage }
            : {}),
          ...(data.navigationPreference !== undefined
            ? { navigationPreference: data.navigationPreference }
            : {}),
          ...(data.serviceAreaId !== undefined
            ? { serviceAreaId: data.serviceAreaId }
            : {}),
          onboardingStatus: profileCompleted
            ? "PROFILE_COMPLETED"
            : "PROFILE_PENDING",

          ...(requiresReverification
            ? { verificationStatus: "PENDING", verifiedAt: null }
            : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorRole: "DRIVER",
          action: "DRIVER_PROFILE_UPDATED",
          entityType: "DriverProfile",
          entityId: profile.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { requiresReverification },
        },
      });
    });

    return this.getProfile(userId);
  }

  async getOnboardingStatus(userId: string) {
    const now = new Date();
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { displayName: true, status: true } },
        documents: {
          select: { type: true, status: true, expiresAt: true },
        },
        kycSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 },
        vehicles: { select: { id: true, verificationStatus: true } },
        vehicleAssignments: {
          where: { isActive: true, endedAt: null },
          orderBy: { assignedAt: "desc" },
          take: 1,
          include: { vehicle: { include: { documents: true } } },
        },
        currentBookings: {
          where: {
            status: {
              in: [
                "DRIVER_ASSIGNED",
                "DRIVER_ARRIVING",
                "DRIVER_ARRIVED",
                "TRIP_STARTED",
              ],
            },
          },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });

    if (!profile)
      return {
        onboardingStatus: "ACCOUNT_CREATED",
        verificationStatus: "PENDING",
        kycStatus: "NOT_SUBMITTED",
        isProfileCompleted: false,
        hasAssignedVehicle: false,
        vehicleApproved: false,
        documentsValid: false,
        accountStatus: "ACTIVE",
        canGoOnline: false,
        hasActiveSubscription: false,
        nextStep: "COMPLETE_PROFILE",
        vehiclesRegistered: 0,
        vehiclesApproved: 0,
      };

    const assignedVehicle = profile.vehicleAssignments[0]?.vehicle ?? null;
    const validDocument = (document: {
      status: string;
      expiresAt: Date | null;
    }) =>
      document.status === "VERIFIED" &&
      (!document.expiresAt || document.expiresAt > now);
    const requiredDriverDocuments = [
      "DL_FRONT",
      "DL_BACK",
      "AADHAR_FRONT",
      "AADHAR_BACK",
      "PAN_CARD",
      "PROFILE_PHOTO",
    ];
    const requiredVehicleDocuments = ["REGISTRATION_CERTIFICATE", "INSURANCE"];
    const driverDocumentsValid = requiredDriverDocuments.every((type) =>
      profile.documents.some(
        (document) => document.type === type && validDocument(document),
      ),
    );
    const vehicleDocumentsValid = Boolean(
      assignedVehicle &&
      requiredVehicleDocuments.every((type) =>
        assignedVehicle.documents.some(
          (document) => document.type === type && validDocument(document),
        ),
      ),
    );
    const documentsValid = driverDocumentsValid && vehicleDocumentsValid;
    const isProfileCompleted = hasCompletedProfile({
      fullName: profile.user.displayName,
      dateOfBirth: profile.dateOfBirth,
      profileImageUrl: profile.profileImageUrl,
      addressLine1: profile.addressLine1,
      city: profile.city,
      state: profile.state,
      postalCode: profile.postalCode,
      country: profile.country,
    });
    const hasAssignedVehicle = Boolean(assignedVehicle);
    const vehicleApproved =
      assignedVehicle?.status === "ACTIVE" &&
      assignedVehicle.verificationStatus === "APPROVED";
    const internalKycStatus =
      profile.kycSubmissions[0]?.status ?? "NOT_SUBMITTED";
    const kycStatus = externalKycStatus(
      internalKycStatus,
      profile.onboardingStatus,
      [...profile.documents, ...(assignedVehicle?.documents ?? [])].some(
        (document) =>
          document.status === "EXPIRED" ||
          (document.expiresAt && document.expiresAt <= now),
      ),
    );
    const hasActiveSubscription = Boolean(
      await prisma.driverSubscription.findFirst({
        where: activeSubscriptionWhere(profile.id),
        select: { id: true },
      }),
    );
    const hasActiveBooking = profile.currentBookings.length > 0;
    const canGoOnline =
      profile.user.status === "ACTIVE" &&
      isProfileCompleted &&
      profile.verificationStatus === "VERIFIED" &&
      hasAssignedVehicle &&
      vehicleApproved &&
      documentsValid &&
      hasActiveSubscription &&
      !hasActiveBooking;

    let nextStep = "DASHBOARD";
    if (hasActiveBooking) nextStep = "ACTIVE_TRIP";
    else if (profile.user.status !== "ACTIVE") nextStep = "ACCOUNT_SUSPENDED";
    else if (!isProfileCompleted) nextStep = "COMPLETE_PROFILE";
    else if (internalKycStatus === "NOT_SUBMITTED") nextStep = "SUBMIT_KYC";
    else if (kycStatus === "PENDING") nextStep = "KYC_PENDING";
    else if (kycStatus === "UNDER_REVIEW") nextStep = "KYC_UNDER_REVIEW";
    else if (kycStatus === "REJECTED" || kycStatus === "EXPIRED")
      nextStep = "REUPLOAD_KYC";
    else if (!hasAssignedVehicle || !vehicleApproved)
      nextStep = "WAIT_FOR_VEHICLE";
    else if (!documentsValid) nextStep = "RENEW_DOCUMENTS";
    else if (!hasActiveSubscription) nextStep = "BUY_SUBSCRIPTION";

    return {
      onboardingStatus: profile.onboardingStatus,
      verificationStatus: externalKycStatus(
        profile.verificationStatus,
        profile.onboardingStatus,
      ),
      kycStatus,
      isProfileCompleted,
      hasAssignedVehicle,
      vehicleApproved,
      documentsValid,
      accountStatus: profile.user.status,
      canGoOnline,
      hasActiveSubscription,
      hasActiveBooking,
      activeBooking: profile.currentBookings[0] ?? null,
      nextStep,
      vehiclesRegistered: profile.vehicles.length,
      vehiclesApproved: profile.vehicles.filter(
        (v) => v.verificationStatus === "APPROVED",
      ).length,
    };
  }

  async getAccountStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true },
    });
    if (!user) throw errors.notFound("Driver account not found");
    if (!user.driverProfile)
      return {
        userStatus: user.status,
        verificationStatus: "PENDING",
        availability: "OFFLINE",
      };

    return {
      userStatus: user.status,
      verificationStatus: user.driverProfile.verificationStatus,
      availability: user.driverProfile.availability,
    };
  }

  private assertMinimumAge(dateOfBirth: Date) {
    const minimumDate = new Date();
    minimumDate.setHours(0, 0, 0, 0);
    minimumDate.setFullYear(minimumDate.getFullYear() - 18);
    if (dateOfBirth > minimumDate) {
      throw errors.badRequest("Driver must be at least 18 years old");
    }
  }

  private assertLicenseDates(
    issueDate: Date | null | undefined,
    expiryDate: Date | null | undefined,
  ) {
    if (issueDate && issueDate > new Date()) {
      throw errors.badRequest("Issue date cannot be in the future");
    }
    if (expiryDate && expiryDate <= new Date()) {
      throw errors.badRequest("License is expired");
    }
    if (issueDate && expiryDate && issueDate >= expiryDate) {
      throw errors.badRequest("Issue date must be before expiry date");
    }
  }
}
