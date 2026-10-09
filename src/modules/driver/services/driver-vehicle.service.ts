import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import {
  createDocumentUpload,
  uploadVehicleDocument,
} from "../../../integrations/storage";
import {
  rtoService,
  mapRtoClassToCategorySlug,
} from "../../../integrations/rto";

export class DriverVehicleService {
  async getCategories() {
    return prisma.vehicleCategory.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { displayOrder: "asc" },
    });
  }

  async getCategory(categoryId: string) {
    const category = await prisma.vehicleCategory.findFirst({
      where: { id: categoryId, isActive: true, deletedAt: null },
    });
    if (!category) throw errors.notFound("Category not found");
    return category;
  }

  async getVehicles(userId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { vehicles: { include: { category: true } } },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    return driver.vehicles;
  }

  async getVehicle(userId: string, vehicleId: string) {
    const driver = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!driver) throw errors.notFound("Driver profile not found");

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, driverId: driver.id },
      include: { category: true },
    });
    if (!vehicle) throw errors.notFound("Vehicle not found");
    return vehicle;
  }

  async getAssignedVehicle(userId: string) {
    const assignment = await prisma.driverVehicleAssignment.findFirst({
      where: {
        driver: { userId },
        isActive: true,
        endedAt: null,
      },
      orderBy: { assignedAt: "desc" },
      include: {
        vehicle: {
          include: {
            category: true,
            documents: { orderBy: { type: "asc" } },
          },
        },
      },
    });
    if (!assignment) throw errors.notFound("Assigned vehicle not found");
    return assignment;
  }

  async getVehicleInfo(userId: string) {
    let assignment = await prisma.driverVehicleAssignment.findFirst({
      where: {
        driver: { userId },
        isActive: true,
        endedAt: null,
      },
      orderBy: { assignedAt: "desc" },
      include: {
        driver: {
          include: {
            documents: true,
          },
        },
        vehicle: {
          include: {
            category: true,
            documents: { orderBy: { type: "asc" } },
            insurances: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });

    let driverDocs: any[] = [];

    if (!assignment) {
      const driver = await prisma.driverProfile.findUnique({
        where: { userId },
        include: {
          documents: true,
          vehicles: {
            take: 1,
            orderBy: { createdAt: "desc" },
            include: {
              category: true,
              documents: { orderBy: { type: "asc" } },
              insurances: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      });

      if (!driver) {
        return { vehicleDetails: null, vehicleDocuments: null };
      }

      driverDocs = driver.documents ?? [];

      if (driver.vehicles.length > 0 && driver.vehicles[0]) {
        const fallbackVehicle = driver.vehicles[0];
        assignment = {
          id: "fallback",
          driverId: driver.id,
          vehicleId: fallbackVehicle?.id,
          isActive: true,
          assignedAt: fallbackVehicle?.createdAt,
          endedAt: null,
          driver,
          vehicle: fallbackVehicle,
        } as any;
      }
    } else {
      driverDocs = assignment.driver?.documents ?? [];
    }

    const vehicle = assignment?.vehicle ?? null;
    const vehicleDocs = vehicle?.documents ?? [];
    const insuranceRecord = vehicle?.insurances?.[0] ?? null;

    const findDocument = (types: string[]) => {
      const upperTypes = types.map((t) => t.toUpperCase());
      const vDoc = vehicleDocs.find((doc) => upperTypes.includes(doc.type.toUpperCase()));
      if (vDoc) return vDoc;
      const dDoc = driverDocs.find((doc) => upperTypes.includes(doc.type.toUpperCase()));
      if (dDoc) return dDoc;
      return null;
    };

    const baseUrl =
      process.env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${process.env.PORT || 3000}`;

    const documentSummary = (document: any | null) => {
      if (!document) return null;
      const { fileKey, ...rest } = document;
      return {
        ...rest,
        imageUrl: process.env.AWS_S3_BUCKET
          ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`
          : `${baseUrl}/images/${fileKey}`,
      };
    };

    const rc = findDocument(["REGISTRATION_CERTIFICATE", "RC", "VEHICLE_REGISTRATION"]);
    const insurance = findDocument(["INSURANCE", "VEHICLE_INSURANCE"]);
    const vehiclePhoto = findDocument([
      "VEHICLE_PHOTO",
      "VEHICLE_PHOTOS",
      "VEHICLE_FRONT_PHOTO",
      "VEHICLE_IMAGE",
      "VEHICLE",
    ]);
    const puc = findDocument(["POLLUTION_CERTIFICATE", "PUC"]);
    const fitness = findDocument(["FITNESS", "INSPECTION"]);
    const permit = findDocument(["COMMERCIAL_PERMIT", "PERMIT"]);

    return {
      vehicleDetails: vehicle
        ? {
            vehicleId: vehicle.id,
            registrationNumber: vehicle.registrationNo,
            make: vehicle.make,
            model: vehicle.model,
            color: vehicle.color,
            year: vehicle.year,
            seatingCapacity: vehicle.seatingCapacity,
            fuelType: vehicle.fuelType,
            currentAddress: vehicle.currentAddress,
            category: vehicle.category
              ? {
                  categoryId: vehicle.category.id,
                  name: vehicle.category.name,
                  slug: vehicle.category.slug,
                }
              : null,
            status: vehicle.status,
            verificationStatus: vehicle.verificationStatus,
            isAvailable: vehicle.isAvailable,
            assignment: assignment
              ? {
                  assignedAt: assignment.assignedAt,
                  isActive: assignment.isActive,
                }
              : null,
          }
        : null,
      vehicleDocuments: {
        rc: documentSummary(rc),
        insurance: (() => {
          const summary = documentSummary(insurance);
          if (!summary) return null;
          return {
            ...summary,
            provider: insuranceRecord?.provider ?? null,
            policyNo: insuranceRecord?.policyNo ?? null,
            validFrom: insuranceRecord?.validFrom ?? null,
            expiresAt: insuranceRecord?.expiresAt ?? summary.expiresAt ?? null,
          };
        })(),
        vehiclePhoto: documentSummary(vehiclePhoto),
        puc: documentSummary(puc),
        fitness: documentSummary(fitness),
        permit: documentSummary(permit),
      },
    };
  }

  async createVehicle(
    userId: string,
    data: {
      categoryId?: string | null;
      brandId?: string | null;
      modelId?: string | null;
      drivingLicenseNumber?: string;
      make?: string;
      model?: string;
      registrationNo: string;
      year: number;
      color?: string;
      fuelType?: string;
      seatingCapacity?: number;
      currentAddress?: string;
      insuranceCompany?: string;
      policyNumber?: string;
      policyValidFrom?: string;
      policyValidTill?: string;
    },
  ) {
    const driver = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!driver) throw errors.notFound("Driver profile not found");

    let category = null;
    let autoFetchedData = null;

    try {
      autoFetchedData = await rtoService.fetchVehicleDetails(
        data.registrationNo,
      );
    } catch (err) {
      // Ignore RTO errors for fallback
    }

    if (!data.categoryId && autoFetchedData) {
      const slug = mapRtoClassToCategorySlug(
        autoFetchedData.vehicleClass,
        autoFetchedData.seatingCapacity,
      );
      category = await prisma.vehicleCategory.findFirst({
        where: { slug, isActive: true, deletedAt: null },
      });
      if (category) {
        data.categoryId = category.id;
      }
    }

    if (data.categoryId && !category) {
      category = await prisma.vehicleCategory.findFirst({
        where: { id: data.categoryId, isActive: true, deletedAt: null },
      });
      if (!category) throw errors.badRequest("Invalid category");
    }

    if (!data.categoryId) {
      // If no category passed and RTO auto-fetch couldn't map it
      throw errors.badRequest(
        "Unable to automatically detect vehicle category from registration number. Please select a category manually.",
      );
    }

    if (
      category &&
      data.seatingCapacity !== undefined &&
      ((category.minPassengers !== null &&
        data.seatingCapacity < category.minPassengers) ||
        (category.maxPassengers !== null &&
          data.seatingCapacity > category.maxPassengers))
    ) {
      throw errors.badRequest(
        "Vehicle seating capacity is outside the category limits",
        {
          minimum: category.minPassengers,
          maximum: category.maxPassengers,
        },
      );
    }

    if (
      category &&
      data.fuelType &&
      category.allowedFuelTypes.length > 0 &&
      !category.allowedFuelTypes.includes(data.fuelType.toUpperCase())
    ) {
      throw errors.badRequest(
        "Vehicle fuel type is not allowed for this category",
        {
          allowedFuelTypes: category.allowedFuelTypes,
        },
      );
    }

    // Validate Master Data
    let finalMake = data.make;
    let finalModel = data.model;

    if (data.brandId) {
      const brand = await prisma.vehicleBrand.findUnique({
        where: { id: data.brandId },
      });
      if (!brand || !brand.isActive) throw errors.badRequest("Invalid or inactive vehicle brand");
      if (!finalMake) finalMake = brand.name;
    }

    if (data.modelId) {
      const model = await prisma.vehicleModel.findUnique({
        where: { id: data.modelId },
      });
      if (!model || !model.isActive) throw errors.badRequest("Invalid or inactive vehicle model");
      if (!finalModel) finalModel = model.name;
      
      // Auto-assign category if not manually provided and valid
      if (!data.categoryId && model.categoryId) {
         data.categoryId = model.categoryId;
      }
    }

    if (!finalMake || !finalModel) {
      throw errors.badRequest("Vehicle make and model are required (either explicitly or via brandId and modelId)");
    }

    const existing = await prisma.vehicle.findUnique({
      where: { registrationNo: data.registrationNo },
      include: { driverAssignments: true },
    });
    if (existing) {
      if (
        existing.driverId === driver.id ||
        existing.driverAssignments?.some((a) => a.driverId === driver.id)
      ) {
        return this.updateVehicle(userId, existing.id, { ...data, make: finalMake, model: finalModel } as any);
      }
      throw errors.conflict(
        `Vehicle with registration number ${data.registrationNo} is already registered to another driver`,
      );
    }

    const {
      insuranceCompany,
      policyNumber,
      policyValidFrom,
      policyValidTill,
      drivingLicenseNumber,
      brandId,
      modelId,
      ...vehicleData
    } = data;

    const hasInsurance = insuranceCompany && policyNumber && policyValidTill;

    return prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { id: driver.id },
        data: { licenseNumber: drivingLicenseNumber },
      });

      return tx.vehicle.create({
        data: {
          ...vehicleData,
          make: finalMake as string,
          model: finalModel as string,
          ...(brandId ? { brandId } : {}),
          ...(modelId ? { modelId } : {}),
          ...(vehicleData.fuelType
            ? { fuelType: vehicleData.fuelType.toUpperCase() }
            : {}),
          verificationStatus: "PENDING",
          driverId: driver.id,
          driverAssignments: {
            create: {
              driverId: driver.id,
              isActive: true,
            },
          },
          ...(hasInsurance
            ? {
                insurances: {
                  create: {
                    provider: insuranceCompany,
                    policyNo: policyNumber,
                    validFrom: policyValidFrom
                      ? new Date(policyValidFrom)
                      : null,
                    expiresAt: new Date(policyValidTill),
                  },
                },
              }
            : {}),
        },
        include: { category: true, insurances: true },
      });
    });
  }

  async updateVehicle(
    userId: string,
    vehicleId: string,
    data: {
      categoryId?: string;
      brandId?: string | null;
      modelId?: string | null;
      make?: string;
      model?: string;
      registrationNo?: string;
      year?: number;
      color?: string;
      fuelType?: string;
      seatingCapacity?: number;
      currentAddress?: string;
      insuranceCompany?: string;
      policyNumber?: string;
      policyValidFrom?: string;
      policyValidTill?: string;
    },
  ) {
    const vehicle = await this.getVehicle(userId, vehicleId);

    // If critical fields change, reset verification to pending
    const criticalFieldsChanged =
      data.categoryId || data.brandId || data.modelId || data.registrationNo || data.make || data.model;

    if (data.registrationNo && data.registrationNo !== vehicle.registrationNo) {
      const existing = await prisma.vehicle.findUnique({
        where: { registrationNo: data.registrationNo },
      });
      if (existing)
        throw errors.conflict(
          "Vehicle with this registration number already exists",
        );
    }

    let finalMake = data.make;
    let finalModel = data.model;

    if (data.brandId !== undefined) {
      if (data.brandId) {
        const brand = await prisma.vehicleBrand.findUnique({
          where: { id: data.brandId },
        });
        if (!brand || !brand.isActive) throw errors.badRequest("Invalid or inactive vehicle brand");
        if (!finalMake) finalMake = brand.name;
      }
    }

    if (data.modelId !== undefined) {
      if (data.modelId) {
        const model = await prisma.vehicleModel.findUnique({
          where: { id: data.modelId },
        });
        if (!model || !model.isActive) throw errors.badRequest("Invalid or inactive vehicle model");
        if (!finalModel) finalModel = model.name;
      }
    }

    const {
      insuranceCompany,
      policyNumber,
      policyValidFrom,
      policyValidTill,
      brandId,
      modelId,
      ...vehicleData
    } = data;
    const hasInsurance = insuranceCompany || policyNumber || policyValidTill;

    const updateData: any = {
      ...vehicleData,
    };
    if (finalMake !== undefined) updateData.make = finalMake;
    if (finalModel !== undefined) updateData.model = finalModel;
    if (brandId !== undefined) updateData.brandId = brandId;
    if (modelId !== undefined) updateData.modelId = modelId;

    return prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        ...updateData,
        ...(criticalFieldsChanged ? { verificationStatus: "PENDING" } : {}),
        ...(hasInsurance
          ? {
              insurances: {
                create: {
                  provider: insuranceCompany || "",
                  policyNo: policyNumber || "",
                  validFrom: policyValidFrom ? new Date(policyValidFrom) : null,
                  expiresAt: policyValidTill
                    ? new Date(policyValidTill)
                    : new Date(),
                },
              },
            }
          : {}),
      },
      include: { category: true, insurances: true },
    });
  }

  async deleteVehicle(userId: string, vehicleId: string) {
    await this.getVehicle(userId, vehicleId);

    const activeTrips = await prisma.trip.findFirst({
      where: { vehicleId, status: { in: ["STARTED", "DRIVER_ARRIVED"] } },
    });
    if (activeTrips)
      throw errors.conflict("Cannot delete vehicle during an active trip");

    return prisma.vehicle.update({
      where: { id: vehicleId },
      data: { isAvailable: false },
    });
  }

  async createVehicleDocumentUploadUrl(
    userId: string,
    vehicleId: string,
    type: string,
    contentType: string,
    sizeBytes: number,
  ) {
    const vehicle = await this.getVehicle(userId, vehicleId);

    const upload = await createDocumentUpload(
      "vehicle-documents",
      vehicle.id,
      contentType,
      sizeBytes,
    );

    await prisma.vehicleDocument.upsert({
      where: { vehicleId_type: { vehicleId: vehicle.id, type } },
      update: { fileKey: upload.key, status: "PENDING" },
      create: { vehicleId: vehicle.id, type, fileKey: upload.key },
    });

    return upload;
  }

  async uploadVehicleDocumentDraft(
    userId: string,
    vehicleId: string,
    type: string,
    documentNo: string | undefined,
    filename: string,
  ) {
    const vehicle = await this.getVehicle(userId, vehicleId);

    await prisma.vehicleDocument.upsert({
      where: { vehicleId_type: { vehicleId: vehicle.id, type } },
      update: { fileKey: filename, status: "PENDING", documentNo },
      create: { vehicleId: vehicle.id, type, fileKey: filename, documentNo },
    });

    return { filename };
  }

  async getVehicleDocuments(userId: string, vehicleId: string) {
    const vehicle = await this.getVehicle(userId, vehicleId);
    const documents = await prisma.vehicleDocument.findMany({
      where: { vehicleId: vehicle.id },
    });

    const baseUrl =
      process.env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${process.env.PORT || 3000}`;

    return documents.map((doc) => {
      const { fileKey, ...rest } = doc;
      return {
        ...rest,
        imageUrl: process.env.AWS_S3_BUCKET
          ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`
          : `${baseUrl}/images/${fileKey}`,
      };
    });
  }

  async submitVehicleForVerification(userId: string, vehicleId: string) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: { documents: true, driver: true },
    });

    if (!vehicle || !vehicle.driver || vehicle.driver.userId !== userId) {
      throw errors.notFound("Vehicle not found");
    }

    const requiredDocs = ["REGISTRATION_CERTIFICATE", "INSURANCE"];
    const uploadedDocs = vehicle.documents.map((d) => d.type);
    const missingDocs = requiredDocs.filter(
      (req) => !uploadedDocs.includes(req),
    );

    if (missingDocs.length > 0) {
      throw errors.badRequest(
        `Missing required vehicle documents: ${missingDocs.join(", ")}`,
      );
    }

    return prisma.vehicle.update({
      where: { id: vehicleId },
      data: { verificationStatus: "PENDING" },
    });
  }

  async getVehicleVerificationStatus(userId: string, vehicleId: string) {
    const vehicle = await this.getVehicle(userId, vehicleId);
    return {
      vehicleId: vehicle.id,
      verificationStatus: vehicle.verificationStatus,
    };
  }

  async selectVehicle(userId: string, vehicleId: string) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: { driver: true },
    });

    if (!vehicle || !vehicle.driver || vehicle.driver.userId !== userId) {
      throw errors.notFound("Vehicle not found");
    }

    if (vehicle.verificationStatus !== "APPROVED") {
      throw errors.forbidden("DRIVER_VEHICLE_NOT_APPROVED");
    }

    const driverId = vehicle.driverId;
    if (!driverId)
      throw errors.badRequest("Vehicle is not assigned to a driver");

    // Set this vehicle as active, deactivate previous ones
    await prisma.$transaction(async (tx) => {
      await tx.driverVehicleAssignment.updateMany({
        where: { driverId, isActive: true },
        data: { isActive: false, endedAt: new Date() },
      });

      await tx.driverVehicleAssignment.create({
        data: {
          driverId,
          vehicleId,
          isActive: true,
        },
      });
    });

    return { success: true };
  }

  async uploadVehicleDocuments(
    userId: string,
    vehicleId: string,
    documents: Array<{
      type: string;
      documentNo?: string;
      contentType: string;
      file: Buffer;
    }>,
  ) {
    const vehicle = await this.getVehicle(userId, vehicleId);

    const uploads = await Promise.all(
      documents.map(async (document) => ({
        document,
        upload: await uploadVehicleDocument(
          vehicle.id,
          document.contentType,
          document.file,
        ),
      })),
    );

    const savedDocuments = await prisma.$transaction(async (tx) => {
      const saved = [];
      for (const { document, upload } of uploads) {
        saved.push(
          await tx.vehicleDocument.upsert({
            where: {
              vehicleId_type: {
                vehicleId: vehicle.id,
                type: document.type,
              },
            },
            update: {
              fileKey: upload.key,
              documentNo: document.documentNo,
              status: "PENDING",
            },
            create: {
              vehicleId: vehicle.id,
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
      return saved;
    });

    return {
      documents: savedDocuments.map((document, index) => ({
        documentId: document.id,
        documentType: document.type,
        documentUrl: uploads[index]!.upload.uploadUrl,
        status: document.status,
      })),
    };
  }
}
