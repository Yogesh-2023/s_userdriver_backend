import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { CustomerActionContext } from "../customer.constants";
import {
  createProfileImageUpload,
  uploadCustomerProfileImage,
} from "../../../integrations/storage";

type CustomerGender = "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";

type CustomerProfileInput = {
  fullName: string;
  email: string;
  gender?: CustomerGender;
  preferredLanguage?: string;
};

type CustomerProfileImage = {
  buffer: Buffer;
  contentType: string;
};

export class CustomerProfileService {
  async createProfile(
    userId: string,
    data: CustomerProfileInput,
    image: CustomerProfileImage | undefined,
    context: CustomerActionContext,
  ) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { displayName: true, email: true },
        },
      },
    });
    if (!profile) throw errors.notFound("Customer profile not found");
    if (profile.user.displayName && profile.user.email) {
      throw errors.conflict("Customer profile is already created");
    }

    const uploadedImage = image
      ? await uploadCustomerProfileImage(
          profile.id,
          image.contentType,
          image.buffer,
        )
      : undefined;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          displayName: data.fullName,
          email: data.email,
        },
      });

      await tx.customerProfile.update({
        where: { id: profile.id },
        data: {
          ...(data.gender !== undefined ? { gender: data.gender } : {}),
          ...(uploadedImage
            ? { profileImageUrl: uploadedImage.profileImageUrl }
            : {}),
        },
      });

      await tx.customerPreference.upsert({
        where: { customerId: profile.id },
        create: {
          customerId: profile.id,
          preferredLanguage: data.preferredLanguage ?? "en",
        },
        update: {
          preferredLanguage: data.preferredLanguage ?? "en",
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorRole: "CUSTOMER",
          action: "CUSTOMER_PROFILE_CREATED",
          entityType: "CustomerProfile",
          entityId: profile.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
    });

    return this.getProfile(userId);
  }

  async updateProfile(
    userId: string,
    data: {
      fullName?: string;
      email?: string | null;
      gender?: CustomerGender | null;
      preferredLanguage?: string;
    },
    context: CustomerActionContext,
  ) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw errors.notFound("Customer profile not found");

    await prisma.$transaction(async (tx) => {
      // Update User table for global fields
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

      // Update CustomerProfile table
      if (data.gender !== undefined) {
        await tx.customerProfile.update({
          where: { userId },
          data: {
            ...(data.gender !== undefined ? { gender: data.gender } : {}),
          },
        });
      }

      if (data.preferredLanguage !== undefined) {
        await tx.customerPreference.upsert({
          where: { customerId: profile.id },
          create: {
            customerId: profile.id,
            preferredLanguage: data.preferredLanguage,
          },
          update: { preferredLanguage: data.preferredLanguage },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorRole: "CUSTOMER",
          action: "CUSTOMER_PROFILE_UPDATED",
          entityType: "CustomerProfile",
          entityId: profile.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
    });

    return this.getProfile(userId);
  }

  async getProfile(userId: string) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { displayName: true, email: true, phone: true, status: true },
        },
        preferences: true,
      },
    });
    if (!profile) throw errors.notFound("Customer profile not found");

    return {
      id: profile.id,
      fullName: profile.user.displayName,
      phoneNumber: profile.user.phone,
      email: profile.user.email,
      profileImage: profile.profileImageUrl,
      gender: profile.gender,
      preferredLanguage: profile.preferences?.preferredLanguage ?? null,
      isProfileCompleted: Boolean(
        profile.user.displayName && profile.user.email,
      ),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  async updatePreferences(
    userId: string,
    data: any,
    context: CustomerActionContext,
  ) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw errors.notFound("Customer profile not found");

    const preferences = await prisma.customerPreference.upsert({
      where: { customerId: profile.id },
      create: { customerId: profile.id, ...data },
      update: { ...data },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: profile.userId,
        actorRole: "CUSTOMER",
        action: "CUSTOMER_PREFERENCES_UPDATED",
        entityType: "CustomerPreference",
        entityId: preferences.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    return preferences;
  }

  async uploadProfileImage(
    userId: string,
    contentType: string,
    buffer: Buffer,
  ) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw errors.notFound("Customer profile not found");

    const result = await uploadCustomerProfileImage(
      profile.id,
      contentType,
      buffer,
    );

    await prisma.customerProfile.update({
      where: { id: profile.id },
      data: { profileImageUrl: result.profileImageUrl },
    });

    return {
      profileImageUrl: result.profileImageUrl,
    };
  }

  async deleteProfileImage(userId: string) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw errors.notFound("Customer profile not found");

    await prisma.customerProfile.update({
      where: { id: profile.id },
      data: { profileImageUrl: null },
    });

    return { success: true };
  }

  async getOnboardingStatus(userId: string) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { displayName: true, email: true } },
      },
    });
    if (!profile) throw errors.notFound("Customer profile not found");

    const hasName = Boolean(
      profile.user.displayName && profile.user.displayName.trim().length > 0,
    );
    const hasEmail = Boolean(
      profile.user.email && profile.user.email.trim().length > 0,
    );
    const isComplete = hasName && hasEmail;

    return {
      isComplete,
      steps: {
        hasName,
        hasEmail,
      },
    };
  }
}
