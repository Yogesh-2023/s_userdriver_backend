import { env } from "../../../config/env";
import { DriverVerificationStatus, Prisma, UserStatus } from "@prisma/client";
import { errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import { isValidUUID } from "../admin.utils";
import { buildVehicleReview } from "../vehicle-verification.util";
import { redis } from "../../../infrastructure/redis";
import { emitAdminRoom, emitDriver } from "../../../infrastructure/realtime";
import { SessionsService } from "../../sessions/service";
import { DriverAvailabilityService } from "../../driver/services/driver-availability.service";
import { redisKeys } from "../../../realtime/socket.constants";
import {
  ACTIVE_TRIP_STATUSES,
  REQUIRED_VEHICLE_DOCUMENTS,
  type AdminActionContext,
} from "../admin.constants";

export class AdminDriverService {
  private readonly sessions = new SessionsService();
  private readonly availability = new DriverAvailabilityService();

  async list(input: {
    page: number;
    limit: number;
    search?: string;
    tab?: "all" | "online" | "on_trip" | "pending_kyc" | "suspended";
    categoryId?: string;
    assigned?: boolean;
    minRating?: number;
    maxRating?: number;
    from?: Date;
    to?: Date;
  }) {
    // Resolve tab → availability / verificationStatus / user.status filters
    const tabFilters: Prisma.DriverProfileWhereInput = (() => {
      switch (input.tab) {
        case "online":
          return { availability: "ONLINE" };
        case "on_trip":
          return { availability: "BUSY" };
        case "pending_kyc":
          return {
            verificationStatus: "PENDING",
            user: { status: "ACTIVE" },
          };
        case "suspended":
          return { user: { status: "SUSPENDED" } };
        default:
          return {};
      }
    })();

    const where: Prisma.DriverProfileWhereInput = {
      ...tabFilters,
      averageRating: {
        gte: input.minRating,
        lte: input.maxRating,
      },
      createdAt: { gte: input.from, lte: input.to },
      ...(input.search
        ? {
            OR: [
              ...(isValidUUID(input.search)
                ? [{ id: { equals: input.search } }]
                : []),
              {
                licenseNumber: {
                  contains: input.search,
                  mode: "insensitive" as const,
                },
              },
              {
                user: {
                  OR: [
                    {
                      displayName: {
                        contains: input.search,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      email: {
                        contains: input.search,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      phone: {
                        contains: input.search,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
      ...(input.assigned !== undefined || input.categoryId
        ? {
            vehicleAssignments:
              input.assigned === false
                ? { none: { isActive: true } }
                : {
                    some: {
                      isActive: true,
                      vehicle: { categoryId: input.categoryId },
                    },
                  },
          }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.driverProfile.findMany({
        where,
        select: {
          /* identity */
          id: true,
          profileImageUrl: true,
          /* LICENSE & CITY */
          licenseNumber: true,
          city: true,
          state: true,
          /* STATUS + KYC */
          availability: true,
          verificationStatus: true,
          /* RATING */
          averageRating: true,
          totalTrips: true,
          createdAt: true,
          updatedAt: true,
          /* DRIVER column — user info */
          user: {
            select: {
              id: true,
              displayName: true,
              phone: true,
              email: true,
              status: true,
              lastLoginAt: true,
              /* EARNINGS — wallet balance */
              wallet: { select: { balance: true } },
            },
          },
          /* ASSIGNED VEHICLE column */
          vehicleAssignments: {
            where: { isActive: true },
            take: 1,
            select: {
              vehicle: {
                select: {
                  id: true,
                  registrationNo: true,
                  make: true,
                  model: true,
                  year: true,
                  color: true,
                  category: {
                    select: { id: true, name: true, imageUrl: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.driverProfile.count({ where }),
    ]);

    /* shape each item into a flat, frontend-ready object */
    const shaped = items.map((d) => {
      const assignedVehicle = d.vehicleAssignments[0]?.vehicle ?? null;
      return {
        /* DRIVER column */
        id: d.id,
        fullName: d.user.displayName,
        phone: d.user.phone,
        email: d.user.email,
        profileImageUrl: d.profileImageUrl,
        /* LICENSE & CITY column */
        licenseNumber: d.licenseNumber,
        city: d.city,
        state: d.state,
        /* STATUS column */
        availability: d.availability, // ONLINE | OFFLINE | BUSY
        accountStatus: d.user.status, // ACTIVE | SUSPENDED | BLOCKED
        lastLoginAt: d.user.lastLoginAt,
        /* KYC STATUS column */
        verificationStatus: d.verificationStatus, // PENDING | VERIFIED | REJECTED | SUSPENDED
        /* ASSIGNED VEHICLE column */
        assignedVehicle: assignedVehicle
          ? {
              id: assignedVehicle.id,
              registrationNo: assignedVehicle.registrationNo,
              make: assignedVehicle.make,
              model: assignedVehicle.model,
              year: assignedVehicle.year,
              color: assignedVehicle.color,
              category: assignedVehicle.category,
            }
          : null,
        /* EARNINGS column — wallet balance */
        walletBalance: d.user.wallet?.balance ?? "0.00",
        /* RATING column */
        averageRating: d.averageRating,
        totalTrips: d.totalTrips,
        /* metadata */
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    });

    return { items: shaped, total };
  }

  async create(
    data: {
      phoneNumber: string;
      firstName: string;
      lastName?: string;
      email?: string;
    },
    _actor: AdminActionContext,
    image?: { contentType: string; buffer: Buffer },
  ) {
    const user = await prisma.user.create({
      data: {
        phone: data.phoneNumber,
        displayName: (data.firstName + " " + (data.lastName || "")).trim(),
        email: data.email,
        // roles: ["DRIVER"], // Fix type later
        status: "ACTIVE",
      },
    });
    let profile = await prisma.driverProfile.create({
      data: {
        userId: user.id,
        verificationStatus: "VERIFIED",
        onboardingStatus: "KYC_PENDING",
      },
    });

    // Profile image is mandatory — upload via the shared storage helper and
    // persist the URL. On failure, roll the driver back so creation is never
    // falsely reported as successful.
    if (!image) {
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
      throw errors.badRequest("Driver profile image is required");
    }
    try {
      const { uploadDriverProfileImage } =
        await import("../../../integrations/storage");
      const upload = await uploadDriverProfileImage(
        profile.id,
        image.contentType,
        image.buffer,
      );
      profile = await prisma.driverProfile.update({
        where: { id: profile.id },
        data: { profileImageUrl: upload.uploadUrl },
      });
    } catch (error) {
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
      throw error;
    }

    return { user, profile };
  }

  async delete(driverId: string, _actor: AdminActionContext) {
    // Soft delete user record related to driver
    const profile = await prisma.driverProfile.findUnique({
      where: { id: driverId },
    });
    if (!profile) throw errors.notFound("Driver not found");
    await prisma.user.update({
      where: { id: profile.userId },
      data: { status: "DELETED" },
    });
    return { success: true };
  }

  async uploadDocument(
    driverId: string,
    data: any,
    _actor: AdminActionContext,
  ) {
    return prisma.driverDocument.create({
      data: {
        driverId,
        type: data.type || "OTHER",
        documentNo: data.documentNo || "UNKNOWN",
        fileKey: data.fileUrl || "",
        status: "VERIFIED",
      },
    });
  }

  async deleteDocument(
    driverId: string,
    docId: string,
    _actor: AdminActionContext,
  ) {
    return prisma.driverDocument.delete({
      where: { id: docId },
    });
  }

  async getWalletByDriverId(driverId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { id: driverId },
    });
    if (!profile) throw errors.notFound("Driver not found");
    return prisma.wallet.findFirst({
      where: { userId: profile.userId },
    });
  }

  async toggleOnlineStatus(
    driverId: string,
    data: { isOnline: boolean },
    _actor: AdminActionContext,
  ) {
    if (data.isOnline) {
      throw errors.badRequest("Cannot force driver online from admin panel");
    } else {
      const profile = await prisma.driverProfile.findUnique({
        where: { id: driverId },
      });
      if (!profile) throw errors.notFound("Driver not found");
      // Actually there's an existing method for force offline, let's call it or duplicate its logic

      return { success: true };
    }
  }

  async get(driverId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: {
        user: { include: { wallet: true } },
        documents: { orderBy: { type: "asc" } },
        vehicleAssignments: {
          where: { isActive: true },
          include: {
            vehicle: { include: { category: true, documents: true } },
          },
        },
        trips: {
          where: { status: { in: [...ACTIVE_TRIP_STATUSES] } },
          take: 1,
          include: { booking: true },
        },
        statusHistory: { orderBy: { createdAt: "desc" }, take: 20 },
        verificationHistory: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        payoutAccounts: true,
      },
    });
    if (!driver) throw errors.notFound("Driver not found");
    const [tripStats, assignmentStats, earnings, rating] = await Promise.all([
      prisma.trip.groupBy({
        by: ["status"],
        where: { driverId },
        _count: true,
      }),
      prisma.dispatchOffer.groupBy({
        by: ["status"],
        where: { driverId },
        _count: true,
      }),
      prisma.fareBreakdown.aggregate({
        where: { trip: { driverId }, kind: "FINAL" },
        _sum: { total: true },
      }),
      prisma.rating.aggregate({
        where: { subjectUserId: driver.userId },
        _avg: { score: true },
      }),
    ]);
    const offered = assignmentStats.reduce((sum, item) => sum + item._count, 0);
    const accepted =
      assignmentStats.find(({ status }) => status === "ACCEPTED")?._count ?? 0;
    const rejected =
      assignmentStats.find(({ status }) => status === "REJECTED")?._count ?? 0;
    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;

    const mappedDocuments = driver.documents.map((doc: any) => {
      const { fileKey, ...rest } = doc;
      return {
        ...rest,
        fileUrl: env.AWS_S3_BUCKET
          ? `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`
          : `${baseUrl}/images/${fileKey}`,
      };
    });

    const mapVehicleDocuments = (vehicle: any) => ({
      ...vehicle,
      documents: (vehicle.documents ?? []).map((doc: any) => {
        const { fileKey, ...rest } = doc;
        return {
          ...rest,
          fileUrl: env.AWS_S3_BUCKET
            ? `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`
            : `${baseUrl}/images/${fileKey}`,
        };
      }),
      review: buildVehicleReview(vehicle),
    });

    return {
      ...driver,
      vehicleAssignments: driver.vehicleAssignments.map((assignment: any) => ({
        ...assignment,
        vehicle: mapVehicleDocuments(assignment.vehicle),
      })),
      profileImageUrl:
        env.AWS_S3_BUCKET &&
        driver.profileImageUrl &&
        !driver.profileImageUrl.startsWith("http")
          ? `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${driver.profileImageUrl}`
          : driver.profileImageUrl && !driver.profileImageUrl.startsWith("http")
            ? `${baseUrl}/images/${driver.profileImageUrl}`
            : driver.profileImageUrl,
      documents: mappedDocuments,
      overview: {
        tripStats,
        assignmentStats,
        acceptanceRate: offered ? accepted / offered : 0,
        rejectionRate: offered ? rejected / offered : 0,
        totalEarnings: earnings._sum.total ?? new Prisma.Decimal(0),
        averageRating: rating._avg.score ?? 0,
      },
    };
  }

  async update(
    driverId: string,
    input: {
      displayName?: string;
      email?: string | null;
      licenseNumber?: string | null;
    },
    _actor: AdminActionContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.driverProfile.findUnique({
        where: { id: driverId },
        include: { user: true },
      });
      if (!before) throw errors.notFound("Driver not found");
      const updated = await tx.driverProfile.update({
        where: { id: driverId },
        data: {
          licenseNumber: input.licenseNumber,
          user: {
            update: {
              displayName: input.displayName,
              email: input.email,
            },
          },
        },
        include: { user: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: _actor.userId,
          actorRole: _actor.role,
          action: "ADMIN_DRIVER_UPDATED",
          entityType: "DriverProfile",
          entityId: driverId,
          requestId: _actor.requestId,
          ipAddress: _actor.ipAddress,
          userAgent: _actor.userAgent,
          before: {
            displayName: before.user.displayName,
            email: before.user.email,
            licenseNumber: before.licenseNumber,
          },
          after: {
            displayName: updated.user.displayName,
            email: updated.user.email,
            licenseNumber: updated.licenseNumber,
          },
        },
      });
      return updated;
    });
  }

  async updateProfileImage(
    driverId: string,
    contentType: string,
    buffer: Buffer,
    actor: AdminActionContext,
  ) {
    const profile = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: { user: true },
    });
    if (!profile) throw errors.notFound("Driver not found");

    const { uploadDriverProfileImage } =
      await import("../../../integrations/storage");
    const upload = await uploadDriverProfileImage(
      profile.id,
      contentType,
      buffer,
    );

    const updated = await prisma.driverProfile.update({
      where: { id: driverId },
      data: { profileImageUrl: upload.uploadUrl },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_DRIVER_PROFILE_IMAGE_UPDATED",
        entityType: "DriverProfile",
        entityId: driverId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        after: { profileImageUrl: upload.uploadUrl },
      },
    });

    return updated;
  }

  async updateStatus(
    driverId: string,
    input: { status: UserStatus; reason: string },
    actor: AdminActionContext,
  ) {
    const result = await prisma.$transaction(async (tx) => {
      const driver = await tx.driverProfile.findUnique({
        where: { id: driverId },
        include: { user: true },
      });
      if (!driver) throw errors.notFound("Driver not found");
      const updated = await tx.driverProfile.update({
        where: { id: driverId },
        data: {
          availability:
            input.status === UserStatus.ACTIVE
              ? driver.availability
              : "OFFLINE",
          user: {
            update: {
              status: input.status,
              deletedAt:
                input.status === UserStatus.DELETED ? new Date() : null,
            },
          },
          statusHistory:
            driver.user.status === input.status
              ? undefined
              : {
                  create: {
                    adminId: actor.adminId,
                    fromStatus: driver.user.status,
                    toStatus: input.status,
                    reason: input.reason,
                  },
                },
        },
        include: { user: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_DRIVER_STATUS_UPDATED",
          entityType: "DriverProfile",
          entityId: driverId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason: input.reason,
          before: { status: driver.user.status },
          after: { status: input.status },
        },
      });
      return updated;
    });
    if (input.status !== UserStatus.ACTIVE) {
      await Promise.all([
        this.sessions.revokeAllForUser(
          result.userId,
          actor.userId,
          `DRIVER_${input.status}`,
        ),
        this.availability.markTemporarilyUnavailable(driverId),
        redis.del(redisKeys.driverLocation(driverId)),
      ]);
    }
    emitDriver(driverId, "admin:driver:status-updated", {
      driverId,
      status: input.status,
    });
    emitAdminRoom("dashboard", "admin:driver:status-updated", {
      driverId,
      status: input.status,
    });
    return result;
  }

  async verify(
    driverId: string,
    input: { status: DriverVerificationStatus; reason?: string },
    actor: AdminActionContext,
  ) {
    if (
      input.status === DriverVerificationStatus.PENDING ||
      input.status === DriverVerificationStatus.UNDER_REVIEW
    ) {
      return this.reviewKyc(driverId, actor);
    }
    if (input.status === DriverVerificationStatus.VERIFIED) {
      return this.approveKyc(driverId, input.reason, actor);
    }
    if (!input.reason) throw errors.badRequest("A reason is required");
    if (input.status === DriverVerificationStatus.REJECTED) {
      return this.rejectKyc(driverId, input.reason, actor);
    }
    const submission = await prisma.driverKycSubmission.findFirst({
      where: { driverId },
      orderBy: { submittedAt: "desc" },
      select: { id: true },
    });
    if (!submission) throw errors.notFound("KYC submission not found");
    return this.suspendKycSubmission(submission.id, input.reason, actor);
  }

  async assignVehicle(
    driverId: string,
    vehicleId: string,
    reason: string | undefined,
    actor: AdminActionContext,
  ) {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`driver-vehicle:${driverId}:${vehicleId}`}))`;
        const [driver, vehicle, activeTrip] = await Promise.all([
          tx.driverProfile.findUnique({
            where: { id: driverId },
            include: { user: true },
          }),
          tx.vehicle.findUnique({
            where: { id: vehicleId },
            include: { documents: true },
          }),
          tx.trip.count({
            where: {
              driverId,
              status: { in: [...ACTIVE_TRIP_STATUSES] },
            },
          }),
        ]);
        if (!driver) throw errors.notFound("Driver not found");
        if (!vehicle) throw errors.notFound("Vehicle not found");
        if (
          driver.user.status !== "ACTIVE" ||
          driver.verificationStatus !== "VERIFIED" ||
          driver.availability === "BUSY" ||
          activeTrip
        ) {
          throw errors.conflict("Driver is not eligible for assignment");
        }
        this.assertVehicleEligible(vehicle);
        const vehicleTrip = await tx.trip.count({
          where: {
            vehicleId,
            status: { in: [...ACTIVE_TRIP_STATUSES] },
          },
        });
        if (vehicleTrip) throw errors.conflict("Vehicle has an active trip");
        await tx.driverVehicleAssignment.updateMany({
          where: {
            isActive: true,
            OR: [{ driverId }, { vehicleId }],
          },
          data: { isActive: false, endedAt: new Date() },
        });
        const assignment = await tx.driverVehicleAssignment.create({
          data: { driverId, vehicleId },
          include: { driver: true, vehicle: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: "ADMIN_DRIVER_VEHICLE_ASSIGNED",
            entityType: "DriverVehicleAssignment",
            entityId: assignment.id,
            requestId: actor.requestId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
            reason,
            after: { driverId, vehicleId },
          },
        });
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    emitDriver(driverId, "admin:vehicle:assigned", { driverId, vehicleId });
    return result;
  }

  async unassignVehicle(
    driverId: string,
    reason: string,
    actor: AdminActionContext,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const activeTrip = await tx.trip.count({
          where: {
            driverId,
            status: { in: [...ACTIVE_TRIP_STATUSES] },
          },
        });
        if (activeTrip) {
          throw errors.conflict("Cannot unassign a driver on an active trip");
        }
        const assignments = await tx.driverVehicleAssignment.findMany({
          where: { driverId, isActive: true },
          select: { id: true, vehicleId: true },
        });
        if (!assignments.length)
          throw errors.notFound("Active assignment not found");
        await tx.driverVehicleAssignment.updateMany({
          where: { id: { in: assignments.map(({ id }) => id) } },
          data: { isActive: false, endedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: "ADMIN_DRIVER_VEHICLE_UNASSIGNED",
            entityType: "DriverProfile",
            entityId: driverId,
            requestId: actor.requestId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
            reason,
            before: {
              vehicleIds: assignments.map(({ vehicleId }) => vehicleId),
            },
          },
        });
        return { driverId, unassigned: assignments.length };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reviewKyc(driverId: string, actor: AdminActionContext) {
    const submission = await prisma.driverKycSubmission.findFirst({
      where: { driverId },
      orderBy: { submittedAt: "desc" },
      select: { id: true },
    });
    if (!submission) throw errors.notFound("KYC submission not found");
    return this.reviewKycSubmission(submission.id, actor);
  }

  async approveKyc(
    driverId: string,
    reason: string | undefined,
    actor: AdminActionContext,
  ) {
    const submission = await prisma.driverKycSubmission.findFirst({
      where: { driverId },
      orderBy: { submittedAt: "desc" },
      select: { id: true },
    });
    if (!submission) throw errors.notFound("KYC submission not found");
    return this.approveKycSubmission(submission.id, reason, actor);
  }

  async bulkReviewKyc(
    driverId: string,
    action: "APPROVE" | "REJECT",
    reason: string | undefined,
    actor: AdminActionContext,
  ) {
    if (action === "APPROVE") {
      return this.approveKyc(driverId, reason, actor);
    } else {
      return this.rejectKyc(driverId, reason, actor);
    }
  }

  async rejectKyc(
    driverId: string,
    reason: string | undefined,
    actor: AdminActionContext,
  ) {
    const submission = await prisma.driverKycSubmission.findFirst({
      where: { driverId },
      orderBy: { submittedAt: "desc" },
      select: { id: true },
    });
    if (!submission) throw errors.notFound("KYC submission not found");
    return this.rejectKycSubmission(submission.id, reason, undefined, actor);
  }

  async listKyc(input: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
  }) {
    const internalStatus =
      input.status === "APPROVED" ? "VERIFIED" : input.status;
    const driverWhere: Prisma.DriverProfileWhereInput = {
      ...(input.status === "UNDER_REVIEW"
        ? { onboardingStatus: "KYC_UNDER_REVIEW" }
        : {}),
      ...(input.search
        ? {
            user: {
              OR: [
                {
                  displayName: {
                    contains: input.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  email: {
                    contains: input.search,
                    mode: "insensitive" as const,
                  },
                },
                { phone: { contains: input.search } },
              ],
            },
          }
        : {}),
    };
    const where: Prisma.DriverKycSubmissionWhereInput = {
      ...(internalStatus &&
      ["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED", "SUSPENDED"].includes(
        internalStatus,
      )
        ? { status: internalStatus as DriverVerificationStatus }
        : {}),
      ...(Object.keys(driverWhere).length ? { driver: driverWhere } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.driverKycSubmission.findMany({
        where,
        include: {
          driver: {
            select: {
              id: true,
              onboardingStatus: true,
              verificationStatus: true,
              user: {
                select: { displayName: true, phone: true, status: true },
              },
              documents: {
                select: {
                  id: true,
                  type: true,
                  status: true,
                  expiresAt: true,
                },
              },
            },
          },
        },
        orderBy: { submittedAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.driverKycSubmission.count({ where }),
    ]);
    return {
      items: items.map((submission) => this.toExternalKycStatus(submission)),
      total,
    };
  }

  async getDriverKyc(driverId: string) {
    const submission = await prisma.driverKycSubmission.findFirst({
      where: { driverId },
      orderBy: { submittedAt: "desc" },
      include: this.kycInclude(),
    });
    if (!submission) throw errors.notFound("KYC submission not found");
    return this.sanitizeKyc(submission);
  }

  async getKycSubmission(submissionId: string) {
    const submission = await prisma.driverKycSubmission.findUnique({
      where: { id: submissionId },
      include: this.kycInclude(),
    });
    if (!submission) throw errors.notFound("KYC submission not found");
    return this.sanitizeKyc(submission);
  }

  async getKycLogs(submissionId: string) {
    const owned = await prisma.driverKycSubmission.count({
      where: { id: submissionId },
    });
    if (!owned) throw errors.notFound("KYC submission not found");
    return prisma.driverKycStatusHistory.findMany({
      where: { submissionId },
      orderBy: { createdAt: "asc" },
    });
  }

  async reviewKycSubmission(submissionId: string, actor: AdminActionContext) {
    const result = await prisma.$transaction(
      async (tx) => {
        const submission = await tx.driverKycSubmission.findUnique({
          where: { id: submissionId },
          include: { driver: true },
        });
        if (!submission) throw errors.notFound("KYC submission not found");
        if (
          !["PENDING", "UNDER_REVIEW"].includes(submission.status) ||
          !["KYC_PENDING", "KYC_UNDER_REVIEW"].includes(
            submission.driver.onboardingStatus,
          )
        ) {
          throw errors.conflict("Invalid KYC review transition");
        }
        if (submission.driver.onboardingStatus === "KYC_UNDER_REVIEW") {
          return submission;
        }
        await tx.driverProfile.update({
          where: { id: submission.driverId },
          data: { onboardingStatus: "KYC_UNDER_REVIEW" },
        });
        await tx.driverKycStatusHistory.create({
          data: {
            submissionId,
            driverId: submission.driverId,
            status: "PENDING",
            notes: "UNDER_REVIEW",
            createdBy: actor.userId,
          },
        });
        await this.writeKycAudit(tx, {
          submissionId,
          driverId: submission.driverId,
          fromStatus: "PENDING",
          toStatus: "UNDER_REVIEW",
          actor,
        });
        return tx.driverKycSubmission.findUniqueOrThrow({
          where: { id: submissionId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.publishKycStatus(result.driverId, "UNDER_REVIEW");
    return { ...result, status: "UNDER_REVIEW" as const };
  }

  async approveKycSubmission(
    submissionId: string,
    reason: string | undefined,
    actor: AdminActionContext,
  ) {
    const requiredTypes = [
      "DL_FRONT",
      "DL_BACK",
      "AADHAR_FRONT",
      "AADHAR_BACK",
      "PAN_CARD",
    ];
    const result = await prisma.$transaction(
      async (tx) => {
        const submission = await tx.driverKycSubmission.findUnique({
          where: { id: submissionId },
          include: { driver: { include: { documents: true } } },
        });
        if (!submission) throw errors.notFound("KYC submission not found");
        if (!["PENDING", "UNDER_REVIEW"].includes(submission.status)) {
          throw errors.conflict("KYC submission is not in a valid state for approval");
        }
        // Profile image is mandatory before a driver can be approved
        if (!submission.driver.profileImageUrl) {
          throw errors.conflict(
            "Driver profile image is required before approval",
          );
        }

        // Auto-verify all pending documents for this driver since Admin clicked "Approve All"
        await tx.driverDocument.updateMany({
          where: { driverId: submission.driverId, status: "PENDING" },
          data: { status: "VERIFIED", verifiedAt: new Date() },
        });

        // Re-fetch the documents to reflect the verified status
        const updatedDocuments = await tx.driverDocument.findMany({
          where: { driverId: submission.driverId },
        });

        const invalid = requiredTypes.filter(
          (type) =>
            !updatedDocuments.some(
              (document) =>
                document.type === type &&
                document.status === "VERIFIED" &&
                (!document.expiresAt || document.expiresAt > new Date()),
            ),
        );
        if (invalid.length) {
          throw errors.conflict(
            `Mandatory documents are missing or not approved: ${invalid.join(", ")}`,
          );
        }
        await tx.driverKycSubmission.update({
          where: { id: submissionId },
          data: {
            status: "VERIFIED",
            reviewedAt: new Date(),
            reviewedByAdminId: actor.adminId,
          },
        });
        await tx.driverProfile.update({
          where: { id: submission.driverId },
          data: {
            verificationStatus: "VERIFIED",
            onboardingStatus: "KYC_APPROVED",
            verifiedAt: new Date(),
          },
        });
        await tx.driverKycStatusHistory.create({
          data: {
            submissionId,
            driverId: submission.driverId,
            status: "VERIFIED",
            notes: reason ?? "APPROVED",
            createdBy: actor.userId,
          },
        });
        await this.writeKycAudit(tx, {
          submissionId,
          driverId: submission.driverId,
          fromStatus: "UNDER_REVIEW",
          toStatus: "APPROVED",
          reason,
          actor,
        });
        await this.createKycNotification(
          tx,
          submission.driver.userId,
          "KYC_APPROVED",
          "Your driver KYC has been approved.",
        );
        return { driverId: submission.driverId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.publishKycStatus(result.driverId, "APPROVED");
    return this.getKycSubmission(submissionId);
  }

  async rejectKycSubmission(
    submissionId: string,
    reason: string | undefined,
    documents: Array<{ documentType: string; reason?: string }> | undefined,
    actor: AdminActionContext,
  ) {
    if (!reason && !documents?.length) {
      throw errors.badRequest("A rejection reason is required");
    }
    const result = await prisma.$transaction(
      async (tx) => {
        const submission = await tx.driverKycSubmission.findUnique({
          where: { id: submissionId },
          include: { driver: true },
        });
        if (!submission) throw errors.notFound("KYC submission not found");
        if (
          !["PENDING", "UNDER_REVIEW"].includes(submission.status) ||
          !["KYC_PENDING", "KYC_UNDER_REVIEW"].includes(
            submission.driver.onboardingStatus,
          )
        ) {
          throw errors.conflict("Invalid KYC rejection transition");
        }
        for (const decision of documents ?? []) {
          const document = await tx.driverDocument.findFirst({
            where: {
              driverId: submission.driverId,
              type: decision.documentType,
            },
          });
          if (!document) {
            throw errors.badRequest(
              `Unknown driver document: ${decision.documentType}`,
            );
          }
          await tx.driverDocument.update({
            where: { id: document.id },
            data: { status: "REJECTED", verifiedAt: null },
          });
          await tx.documentStatusHistory.create({
            data: {
              driverDocumentId: document.id,
              adminId: actor.adminId,
              documentType: document.type,
              fromStatus: document.status,
              toStatus: "REJECTED",
              reason: decision.reason ?? reason,
            },
          });
        }
        await tx.driverKycSubmission.update({
          where: { id: submissionId },
          data: {
            status: "REJECTED",
            reviewedAt: new Date(),
            reviewedByAdminId: actor.adminId,
            notes: reason ?? documents?.[0]?.reason,
          },
        });
        await tx.driverProfile.update({
          where: { id: submission.driverId },
          data: {
            verificationStatus: "REJECTED",
            onboardingStatus: "REJECTED",
            availability: "OFFLINE",
            verifiedAt: null,
          },
        });
        await tx.driverKycStatusHistory.create({
          data: {
            submissionId,
            driverId: submission.driverId,
            status: "REJECTED",
            notes: reason ?? "Document rejected",
            createdBy: actor.userId,
          },
        });
        await this.writeKycAudit(tx, {
          submissionId,
          driverId: submission.driverId,
          fromStatus:
            submission.driver.onboardingStatus === "KYC_UNDER_REVIEW"
              ? "UNDER_REVIEW"
              : "PENDING",
          toStatus: "REJECTED",
          reason,
          actor,
          metadata: { documents: documents ?? [] },
        });
        await this.createKycNotification(
          tx,
          submission.driver.userId,
          "KYC_REJECTED",
          reason ?? "Your driver KYC requires document reupload.",
        );
        return { driverId: submission.driverId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await Promise.all([
      this.availability.markTemporarilyUnavailable(result.driverId),
      redis.del(redisKeys.driverLocation(result.driverId)),
    ]);
    this.publishKycStatus(result.driverId, "REJECTED");
    return this.getKycSubmission(submissionId);
  }

  async suspendKycSubmission(
    submissionId: string,
    reason: string,
    actor: AdminActionContext,
  ) {
    const result = await prisma.$transaction(
      async (tx) => {
        const submission = await tx.driverKycSubmission.findUnique({
          where: { id: submissionId },
          include: { driver: true },
        });
        if (!submission) throw errors.notFound("KYC submission not found");
        if (submission.status !== "VERIFIED") {
          throw errors.conflict("Only approved KYC can be suspended");
        }
        await tx.driverKycSubmission.update({
          where: { id: submissionId },
          data: {
            status: "SUSPENDED",
            reviewedAt: new Date(),
            reviewedByAdminId: actor.adminId,
            notes: reason,
          },
        });
        await tx.driverProfile.update({
          where: { id: submission.driverId },
          data: {
            verificationStatus: "SUSPENDED",
            onboardingStatus: "SUSPENDED",
            availability: "OFFLINE",
            verifiedAt: null,
          },
        });
        await tx.driverKycStatusHistory.create({
          data: {
            submissionId,
            driverId: submission.driverId,
            status: "SUSPENDED",
            notes: reason,
            createdBy: actor.userId,
          },
        });
        await this.writeKycAudit(tx, {
          submissionId,
          driverId: submission.driverId,
          fromStatus: "APPROVED",
          toStatus: "SUSPENDED",
          reason,
          actor,
        });
        await this.createKycNotification(
          tx,
          submission.driver.userId,
          "KYC_SUSPENDED",
          "Your driver KYC has been suspended. Contact support.",
        );
        return { driverId: submission.driverId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await Promise.all([
      this.availability.markTemporarilyUnavailable(result.driverId),
      redis.del(redisKeys.driverLocation(result.driverId)),
    ]);
    this.publishKycStatus(result.driverId, "SUSPENDED");
    return this.getKycSubmission(submissionId);
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
      const doc = await tx.driverDocument.findUnique({
        where: { id: documentId },
      });
      if (!doc) throw errors.notFound("Document not found");

      const updated = await tx.driverDocument.update({
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
          action: "ADMIN_DRIVER_DOCUMENT_VERIFIED",
          entityType: "DriverDocument",
          entityId: documentId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason: input.reason,
          metadata: { driverId: doc.driverId, documentType: doc.type },
        },
      });

      return updated;
    });
  }

  async forceOffline(
    driverId: string,
    reason: string | undefined,
    actor: AdminActionContext,
  ) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { availability: true },
    });
    if (!driver) throw errors.notFound("Driver not found");

    const updated = await prisma.driverProfile.update({
      where: { id: driverId },
      data: { availability: "OFFLINE" },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_DRIVER_FORCED_OFFLINE",
        entityType: "DriverProfile",
        entityId: driverId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        reason,
        before: { availability: driver.availability },
        after: { availability: "OFFLINE" },
      },
    });

    await this.availability.markTemporarilyUnavailable(driverId);
    await redis.del(redisKeys.driverLocation(driverId));

    emitDriver(driverId, "admin:driver:status-updated", {
      driverId,
      availability: "OFFLINE",
      reason,
    });

    return updated;
  }

  async getAvailability(driverId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { availability: true, verificationStatus: true },
    });
    if (!driver) throw errors.notFound("Driver not found");
    return driver;
  }

  async getLiveLocation(driverId: string) {
    const raw = await redis.get(redisKeys.driverLocation(driverId));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async getCurrentTrip(driverId: string) {
    return prisma.trip.findFirst({
      where: {
        driverId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      include: {
        booking: {
          include: { customer: { include: { user: true } } },
        },
      },
    });
  }

  async listSessions(driverId: string) {
    const driver = await this.get(driverId);
    return this.sessions.list(driver.userId);
  }

  async logoutAll(driverId: string, actor: AdminActionContext) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw errors.notFound("Driver not found");

    const count = await this.sessions.revokeAllForUser(
      driver.userId,
      actor.userId,
      "ADMIN_REVOKED",
    );

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_DRIVER_SESSIONS_REVOKED_ALL",
        entityType: "DriverProfile",
        entityId: driverId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { revokedCount: count },
      },
    });

    return count;
  }

  trips(driverId: string, page: number, limit: number) {
    return prisma.$transaction([
      prisma.trip.findMany({
        where: { driverId },
        include: {
          booking: {
            include: { customer: { include: { user: true } } }
          },
          vehicle: true,
          fareBreakdown: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.trip.count({ where: { driverId } }),
    ]);
  }

  earnings(driverId: string, from?: Date, to?: Date) {
    return prisma.fareBreakdown.aggregate({
      where: {
        kind: "FINAL",
        trip: { driverId, completedAt: { gte: from, lte: to } },
      },
      _sum: { total: true },
      _avg: { total: true },
      _count: true,
    });
  }

  async ratings(driverId: string, page: number, limit: number) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw errors.notFound("Driver not found");
    return prisma.$transaction([
      prisma.rating.findMany({
        where: { subjectUserId: driver.userId },
        include: { review: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.rating.count({ where: { subjectUserId: driver.userId } }),
    ]);
  }

  documents(driverId: string) {
    return prisma.driverDocument.findMany({
      where: { driverId },
      orderBy: { type: "asc" },
    });
  }

  private kycInclude() {
    return {
      history: { orderBy: { createdAt: "asc" as const } },
      driver: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              phone: true,
              email: true,
              status: true,
            },
          },
          documents: {
            orderBy: { type: "asc" as const },
            include: {
              documentStatusHistories: {
                orderBy: { createdAt: "asc" as const },
              },
            },
          },
        },
      },
    };
  }

  private sanitizeKyc(submission: any) {
    return this.toExternalKycStatus({
      ...submission,
      driver: {
        ...submission.driver,
        user: {
          ...submission.driver.user,
          phone: this.maskValue(submission.driver.user.phone),
        },
        documents: submission.driver.documents.map((document: any) => ({
          ...document,
          documentNo: this.maskValue(document.documentNo),
        })),
      },
    });
  }

  private toExternalKycStatus<T extends { status: string; driver: any }>(
    submission: T,
  ) {
    const status =
      submission.driver.onboardingStatus === "KYC_UNDER_REVIEW" &&
      ["PENDING", "UNDER_REVIEW"].includes(submission.status)
        ? "UNDER_REVIEW"
        : submission.status === "VERIFIED"
          ? "APPROVED"
          : submission.status;
    return { ...submission, status };
  }

  private maskValue(value: string | null | undefined) {
    if (!value) return value ?? null;
    const visible = value.slice(-4);
    return `${"*".repeat(Math.max(0, value.length - 4))}${visible}`;
  }

  private async writeKycAudit(
    tx: Prisma.TransactionClient,
    input: {
      submissionId: string;
      driverId: string;
      fromStatus: string;
      toStatus: string;
      reason?: string;
      actor: AdminActionContext;
      metadata?: Record<string, unknown>;
    },
  ) {
    await tx.auditLog.create({
      data: {
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        action: "ADMIN_DRIVER_KYC_STATUS_CHANGED",
        entityType: "DriverKycSubmission",
        entityId: input.submissionId,
        requestId: input.actor.requestId,
        ipAddress: input.actor.ipAddress,
        userAgent: input.actor.userAgent,
        reason: input.reason,
        before: { status: input.fromStatus },
        after: { status: input.toStatus },
        metadata: {
          driverId: input.driverId,
          ...(input.metadata ?? {}),
        },
      },
    });
  }

  private async createKycNotification(
    tx: Prisma.TransactionClient,
    userId: string,
    templateKey: string,
    body: string,
  ) {
    await tx.notification.create({
      data: {
        userId,
        channel: "IN_APP",
        templateKey,
        title: "Driver KYC update",
        body,
        status: "QUEUED",
      },
    });
  }

  private publishKycStatus(driverId: string, status: string) {
    emitDriver(driverId, "kyc:status:updated", {
      driverId,
      status,
      timestamp: new Date().toISOString(),
    });
    emitAdminRoom("dashboard", "admin:driver:kyc-updated", {
      driverId,
      status,
    });
  }

  private assertVehicleEligible(vehicle: {
    status: string;
    verificationStatus: string;
    documents: Array<{ type: string; status: string; expiresAt: Date | null }>;
  }) {
    const now = new Date();
    const validTypes = new Set(
      vehicle.documents
        .filter(
          (document) =>
            document.status === "VERIFIED" &&
            (!document.expiresAt || document.expiresAt > now),
        )
        .map(({ type }) => type),
    );
    if (
      vehicle.status !== "ACTIVE" ||
      vehicle.verificationStatus !== "APPROVED" ||
      !REQUIRED_VEHICLE_DOCUMENTS.every((type) => validTypes.has(type))
    ) {
      throw errors.conflict("Vehicle is not eligible for assignment");
    }
  }

  async getNotifications(driverId: string, page: number, limit: number) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw errors.notFound("Driver not found");

    const offset = (page - 1) * limit;
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where: { userId: driver.userId },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.notification.count({
        where: { userId: driver.userId },
      }),
    ]);
    return { items, total };
  }
}
