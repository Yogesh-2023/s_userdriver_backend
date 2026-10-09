import { randomUUID } from "node:crypto";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import {
  createDocumentUpload,
  uploadDriverDocument,
} from "../../../integrations/storage";
import { redis } from "../../../infrastructure/redis";
import { externalKycStatus } from "../driver-status";
import { env } from "../../../config/env";

export class DriverKycService {
  async getKycStatus(userId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        kycSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 },
        documents: {
          select: { status: true, expiresAt: true },
        },
      },
    });
    if (!profile) throw errors.notFound("Driver profile not found");
    const submission = profile.kycSubmissions[0];
    return submission
      ? {
          ...submission,
          status: externalKycStatus(
            submission.status,
            profile.onboardingStatus,
            profile.documents.some(
              (document) =>
                document.status === "EXPIRED" ||
                (document.expiresAt && document.expiresAt <= new Date()),
            ),
          ),
        }
      : {
          status: "NOT_SUBMITTED",
          submittedAt: null,
          reviewedAt: null,
        };
  }

  async getDocuments(userId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { documents: true },
    });
    if (!profile) throw errors.notFound("Driver profile not found");

    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;

    return profile.documents.map((doc) => {
      const { fileKey, ...rest } = doc;
      return {
        ...rest,
        imageUrl: env.AWS_S3_BUCKET
          ? `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`
          : `${baseUrl}/images/${fileKey}`,
      };
    });
  }

  async getDocument(userId: string, documentId: string) {
    const document = await prisma.driverDocument.findFirst({
      where: { id: documentId, driver: { userId } },
    });
    if (!document) throw errors.notFound("Document not found");

    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;

    const { fileKey, ...rest } = document;
    return {
      ...rest,
      imageUrl: env.AWS_S3_BUCKET
        ? `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`
        : `${baseUrl}/images/${fileKey}`,
    };
  }

  async getKycDetails(userId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        verificationStatus: true,
        onboardingStatus: true,
        documents: {
          orderBy: { type: "asc" },
          select: {
            id: true,
            type: true,
            documentNo: true,
            status: true,
            expiresAt: true,
            verifiedAt: true,
            createdAt: true,
            updatedAt: true,
            fileKey: true,
          },
        },
        kycSubmissions: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          include: { history: { orderBy: { createdAt: "asc" } } },
        },
      },
    });
    if (!profile) throw errors.notFound("Driver profile not found");
    return {
      driverId: profile.id,
      verificationStatus: externalKycStatus(
        profile.verificationStatus,
        profile.onboardingStatus,
        profile.documents.some(
          (document) =>
            document.status === "EXPIRED" ||
            (document.expiresAt && document.expiresAt <= new Date()),
        ),
      ),
      onboardingStatus: profile.onboardingStatus,
      submission: profile.kycSubmissions[0]
        ? {
            ...profile.kycSubmissions[0],
            status: externalKycStatus(
              profile.kycSubmissions[0].status,
              profile.onboardingStatus,
              profile.documents.some(
                (document) =>
                  document.status === "EXPIRED" ||
                  (document.expiresAt && document.expiresAt <= new Date()),
              ),
            ),
          }
        : null,
      documents: profile.documents.map((document) => {
        const { fileKey, ...rest } = document;
        const baseUrl =
          env.NODE_ENV === "production"
            ? "https://tuk.technogigz.co.in"
            : `http://localhost:${env.PORT}`;
        return {
          ...rest,
          documentNo: this.maskDocumentNumber(rest.documentNo),
          imageUrl: env.AWS_S3_BUCKET
            ? `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`
            : `${baseUrl}/images/${fileKey}`,
        };
      }),
    };
  }

  async uploadKycDocuments(
    userId: string,
    documents: Array<{
      type: string;
      contentType: string;
      file: Buffer;
    }>,
  ) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { displayName: true } },
      },
    });
    if (!driver) throw errors.notFound("Driver profile not found");

    const uploads = await Promise.all(
      documents.map(async (document) => ({
        document,
        upload: await uploadDriverDocument(
          driver.id,
          document.contentType,
          document.file,
        ),
      })),
    );

    const savedDocuments = await prisma.$transaction(async (tx) => {
      const saved = [];
      for (const { document, upload } of uploads) {
        saved.push(
          await tx.driverDocument.upsert({
            where: {
              driverId_type: {
                driverId: driver.id,
                type: document.type,
              },
            },
            update: {
              fileKey: upload.key,
              status: "PENDING",
            },
            create: {
              driverId: driver.id,
              type: document.type,
              fileKey: upload.key,
              status: "PENDING",
            },
            select: {
              id: true,
              type: true,
              status: true,
            },
          }),
        );
      }

      await tx.driverProfile.update({
        where: { id: driver.id },
        data: {
          verificationStatus: "PENDING",
          onboardingStatus: "KYC_PENDING",
        },
      });

      return saved;
    });

    return {
      uploadedDocuments: savedDocuments,
      urls: uploads.reduce(
        (acc, curr) => {
          acc[curr.document.type] = curr.upload.uploadUrl;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };
  }

  async createDocumentUploadUrl(
    userId: string,
    documents: Array<{
      type: string;
      documentNo?: string;
      contentType: string;
      file: Buffer;
    }>,
    bankDetails?: {
      accountNumber: string;
      ifscCode: string;
    },
  ) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { displayName: true } },
        kycSubmissions: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    if (driver.kycSubmissions[0]) {
      throw errors.conflict(
        "Submitted KYC documents are locked; use the reupload endpoint for rejected or expired documents",
      );
    }

    const uploads = await Promise.all(
      documents.map(async (document) => ({
        document,
        upload: await uploadDriverDocument(
          driver.id,
          document.contentType,
          document.file,
        ),
      })),
    );

    const savedDocuments = await prisma.$transaction(async (tx) => {
      const saved = [];
      for (const { document, upload } of uploads) {
        saved.push(
          await tx.driverDocument.upsert({
            where: {
              driverId_type: {
                driverId: driver.id,
                type: document.type,
              },
            },
            update: {
              fileKey: upload.key,
              documentNo: document.documentNo,
              status: "PENDING",
            },
            create: {
              driverId: driver.id,
              type: document.type,
              documentNo: document.documentNo,
              fileKey: upload.key,
            },
            select: {
              id: true,
              type: true,
              status: true,
            },
          }),
        );
      }

      if (bankDetails) {
        const existingAccount = await tx.driverPayoutAccount.findFirst({
          where: {
            driverId: driver.id,
            accountNumber: bankDetails.accountNumber,
            bankCode: bankDetails.ifscCode,
          },
        });
        const accountData = {
          accountName: driver.user.displayName?.trim() || "Driver",
          accountNumber: bankDetails.accountNumber,
          bankCode: bankDetails.ifscCode,
          bankName: bankDetails.ifscCode.slice(0, 4),
          status: "PENDING",
        };
        if (existingAccount) {
          await tx.driverPayoutAccount.update({
            where: { id: existingAccount.id },
            data: accountData,
          });
        } else {
          const existingAccountCount = await tx.driverPayoutAccount.count({
            where: { driverId: driver.id },
          });
          await tx.driverPayoutAccount.create({
            data: {
              driverId: driver.id,
              ...accountData,
              isDefault: existingAccountCount === 0,
            },
          });
        }
      }

      return saved;
    });

    return {
      documents: savedDocuments.map((document, index) => ({
        documentId: document.id,
        documentType: document.type,
        documentUrl: uploads[index]!.upload.uploadUrl,
        status: document.status,
      })),
      bankDetailsSubmitted: Boolean(bankDetails),
    };
  }

  async uploadDocumentDraft(
    userId: string,
    type: string,
    documentNo: string | undefined,
    filename: string,
  ) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        kycSubmissions: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    if (driver.kycSubmissions[0]) {
      throw errors.conflict(
        "Submitted KYC documents are locked; use the reupload endpoint for rejected or expired documents",
      );
    }

    await prisma.driverDocument.upsert({
      where: { driverId_type: { driverId: driver.id, type } },
      update: { fileKey: filename, status: "PENDING", documentNo },
      create: { driverId: driver.id, type, fileKey: filename, documentNo },
    });

    return { filename };
  }

  async submitKyc(userId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { documents: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");

    const requiredDocs = [
      "AADHAR_FRONT",
      "AADHAR_BACK",
      "PAN_CARD",
      "DL_FRONT",
      "DL_BACK",
      "RC",
    ];
    const uploadedDocs = driver.documents.map((d) => d.type);

    const missingDocs = requiredDocs.filter(
      (req) => !uploadedDocs.includes(req),
    );
    if (missingDocs.length > 0) {
      throw errors.badRequest(
        `Missing required documents: ${missingDocs.join(", ")}`,
      );
    }

    if (
      !["PROFILE_COMPLETED", "KYC_PENDING", "REJECTED"].includes(
        driver.onboardingStatus,
      )
    ) {
      throw errors.conflict("DRIVER_PROFILE_INCOMPLETE");
    }

    return this.withKycLock(driver.id, async () => {
      const activeSubmission = await prisma.driverKycSubmission.findFirst({
        where: {
          driverId: driver.id,
          status: { in: ["PENDING", "UNDER_REVIEW", "VERIFIED", "SUSPENDED"] },
        },
        orderBy: { submittedAt: "desc" },
        select: { id: true, status: true },
      });
      if (activeSubmission) {
        throw errors.conflict(
          activeSubmission.status === "VERIFIED"
            ? "DRIVER_KYC_ALREADY_APPROVED"
            : "DRIVER_KYC_ALREADY_SUBMITTED",
        );
      }

      return prisma.$transaction(async (tx) => {
        const created = await tx.driverKycSubmission.create({
          data: {
            driverId: driver.id,
            status: "UNDER_REVIEW",
            history: {
              create: {
                driverId: driver.id,
                status: "UNDER_REVIEW",
                createdBy: driver.id,
              },
            },
          },
        });
        await tx.driverProfile.update({
          where: { id: driver.id },
          data: {
            verificationStatus: "UNDER_REVIEW",
            onboardingStatus: "KYC_UNDER_REVIEW",
          },
        });
        return created;
      });
    });
  }

  async getExpiringDocuments(userId: string, withinDays = 30) {
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1_000);
    return prisma.driverDocument.findMany({
      where: {
        driver: { userId },
        expiresAt: { not: null, lte: cutoff },
      },
      select: {
        id: true,
        type: true,
        status: true,
        expiresAt: true,
        verifiedAt: true,
      },
      orderBy: { expiresAt: "asc" },
    });
  }

  async reuploadDocument(
    userId: string,
    documentId: string,
    contentType: string,
    sizeBytes: number,
  ) {
    const document = await prisma.driverDocument.findFirst({
      where: { id: documentId, driver: { userId } },
      include: { driver: true },
    });
    if (!document) throw errors.notFound("Document not found");
    if (!["REJECTED", "EXPIRED"].includes(document.status)) {
      throw errors.conflict(
        "Only rejected or expired documents can be reuploaded",
      );
    }
    const pendingSubmission = await prisma.driverKycSubmission.findFirst({
      where: {
        driverId: document.driverId,
        status: { in: ["PENDING", "UNDER_REVIEW"] },
      },
      select: { id: true },
    });
    if (pendingSubmission) {
      throw errors.conflict("DRIVER_KYC_ALREADY_SUBMITTED");
    }

    const upload = await createDocumentUpload(
      "driver-documents",
      document.driverId,
      contentType,
      sizeBytes,
    );
    await prisma.$transaction(async (tx) => {
      await tx.documentStatusHistory.create({
        data: {
          documentType: document.type,
          driverDocumentId: document.id,
          fromStatus: document.status,
          toStatus: "PENDING",
          reason: "DRIVER_REUPLOAD",
        },
      });
      await tx.driverDocument.update({
        where: { id: document.id },
        data: {
          fileKey: upload.key,
          status: "PENDING",
          verifiedAt: null,
        },
      });
      const submission = await tx.driverKycSubmission.create({
        data: {
          driverId: document.driverId,
          status: "UNDER_REVIEW",
        },
      });
      await tx.driverKycStatusHistory.create({
        data: {
          submissionId: submission.id,
          driverId: document.driverId,
          status: "UNDER_REVIEW",
          notes: `${document.type} reuploaded`,
          createdBy: document.driverId,
        },
      });
      await tx.driverProfile.update({
        where: { id: document.driverId },
        data: {
          verificationStatus: "UNDER_REVIEW",
          onboardingStatus: "KYC_UNDER_REVIEW",
        },
      });
    });
    return {
      documentId: document.id,
      documentType: document.type,
      status: "PENDING",
      upload,
    };
  }

  private maskDocumentNumber(value: string | null) {
    if (!value) return null;
    const visible = value.slice(-4);
    return `${"*".repeat(Math.max(0, value.length - visible.length))}${visible}`;
  }

  private async withKycLock<T>(
    driverId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = `lock:driver:kyc:${driverId}`;
    const token = randomUUID();
    const acquired = await redis.set(key, token, "PX", 30_000, "NX");
    if (!acquired) throw errors.conflict("KYC update is already in progress");
    try {
      return await action();
    } finally {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      );
    }
  }
}
