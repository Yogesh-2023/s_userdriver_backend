import { env } from "../../../config/env";
import { redis } from "../../../infrastructure/redis";
import {
  Prisma,
  VehicleStatus,
  VehicleVerificationStatus,
} from "@prisma/client";
import { AppError, errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import { isValidUUID } from "../admin.utils";
import { emitAdminRoom, emitDriver } from "../../../infrastructure/realtime";
import {
  ACTIVE_TRIP_STATUSES,
  REQUIRED_VEHICLE_DOCUMENTS,
  type AdminActionContext,
} from "../admin.constants";
import {
  buildVehicleReview,
  type VehicleVerificationReview,
} from "../vehicle-verification.util";
import { AdminDriverService } from "./admin-driver.service";

function normalizeDocumentType(rawType: string): string {
  const clean = (rawType || "").trim().replaceAll("_", "").replaceAll("-", "").replaceAll(" ", "").toUpperCase();
  if (clean.includes("RC") || clean.includes("REGISTRATION")) return "REGISTRATION_CERTIFICATE";
  if (clean.includes("INSURANCE")) return "INSURANCE";
  if (clean.includes("VEHICLEPHOTO") || clean.includes("VEHICLEFRONT") || clean.includes("VEHICLEIMAGE") || clean === "VEHICLE") return "VEHICLE_PHOTO";
  if (clean.includes("PERMIT")) return "PERMIT";
  if (clean.includes("PUC") || clean.includes("POLLUTION")) return "POLLUTION_CERTIFICATE";
  if (clean.includes("FITNESS") || clean.includes("INSPECTION")) return "FITNESS";
  return (rawType || "OTHER").trim().toUpperCase();
}

function extractFileKey(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") {
    const str = val.trim();
    if (!str || str === "null" || str === "undefined") return null;
    if (str.startsWith("http://") || str.startsWith("https://")) {
      const parts = str.split("/images/");
      if (parts.length > 1 && parts[1]) return parts[1];
      const urlParts = str.split("/");
      return urlParts.slice(3).join("/");
    }
    return str;
  }
  if (typeof val === "object") {
    return extractFileKey(val.fileKey || val.key || val.url || val.imageUrl || val.documentUrl);
  }
  return null;
}

async function saveVehicleDocumentsHelper(tx: any, vehicleId: string, inputData: Record<string, any>) {
  if (!inputData || typeof inputData !== "object") return;

  const docsToSave: Array<{
    type: string;
    fileKey: string;
    documentNo?: string;
    provider?: string;
    policyNo?: string;
  }> = [];

  const fieldMappings: Array<{ keys: string[]; type: string }> = [
    { keys: ["rc", "rcFileKey", "rcUrl", "registrationCertificate", "rcDocument"], type: "REGISTRATION_CERTIFICATE" },
    { keys: ["insurance", "insuranceFileKey", "insuranceUrl", "vehicleInsurance", "insuranceDocument"], type: "INSURANCE" },
    { keys: ["vehiclePhoto", "vehiclePhotoFileKey", "vehiclePhotoUrl", "vehicleImage", "vehicleFrontPhoto"], type: "VEHICLE_PHOTO" },
    { keys: ["permit", "permitFileKey", "permitUrl"], type: "PERMIT" },
    { keys: ["puc", "pucFileKey", "pucUrl", "pollutionCertificate"], type: "POLLUTION_CERTIFICATE" },
    { keys: ["fitness", "fitnessFileKey", "fitnessUrl"], type: "FITNESS" },
  ];

  for (const mapping of fieldMappings) {
    for (const k of mapping.keys) {
      if (inputData[k] !== undefined && inputData[k] !== null) {
        const fileKey = extractFileKey(inputData[k]);
        if (fileKey) {
          const docNo = typeof inputData[k] === "object"
            ? (inputData[k].documentNo || inputData[k].number || inputData[k].rcNumber || inputData[k].policyNo)
            : (inputData[mapping.type === "REGISTRATION_CERTIFICATE" ? "rcNumber" : mapping.type === "INSURANCE" ? "policyNumber" : "documentNo"]);
          docsToSave.push({
            type: mapping.type,
            fileKey,
            documentNo: docNo,
            provider: typeof inputData[k] === "object" ? inputData[k].provider : inputData.insuranceCompany,
            policyNo: typeof inputData[k] === "object" ? inputData[k].policyNo : inputData.policyNumber,
          });
          break;
        }
      }
    }
  }

  if (Array.isArray(inputData.documents)) {
    for (const d of inputData.documents) {
      if (d && typeof d === "object") {
        const rawType = d.type || d.documentType || d.typeKey || "OTHER";
        const type = normalizeDocumentType(rawType);
        const fileKey = extractFileKey(d);
        if (fileKey) {
          docsToSave.push({
            type,
            fileKey,
            documentNo: d.documentNo || d.number || d.policyNo,
            provider: d.provider,
            policyNo: d.policyNo,
          });
        }
      }
    }
  }

  if (inputData.type || inputData.documentType) {
    const rawType = inputData.type || inputData.documentType;
    const type = normalizeDocumentType(rawType);
    const fileKey = extractFileKey(inputData);
    if (fileKey) {
      docsToSave.push({
        type,
        fileKey,
        documentNo: inputData.documentNo || inputData.number,
      });
    }
  }

  for (const doc of docsToSave) {
    await tx.vehicleDocument.upsert({
      where: {
        vehicleId_type: { vehicleId, type: doc.type },
      },
      update: {
        fileKey: doc.fileKey,
        ...(doc.documentNo ? { documentNo: doc.documentNo } : {}),
        status: "VERIFIED",
        verifiedAt: new Date(),
      },
      create: {
        vehicleId,
        type: doc.type,
        documentNo: doc.documentNo || null,
        fileKey: doc.fileKey,
        status: "VERIFIED",
        verifiedAt: new Date(),
      },
    });

    if (doc.type === "INSURANCE" && (doc.provider || doc.policyNo || inputData.policyValidTill)) {
      await tx.vehicleInsurance.create({
        data: {
          vehicleId,
          provider: doc.provider || inputData.insuranceCompany || "Insurance Provider",
          policyNo: doc.policyNo || doc.documentNo || inputData.policyNumber || "POLICY-UNKNOWN",
          expiresAt: inputData.policyValidTill ? new Date(inputData.policyValidTill) : new Date(Date.now() + 365 * 86400000),
        },
      });
    }
  }
}

export class AdminVehicleService {
  private readonly drivers = new AdminDriverService();

  private readonly baseUrl =
    env.NODE_ENV === "production"
      ? "https://tuk.technogigz.co.in"
      : `http://localhost:${env.PORT}`;

  private toDocumentUrl(fileKey: string) {
    return env.AWS_S3_BUCKET
      ? `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`
      : `${this.baseUrl}/images/${fileKey}`;
  }

  async list(input: {
    page: number;
    limit: number;
    search?: string;
    status?: VehicleStatus;
    verificationStatus?: VehicleVerificationStatus;
    categoryId?: string;
    assigned?: boolean;
  }) {
    const where: Prisma.VehicleWhereInput = {
      deletedAt: null,
      status: input.status,
      verificationStatus: input.verificationStatus,
      categoryId: input.categoryId,
      ...(input.search
        ? {
            OR: [
              ...(isValidUUID(input.search)
                ? [{ id: { equals: input.search } }]
                : []),
              {
                registrationNo: {
                  contains: input.search.replaceAll(" ", ""),
                  mode: "insensitive" as const,
                },
              },
              {
                make: { contains: input.search, mode: "insensitive" as const },
              },
              {
                model: { contains: input.search, mode: "insensitive" as const },
              },
              {
                driverAssignments: {
                  some: {
                    driver: {
                      user: {
                        OR: [
                          {
                            displayName: {
                              contains: input.search,
                              mode: "insensitive" as const,
                            },
                          },
                          { phone: { contains: input.search } },
                        ],
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(input.assigned === undefined
        ? {}
        : input.assigned
          ? { driverAssignments: { some: { isActive: true } } }
          : { driverAssignments: { none: { isActive: true } } }),
    };
    const [items, total] = await prisma.$transaction([
      prisma.vehicle.findMany({
        where,
        include: {
          category: true,
          brand: true,
          vehicleModel: true,
          driverAssignments: {
            where: { isActive: true },
            include: {
              driver: {
                include: {
                  user: {
                    select: { displayName: true, phone: true, status: true },
                  },
                },
              },
            },
          },
          documents: true,
          insurances: { orderBy: { expiresAt: "desc" }, take: 1 },
          maintenances: { orderBy: { date: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.vehicle.count({ where }),
    ]);

    const baseUrl =
      process.env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${process.env.PORT || 3000}`;

    const formattedItems = items.map((item) => ({
      ...item,
      documents: (item.documents ?? []).map((doc) => {
        const imageUrl = process.env.AWS_S3_BUCKET
          ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${doc.fileKey}`
          : `${baseUrl}/images/${doc.fileKey}`;
        return {
          ...doc,
          imageUrl,
          url: imageUrl,
        };
      }),
    }));

    return { items: formattedItems, total };
  }

  async create(
    input: any,
    actor: AdminActionContext,
  ) {
    const registrationNo = (input.registrationNo || "")
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]/g, "");

    const {
      rc, rcFileKey, rcUrl, rcNumber,
      insurance, insuranceFileKey, insuranceUrl, insuranceCompany, policyNumber, policyValidTill,
      vehiclePhoto, vehiclePhotoFileKey, vehiclePhotoUrl,
      documents,
      ...vehicleScalarData
    } = input;

    return prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: { ...vehicleScalarData, registrationNo },
        include: { category: true },
      });

      await saveVehicleDocumentsHelper(tx, vehicle.id, input);

      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_VEHICLE_CREATED",
          entityType: "Vehicle",
          entityId: vehicle.id,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          after: {
            registrationNo,
            categoryId: input.categoryId,
            status: vehicle.status,
          },
        },
      });

      return this.get(vehicle.id);
    });
  }

  async get(vehicleId: string) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        category: true,
        brand: true,
        vehicleModel: true,
        documents: true,
        driverAssignments: {
          orderBy: { assignedAt: "desc" },
          include: {
            driver: {
              include: {
                user: {
                  select: { displayName: true, phone: true, status: true },
                },
              },
            },
          },
        },
        statusHistory: { orderBy: { createdAt: "desc" }, take: 20 },
        verificationHistory: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        trips: {
          where: { status: { in: [...ACTIVE_TRIP_STATUSES] } },
          include: { booking: true, driver: true },
        },
        maintenances: { orderBy: { date: "desc" } },
        insurances: { orderBy: { expiresAt: "desc" } },
      },
    });
    if (!vehicle) throw errors.notFound("Vehicle not found");

    const baseUrl =
      process.env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${process.env.PORT || 3000}`;

    const formattedDocs = (vehicle.documents ?? []).map((doc) => {
      const imageUrl = process.env.AWS_S3_BUCKET
        ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${doc.fileKey}`
        : `${baseUrl}/images/${doc.fileKey}`;
      return {
        ...doc,
        imageUrl,
        url: imageUrl,
      };
    });

    return {
      ...vehicle,
      documents: formattedDocs,
      review: buildVehicleReview(vehicle),
    };
  }

  async delete(vehicleId: string, _actor: AdminActionContext) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) throw errors.notFound("Vehicle not found");
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { deletedAt: new Date(), status: "PENDING" },
    });
    return { success: true };
  }

  async uploadDocument(
    vehicleId: string,
    data: any,
    actor: AdminActionContext,
  ) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw errors.notFound("Vehicle not found");

    return prisma.$transaction(async (tx) => {
      await saveVehicleDocumentsHelper(tx, vehicleId, typeof data === "object" ? data : { fileKey: data });
      const docs = await tx.vehicleDocument.findMany({ where: { vehicleId } });
      const baseUrl =
        process.env.NODE_ENV === "production"
          ? "https://tuk.technogigz.co.in"
          : `http://localhost:${process.env.PORT || 3000}`;
      return docs.map((doc) => {
        const imageUrl = process.env.AWS_S3_BUCKET
          ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${doc.fileKey}`
          : `${baseUrl}/images/${doc.fileKey}`;
        return {
          ...doc,
          imageUrl,
          url: imageUrl,
        };
      });
    });
  }

  async listMaintenance(vehicleId?: string) {
    return prisma.vehicleMaintenance.findMany({
      where: vehicleId ? { vehicleId } : undefined,
      orderBy: { date: "desc" },
    });
  }

  async addMaintenance(
    vehicleId: string,
    data: any,
    actor: AdminActionContext,
  ) {
    if (!vehicleId) throw errors.badRequest("vehicleId is required");
    return prisma.vehicleMaintenance.create({
      data: {
        vehicleId,
        description: data.description,
        cost: data.cost,
        date: data.date,
      },
    });
  }

  async listInsurance(vehicleId?: string) {
    return prisma.vehicleInsurance.findMany({
      where: vehicleId ? { vehicleId } : undefined,
      orderBy: { expiresAt: "desc" },
    });
  }

  async addInsurance(vehicleId: string, data: any, _actor: AdminActionContext) {
    if (!vehicleId) throw errors.badRequest("vehicleId is required");
    return prisma.vehicleInsurance.create({
      data: {
        vehicleId,
        provider: data.provider,
        policyNo: data.policyNo,
        expiresAt: data.expiresAt,
      },
    });
  }

  async getLiveLocation(vehicleId?: string) {
    // Usually retrieved from Redis/Tracking service. Just returning empty for now.
    return { latitude: 0, longitude: 0, vehicleId };
  }

  async update(
    vehicleId: string,
    input: any,
    actor: AdminActionContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.vehicle.findUnique({ where: { id: vehicleId } });
      if (!before) throw errors.notFound("Vehicle not found");

      const {
        rc, rcFileKey, rcUrl, rcNumber,
        insurance, insuranceFileKey, insuranceUrl, insuranceCompany, policyNumber, policyValidTill,
        vehiclePhoto, vehiclePhotoFileKey, vehiclePhotoUrl,
        documents,
        ...vehicleScalarData
      } = input;

      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          ...vehicleScalarData,
          ...(input.registrationNo
            ? {
                registrationNo: input.registrationNo
                  .toUpperCase()
                  .replaceAll(/[^A-Z0-9]/g, ""),
              }
            : {}),
        },
        include: { category: true },
      });

      await saveVehicleDocumentsHelper(tx, vehicleId, input);

      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_VEHICLE_UPDATED",
          entityType: "Vehicle",
          entityId: vehicleId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          before: {
            categoryId: before.categoryId,
            registrationNo: before.registrationNo,
            make: before.make,
            model: before.model,
          },
          after: {
            categoryId: updated.categoryId,
            registrationNo: updated.registrationNo,
            make: updated.make,
            model: updated.model,
          },
        },
      });

      return this.get(vehicleId);
    });
  }

  async updateStatus(
    vehicleId: string,
    input: { status: VehicleStatus; reason: string },
    actor: AdminActionContext,
  ) {
    const updated = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUnique({
        where: { id: vehicleId },
        include: { documents: true },
      });
      if (!vehicle) throw errors.notFound("Vehicle not found");
      if (input.status === VehicleStatus.ACTIVE) {
        this.assertDocuments(vehicle.documents);
        if (vehicle.verificationStatus !== "APPROVED") {
          throw errors.conflict("Vehicle must be approved before activation");
        }
      }
      if (
        input.status === VehicleStatus.MAINTENANCE ||
        input.status === VehicleStatus.SUSPENDED
      ) {
        const activeTrip = await tx.trip.count({
          where: {
            vehicleId,
            status: { in: [...ACTIVE_TRIP_STATUSES] },
          },
        });
        if (activeTrip) {
          throw errors.conflict("Vehicle has an active trip");
        }
      }
      const result = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          status: input.status,
          isAvailable: input.status === VehicleStatus.ACTIVE ? true : false,
          statusHistory:
            vehicle.status === input.status
              ? undefined
              : {
                  create: {
                    adminId: actor.adminId,
                    fromStatus: vehicle.status,
                    toStatus: input.status,
                    reason: input.reason,
                  },
                },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_VEHICLE_STATUS_UPDATED",
          entityType: "Vehicle",
          entityId: vehicleId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason: input.reason,
          before: { status: vehicle.status },
          after: { status: input.status },
        },
      });
      return result;
    });
    emitAdminRoom("dashboard", "admin:vehicle:status-updated", {
      vehicleId,
      status: input.status,
    });
    return updated;
  }

  async verify(
    vehicleId: string,
    input: { status: VehicleVerificationStatus; reason?: string },
    actor: AdminActionContext,
  ) {
    if (input.status === "REJECTED" && !input.reason) {
      throw errors.badRequest("A rejection reason is required");
    }
    const result = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUnique({
        where: { id: vehicleId },
        include: {
          documents: true,
          category: true,
          brand: true,
          vehicleModel: true,
          driver: { include: { user: true } },
        },
      });
      if (!vehicle) throw errors.notFound("Vehicle not found");

      if (input.status === "APPROVED") {
        if (vehicle.verificationStatus === "APPROVED") {
          throw errors.conflict("VEHICLE_ALREADY_APPROVED");
        }
        this.assertDocuments(vehicle.documents);

        if (!vehicle.category) {
          throw errors.notFound("VEHICLE_CATEGORY_NOT_FOUND");
        }
        if (!vehicle.category.isActive) {
          throw errors.badRequest("VEHICLE_CATEGORY_INACTIVE");
        }

        if (vehicle.seatingCapacity) {
          if (
            (vehicle.category.minPassengers &&
              vehicle.seatingCapacity < vehicle.category.minPassengers) ||
            (vehicle.category.maxPassengers &&
              vehicle.seatingCapacity > vehicle.category.maxPassengers)
          ) {
            throw errors.badRequest("INVALID_VEHICLE_SEATING_CAPACITY");
          }
        }

        if (vehicle.fuelType && vehicle.category.allowedFuelTypes.length > 0) {
          if (!vehicle.category.allowedFuelTypes.includes(vehicle.fuelType)) {
            throw errors.badRequest("INVALID_VEHICLE_FUEL_TYPE");
          }
        }

        if (vehicle.driver && vehicle.driver.user.status !== "ACTIVE") {
          throw errors.badRequest("Driver account is not active");
        }

        const normalizedRegistration = vehicle.registrationNo
          .toUpperCase()
          .replace(/\s+/g, "");
        const duplicate = await tx.vehicle.findUnique({
          where: { registrationNo: normalizedRegistration },
        });
        if (duplicate && duplicate.id !== vehicle.id) {
          throw errors.conflict("VEHICLE_REGISTRATION_ALREADY_EXISTS");
        }

        // Compare the master registration number against the RC document
        // metadata recorded at upload time. A real mismatch blocks approval.
        const review = buildVehicleReview(vehicle);
        if (review.vehicleNumber.result === "MISMATCH") {
          throw new AppError(
            422,
            "VEHICLE_VERIFICATION_FAILED",
            "Vehicle verification cannot be approved",
            {
              reason: "Vehicle registration number mismatch",
              master: review.vehicleNumber.master,
              document: review.vehicleNumber.document,
            },
          );
        }
      }

      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          verificationStatus: input.status,
          isAvailable:
            input.status === "APPROVED" &&
            vehicle.status === VehicleStatus.ACTIVE
              ? true
              : false,
          verificationHistory:
            vehicle.verificationStatus === input.status
              ? undefined
              : {
                  create: {
                    adminId: actor.adminId,
                    fromStatus: vehicle.verificationStatus,
                    toStatus: input.status,
                    reason: input.reason,
                  },
                },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_VEHICLE_VERIFICATION_UPDATED",
          entityType: "Vehicle",
          entityId: vehicleId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason: input.reason,
          before: { status: vehicle.verificationStatus },
          after: { status: input.status },
        },
      });
      if (vehicle.driver) {
        await tx.notification.create({
          data: {
            userId: vehicle.driver.userId,
            channel: "IN_APP",
            templateKey:
              input.status === "APPROVED"
                ? "VEHICLE_VERIFICATION_APPROVED"
                : "VEHICLE_VERIFICATION_REJECTED",
            title:
              input.status === "APPROVED"
                ? "Vehicle verification approved"
                : "Vehicle verification rejected",
            body:
              input.status === "APPROVED"
                ? `Your vehicle ${vehicle.registrationNo} has been approved.`
                : `Your vehicle ${vehicle.registrationNo} was rejected. Reason: ${input.reason}`,
            status: "QUEUED",
            data: {
              vehicleId,
              verificationStatus: input.status,
              reason: input.reason ?? null,
            },
          },
        });
      }
      return updated;
    });
    emitAdminRoom("dashboard", "admin:vehicle:status-updated", {
      vehicleId,
      verificationStatus: input.status,
    });
    if (result.driverId) {
      emitDriver(result.driverId, "vehicle:verification:updated", {
        vehicleId,
        verificationStatus: input.status,
        reason: input.reason ?? null,
      });
    }
    return result;
  }

  assignDriver(
    vehicleId: string,
    driverId: string,
    reason: string | undefined,
    actor: AdminActionContext,
  ) {
    return this.drivers.assignVehicle(driverId, vehicleId, reason, actor);
  }

  async verifyDocument(
    documentId: string,
    input: { status: "VERIFIED" | "REJECTED"; reason?: string },
    actor: AdminActionContext,
  ) {
    if (input.status === "REJECTED" && !input.reason) {
      throw errors.badRequest("Reason is required when rejecting a document");
    }

    return prisma.$transaction(async (tx) => {
      const doc = await tx.vehicleDocument.findUnique({
        where: { id: documentId },
      });
      if (!doc) throw errors.notFound("Document not found");

      const updated = await tx.vehicleDocument.update({
        where: { id: documentId },
        data: {
          status: input.status,
          verifiedAt: input.status === "VERIFIED" ? new Date() : null,
          documentStatusHistories: {
            create: {
              adminId: actor.adminId,
              documentType: doc.type,
              fromStatus: doc.status,
              toStatus: input.status,
              reason: input.reason,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_VEHICLE_DOCUMENT_VERIFIED",
          entityType: "VehicleDocument",
          entityId: documentId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason: input.reason,
          metadata: { vehicleId: doc.vehicleId, documentType: doc.type },
        },
      });

      return updated;
    });
  }

  async compliance(vehicleId: string) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        category: true,
        documents: true,
      },
    });
    if (!vehicle) throw errors.notFound("Vehicle not found");

    const missingDocuments: string[] = [];
    const expiredDocuments: string[] = [];
    const pendingDocuments: string[] = [];
    const rejectedDocuments: string[] = [];

    const now = new Date();

    for (const reqDoc of REQUIRED_VEHICLE_DOCUMENTS) {
      const doc = vehicle.documents.find((d) => d.type === reqDoc);
      if (!doc) {
        missingDocuments.push(reqDoc);
      } else if (doc.expiresAt && doc.expiresAt < now) {
        expiredDocuments.push(reqDoc);
      } else if (doc.status === "PENDING") {
        pendingDocuments.push(reqDoc);
      } else if (doc.status === "REJECTED") {
        rejectedDocuments.push(reqDoc);
      }
    }

    const isCompliant =
      missingDocuments.length === 0 &&
      expiredDocuments.length === 0 &&
      pendingDocuments.length === 0 &&
      rejectedDocuments.length === 0 &&
      vehicle.verificationStatus === "APPROVED" &&
      vehicle.status === "ACTIVE";

    return {
      isCompliant,
      missingDocuments,
      expiredDocuments,
      pendingDocuments,
      rejectedDocuments,
      verificationStatus: vehicle.verificationStatus,
      status: vehicle.status,
    };
  }

  async unassignDriver(
    vehicleId: string,
    reason: string,
    actor: AdminActionContext,
  ) {
    const assignment = await prisma.driverVehicleAssignment.findFirst({
      where: { vehicleId, isActive: true },
      select: { driverId: true },
    });
    if (!assignment) throw errors.notFound("Active assignment not found");
    return this.drivers.unassignVehicle(assignment.driverId, reason, actor);
  }

  async documents(vehicleId: string) {
    const docs = await prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { type: "asc" },
    });
    const baseUrl =
      process.env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${process.env.PORT || 3000}`;
    return docs.map((doc) => {
      const fileUrl = process.env.AWS_S3_BUCKET
        ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${doc.fileKey}`
        : `${baseUrl}/images/${doc.fileKey}`;
      return { ...doc, fileUrl, imageUrl: fileUrl, url: fileUrl };
    });
  }

  trips(vehicleId: string, page: number, limit: number) {
    return prisma.$transaction([
      prisma.trip.findMany({
        where: { vehicleId },
        include: { booking: true, driver: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.trip.count({ where: { vehicleId } }),
    ]);
  }

  async categories() {
    const cats = await prisma.vehicleCategory.findMany({
      where: { 
        deletedAt: null
      },
      include: {
        pricingRules: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1
        }
      },
      orderBy: { displayOrder: "asc" },
    });

    return cats.map(cat => {
      const fare = cat.pricingRules[0];
      const { pricingRules, ...rest } = cat;
      return {
        ...rest,
        baseFare: fare ? fare.baseFare.toNumber() : 0,
        perKmRate: fare ? fare.perKilometer.toNumber() : 0,
        minimumFare: fare ? fare.minimumFare.toNumber() : 0,
        perMinuteRate: fare ? fare.perMinute.toNumber() : 0,
      };
    });
  }

  async getCategory(categoryId: string) {
    const category = await prisma.vehicleCategory.findUnique({
      where: { id: categoryId, deletedAt: null },
    });
    if (!category) throw errors.notFound("Vehicle category not found");
    return category;
  }

  async createCategory(
    input: {
      name: string;
      slug?: string;
      description?: string;
      imageUrl?: string;
      iconUrl?: string;
      minPassengers?: number;
      maxPassengers?: number;
      allowedFuelTypes?: string[];
      isActive: boolean;
      displayOrder: number;
    },
    actor: AdminActionContext,
  ) {
    const existingName = await prisma.vehicleCategory.findFirst({
      where: {
        name: { equals: input.name, mode: "insensitive" },
        deletedAt: null,
      },
    });
    if (existingName) throw errors.conflict("VEHICLE_CATEGORY_ALREADY_EXISTS");

    let slug = input.slug;
    if (!slug) {
      const nameFirst = (input.name || "CAT").split(/\s+/)[0] || "CAT";
      const prefix = nameFirst.substring(0, 3).toUpperCase();
      const existingCategories = await prisma.vehicleCategory.findMany({
        where: { slug: { startsWith: `${prefix}-` } },
        select: { slug: true },
      });
      let maxSequence = 0;
      for (const cat of existingCategories) {
        const match = cat.slug.match(new RegExp(`^${prefix}-(\\d+)$`));
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (num > maxSequence) maxSequence = num;
        }
      }
      slug = `${prefix}-${String(maxSequence + 1).padStart(2, "0")}`;
    }

    const existingSlug = await prisma.vehicleCategory.findFirst({
      where: { slug, deletedAt: null },
    });
    if (existingSlug) throw errors.conflict("VEHICLE_CATEGORY_CODE_ALREADY_EXISTS");

    const category = await prisma.vehicleCategory.create({
      data: {
        ...input,
        slug,
        createdByAdminId: actor.adminId,
      },
    });

    await redis.del("vehicle-categories:active");

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_VEHICLE_CATEGORY_CREATED",
        entityType: "VehicleCategory",
        entityId: category.id,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        after: { slug: category.slug, name: category.name },
      },
    });
    return category;
  }

  async updateCategory(
    categoryId: string,
    input: {
      name?: string;
      slug?: string;
      description?: string;
      imageUrl?: string;
      iconUrl?: string;
      minPassengers?: number;
      maxPassengers?: number;
      allowedFuelTypes?: string[];
      isActive?: boolean;
      displayOrder?: number;
    },
    actor: AdminActionContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.vehicleCategory.findUnique({
        where: { id: categoryId, deletedAt: null },
      });
      if (!before) throw errors.notFound("VEHICLE_CATEGORY_NOT_FOUND");

      if (input.name) {
        const existingName = await tx.vehicleCategory.findFirst({
          where: {
            name: input.name,
            id: { not: categoryId },
            deletedAt: null,
          },
        });
        if (existingName)
          throw errors.conflict("VEHICLE_CATEGORY_ALREADY_EXISTS");
      }

      if (input.slug) {
        const existingSlug = await tx.vehicleCategory.findFirst({
          where: {
            slug: { equals: input.slug, mode: "insensitive" },
            id: { not: categoryId },
            deletedAt: null,
          },
        });
        if (existingSlug)
          throw errors.conflict("VEHICLE_CATEGORY_ALREADY_EXISTS");
      }

      const updated = await tx.vehicleCategory.update({
        where: { id: categoryId },
        data: input,
      });

      await redis.del("vehicle-categories:active");
      await redis.del(`vehicle-category:${categoryId}`);

      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_VEHICLE_CATEGORY_UPDATED",
          entityType: "VehicleCategory",
          entityId: categoryId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          before: {
            slug: before.slug,
            name: before.name,
            isActive: before.isActive,
          },
          after: {
            slug: updated.slug,
            name: updated.name,
            isActive: updated.isActive,
          },
        },
      });
      return updated;
    });
  }

  async updateCategoryStatus(
    categoryId: string,
    isActive: boolean,
    actor: AdminActionContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.vehicleCategory.findUnique({
        where: { id: categoryId, deletedAt: null },
      });
      if (!before) throw errors.notFound("VEHICLE_CATEGORY_NOT_FOUND");

      const updated = await tx.vehicleCategory.update({
        where: { id: categoryId },
        data: { isActive },
      });

      await redis.del("vehicle-categories:active");
      await redis.del(`vehicle-category:${categoryId}`);

      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_VEHICLE_CATEGORY_STATUS_UPDATED",
          entityType: "VehicleCategory",
          entityId: categoryId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          before: { isActive: before.isActive },
          after: { isActive: updated.isActive },
        },
      });
      return updated;
    });
  }

  async deleteCategory(categoryId: string, actor: AdminActionContext) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.vehicleCategory.findUnique({
        where: { id: categoryId, deletedAt: null },
      });
      if (!before) throw errors.notFound("VEHICLE_CATEGORY_NOT_FOUND");

      // We allow deletion even if there are bookings/vehicles (soft delete)
      // The admin wants to be able to delete old test categories like BIKE/AUTO

      const updated = await tx.vehicleCategory.update({
        where: { id: categoryId },
        data: { deletedAt: new Date(), isActive: false },
      });

      await redis.del("vehicle-categories:active");
      await redis.del(`vehicle-category:${categoryId}`);

      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_VEHICLE_CATEGORY_DELETED",
          entityType: "VehicleCategory",
          entityId: categoryId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          before: { slug: before.slug, name: before.name },
          after: { deletedAt: updated.deletedAt },
        },
      });
      return updated;
    });
  }

  // --- Brands ---
  async brands() {
    return prisma.vehicleBrand.findMany({
      orderBy: { name: "asc" },
    });
  }

  async createBrand(
    input: { name: string; slug?: string; isActive: boolean },
    actor: AdminActionContext,
  ) {
    const slug = input.slug || input.name.toLowerCase().replace(/\s+/g, "-").substring(0, 100);
    const existing = await prisma.vehicleBrand.findFirst({
      where: { OR: [{ name: input.name }, { slug }] },
    });
    if (existing) throw errors.conflict("VEHICLE_BRAND_ALREADY_EXISTS");

    const brand = await prisma.vehicleBrand.create({
      data: {
        name: input.name,
        slug,
        isActive: input.isActive,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_VEHICLE_BRAND_CREATED",
        entityType: "VehicleBrand",
        entityId: brand.id,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        after: { name: brand.name },
      },
    });

    return brand;
  }

  async getBrand(brandId: string) {
    const brand = await prisma.vehicleBrand.findUnique({
      where: { id: brandId },
    });
    if (!brand) throw errors.notFound("Vehicle brand not found");
    return brand;
  }

  async updateBrand(
    brandId: string,
    input: { name?: string; slug?: string; isActive?: boolean },
    actor: AdminActionContext,
  ) {
    const brand = await this.getBrand(brandId);
    if (input.name || input.slug) {
      const slug = input.slug || input.name?.toLowerCase().replace(/\s+/g, "-").substring(0, 100);
      const existing = await prisma.vehicleBrand.findFirst({
        where: {
          id: { not: brandId },
          OR: [
            ...(input.name ? [{ name: input.name }] : []),
            ...(slug ? [{ slug }] : []),
          ],
        },
      });
      if (existing) throw errors.conflict("VEHICLE_BRAND_ALREADY_EXISTS");
      if (slug) input.slug = slug;
    }

    const updated = await prisma.vehicleBrand.update({
      where: { id: brandId },
      data: input,
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_VEHICLE_BRAND_UPDATED",
        entityType: "VehicleBrand",
        entityId: brandId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        before: { name: brand.name, isActive: brand.isActive },
        after: { name: updated.name, isActive: updated.isActive },
      },
    });

    return updated;
  }

  async updateBrandStatus(
    brandId: string,
    isActive: boolean,
    actor: AdminActionContext,
  ) {
    return this.updateBrand(brandId, { isActive }, actor);
  }

  // --- Models ---
  async models() {
    return prisma.vehicleModel.findMany({
      orderBy: { name: "asc" },
      include: {
        brand: true,
        category: true,
      },
    });
  }

  async createModel(
    input: { brandId: string; categoryId: string; name: string; slug?: string; isActive: boolean },
    actor: AdminActionContext,
  ) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.brandId);
    const brand = await prisma.vehicleBrand.findFirst({ 
      where: isUuid ? { id: input.brandId } : { name: { equals: input.brandId, mode: "insensitive" } } 
    });
    if (!brand) throw errors.notFound("VEHICLE_BRAND_NOT_FOUND");
    if (!brand.isActive) throw errors.badRequest("VEHICLE_BRAND_INACTIVE");

    input.brandId = brand.id;

    const category = await prisma.vehicleCategory.findUnique({ where: { id: input.categoryId } });
    if (!category || category.deletedAt) throw errors.notFound("VEHICLE_CATEGORY_NOT_FOUND");
    if (!category.isActive) throw errors.badRequest("VEHICLE_CATEGORY_INACTIVE");

    const slug = input.slug || input.name.toLowerCase().replace(/\s+/g, "-").substring(0, 100);
    const existing = await prisma.vehicleModel.findFirst({
      where: {
        categoryId: input.categoryId,
        brandId: input.brandId,
        name: input.name,
      },
    });
    if (existing) throw errors.conflict("VEHICLE_MODEL_ALREADY_EXISTS");

    const model = await prisma.vehicleModel.create({
      data: {
        ...input,
        slug,
      },
      include: { brand: true, category: true },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_VEHICLE_MODEL_CREATED",
        entityType: "VehicleModel",
        entityId: model.id,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        after: { name: model.name },
      },
    });

    return model;
  }

  async getModel(modelId: string) {
    const model = await prisma.vehicleModel.findUnique({
      where: { id: modelId },
      include: { brand: true, category: true },
    });
    if (!model) throw errors.notFound("Vehicle model not found");
    return model;
  }

  async updateModel(
    modelId: string,
    input: { brandId?: string; categoryId?: string; name?: string; slug?: string; isActive?: boolean },
    actor: AdminActionContext,
  ) {
    const model = await this.getModel(modelId);

    if (input.brandId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.brandId);
      const brand = await prisma.vehicleBrand.findFirst({
        where: isUuid ? { id: input.brandId } : { name: { equals: input.brandId, mode: "insensitive" } }
      });
      if (!brand) throw errors.notFound("VEHICLE_BRAND_NOT_FOUND");
      input.brandId = brand.id;
    }
    
    if (input.brandId || input.categoryId || input.name) {
      const bId = input.brandId || model.brandId;
      const cId = input.categoryId || model.categoryId;
      const nm = input.name || model.name;

      const existing = await prisma.vehicleModel.findFirst({
        where: {
          id: { not: modelId },
          categoryId: cId,
          brandId: bId,
          name: nm,
        },
      });
      if (existing) throw errors.conflict("VEHICLE_MODEL_ALREADY_EXISTS");
    }

    if (input.name && !input.slug) {
      input.slug = input.name.toLowerCase().replace(/\s+/g, "-").substring(0, 100);
    }

    const updated = await prisma.vehicleModel.update({
      where: { id: modelId },
      data: input,
      include: { brand: true, category: true },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_VEHICLE_MODEL_UPDATED",
        entityType: "VehicleModel",
        entityId: modelId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        before: { name: model.name, isActive: model.isActive },
        after: { name: updated.name, isActive: updated.isActive },
      },
    });

    return updated;
  }

  async updateModelStatus(
    modelId: string,
    isActive: boolean,
    actor: AdminActionContext,
  ) {
    return this.updateModel(modelId, { isActive }, actor);
  }

  // --- Years ---
  async years() {
    return prisma.manufacturerYear.findMany({
      include: {
        model: {
          include: {
            brand: true,
            category: true,
          }
        }
      },
      orderBy: { year: "desc" },
    });
  }

  async createYear(
    input: { modelId: string; year: number; isActive: boolean },
    actor: AdminActionContext,
  ) {
    const existing = await prisma.manufacturerYear.findUnique({
      where: { modelId_year: { modelId: input.modelId, year: input.year } },
    });
    if (existing) throw errors.conflict("MANUFACTURER_YEAR_ALREADY_EXISTS");

    const year = await prisma.manufacturerYear.create({
      data: input,
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_MANUFACTURER_YEAR_CREATED",
        entityType: "ManufacturerYear",
        entityId: year.id,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        after: { year: year.year },
      },
    });

    return year;
  }

  async updateYear(
    yearId: string,
    input: { modelId?: string; year?: number; isActive?: boolean },
    actor: AdminActionContext,
  ) {
    const year = await prisma.manufacturerYear.findUnique({ where: { id: yearId } });
    if (!year) throw errors.notFound("Manufacturer year not found");

    if (input.year || input.modelId) {
      const existing = await prisma.manufacturerYear.findUnique({
        where: { modelId_year: { modelId: input.modelId || year.modelId, year: input.year || year.year } },
      });
      if (existing && existing.id !== yearId) throw errors.conflict("MANUFACTURER_YEAR_ALREADY_EXISTS");
    }

    const updated = await prisma.manufacturerYear.update({
      where: { id: yearId },
      data: input,
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_MANUFACTURER_YEAR_UPDATED",
        entityType: "ManufacturerYear",
        entityId: yearId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        before: { year: year.year, isActive: year.isActive },
        after: { year: updated.year, isActive: updated.isActive },
      },
    });

    return updated;
  }

  async updateYearStatus(
    yearId: string,
    isActive: boolean,
    actor: AdminActionContext,
  ) {
    return this.updateYear(yearId, { isActive }, actor);
  }

  private assertDocuments(
    documents: Array<{ type: string; status: string; expiresAt: Date | null }>,
  ) {
    const now = new Date();
    const valid = new Set(
      documents
        .filter(
          (document) =>
            document.status === "VERIFIED" &&
            (!document.expiresAt || document.expiresAt > now),
        )
        .map(({ type }) => type),
    );
    if (!REQUIRED_VEHICLE_DOCUMENTS.every((type) => valid.has(type))) {
      throw errors.conflict(
        "All mandatory vehicle documents must be valid and verified",
      );
    }
  }
}
