import { Prisma, RideType } from "@prisma/client";
import { errors } from "../../../common/errors";
import { prisma } from "../../../database/prisma";
import { PricingService } from "../../pricing/service";
import type { AdminActionContext } from "../admin.constants";

export class AdminFareService {
  private readonly pricing = new PricingService();

  async list(page: number, limit: number, active?: boolean) {
    const where = active === undefined ? {} : { isActive: active };
    const [items, total] = await prisma.$transaction([
      prisma.pricingRule.findMany({
        where,
        include: { vehicleCategory: true, createdByAdmin: true },
        orderBy: [{ createdAt: "desc" }, { version: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.pricingRule.count({ where }),
    ]);
    return { items, total };
  }

  async get(fareId: string) {
    const fare = await prisma.pricingRule.findUnique({
      where: { id: fareId },
      include: {
        vehicleCategory: true,
        createdByAdmin: true,
        supersedes: true,
        successor: true,
      },
    });
    if (!fare) throw errors.notFound("Fare rule not found");
    return fare;
  }

  async create(
    input: {
      vehicleCategoryId: string;
      rideType: RideType;
      scopeKey: string;
      scope?: Record<string, unknown>;
      baseFare: number;
      minimumFare: number;
      perKilometer: number;
      perMinute: number;
      waitingPerMinute: number;
      cancellationFee: number;
      driverAllowance: number;
      platformCommission: number;
      taxPercentage: number;
      nightCharge: number;
      rentalPackageMinutes?: number;
      rentalPackageKm?: number;
      effectiveFrom: Date;
      effectiveTo?: Date | null;
      isActive: boolean;
    },
    actor: AdminActionContext,
  ) {
    return prisma.$transaction(
      async (tx) => {
        await this.assertActiveVehicleCategory(tx, input.vehicleCategoryId);
        await this.lockScope(
          tx,
          input.vehicleCategoryId,
          input.rideType,
          input.scopeKey,
        );
        if (input.isActive) await this.assertNoOverlap(tx, input);
        const latest = await tx.pricingRule.findFirst({
          where: {
            vehicleCategoryId: input.vehicleCategoryId,
            rideType: input.rideType,
            scopeKey: input.scopeKey,
          },
          orderBy: { version: "desc" },
        });
        const created = await tx.pricingRule.create({
          data: {
            ...this.moneyData(input),
            vehicleCategoryId: input.vehicleCategoryId,
            rideType: input.rideType,
            scopeKey: input.scopeKey,
            scope: input.scope as Prisma.InputJsonObject | undefined,
            version: (latest?.version ?? 0) + 1,
            supersedesId: latest?.id,
            createdByAdminId: actor.adminId,
            rentalPackageMinutes: input.rentalPackageMinutes,
            rentalPackageKm: input.rentalPackageKm,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
            isActive: input.isActive,
          },
        });
        await this.audit(
          tx,
          actor,
          created.id,
          "ADMIN_FARE_CREATED",
          undefined,
          {
            version: created.version,
            scopeKey: created.scopeKey,
            isActive: created.isActive,
          },
        );
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async update(
    fareId: string,
    input: Partial<{
      scope: Record<string, unknown>;
      baseFare: number;
      minimumFare: number;
      perKilometer: number;
      perMinute: number;
      waitingPerMinute: number;
      cancellationFee: number;
      driverAllowance: number;
      platformCommission: number;
      taxPercentage: number;
      nightCharge: number;
      rentalPackageMinutes: number;
      rentalPackageKm: number;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      isActive: boolean;
    }>,
    actor: AdminActionContext,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const previous = await tx.pricingRule.findUnique({
          where: { id: fareId },
        });
        if (!previous) throw errors.notFound("Fare rule not found");
        await this.assertActiveVehicleCategory(tx, previous.vehicleCategoryId);
        await this.lockScope(
          tx,
          previous.vehicleCategoryId,
          previous.rideType,
          previous.scopeKey,
        );
        const latest = await tx.pricingRule.findFirst({
          where: {
            vehicleCategoryId: previous.vehicleCategoryId,
            rideType: previous.rideType,
            scopeKey: previous.scopeKey,
          },
          orderBy: { version: "desc" },
        });
        if (latest?.id !== previous.id) {
          throw errors.conflict("Only the latest fare version can be changed");
        }

        const effectiveFrom = input.effectiveFrom ?? new Date();
        if (effectiveFrom < previous.effectiveFrom) {
          throw errors.badRequest(
            "A new fare version cannot start before the current version",
          );
        }
        const effectiveTo =
          "effectiveTo" in input ? input.effectiveTo : previous.effectiveTo;
        const isActive = input.isActive ?? previous.isActive;
        const merged = {
          vehicleCategoryId: previous.vehicleCategoryId,
          rideType: previous.rideType,
          scopeKey: previous.scopeKey,
          effectiveFrom,
          effectiveTo,
        };
        if (effectiveTo && effectiveTo <= effectiveFrom) {
          throw errors.badRequest("Fare effective end must be after start");
        }

        await tx.pricingRule.update({
          where: { id: previous.id },
          data: {
            isActive: previous.isActive && effectiveFrom > new Date(),
            effectiveTo:
              previous.effectiveTo && previous.effectiveTo <= effectiveFrom
                ? previous.effectiveTo
                : effectiveFrom,
          },
        });
        if (isActive) await this.assertNoOverlap(tx, merged);

        const created = await tx.pricingRule.create({
          data: {
            ...this.moneyData({
              baseFare: input.baseFare ?? previous.baseFare.toNumber(),
              minimumFare: input.minimumFare ?? previous.minimumFare.toNumber(),
              perKilometer:
                input.perKilometer ?? previous.perKilometer.toNumber(),
              perMinute: input.perMinute ?? previous.perMinute.toNumber(),
              waitingPerMinute:
                input.waitingPerMinute ?? previous.waitingPerMinute.toNumber(),
              cancellationFee:
                input.cancellationFee ?? previous.cancellationFee.toNumber(),
              driverAllowance:
                input.driverAllowance ?? previous.driverAllowance.toNumber(),
              platformCommission:
                input.platformCommission ??
                previous.platformCommission.toNumber(),
              taxPercentage:
                input.taxPercentage ?? previous.taxPercentage.toNumber(),
              nightCharge: input.nightCharge ?? previous.nightCharge.toNumber(),
            }),
            ...merged,
            scope:
              (input.scope as Prisma.InputJsonObject | undefined) ??
              (previous.scope as Prisma.InputJsonObject | null) ??
              undefined,
            rentalPackageMinutes:
              input.rentalPackageMinutes ??
              previous.rentalPackageMinutes ??
              undefined,
            rentalPackageKm:
              input.rentalPackageKm ?? previous.rentalPackageKm ?? undefined,
            isActive,
            version: previous.version + 1,
            supersedesId: previous.id,
            createdByAdminId: actor.adminId,
          },
        });
        await this.audit(
          tx,
          actor,
          created.id,
          "ADMIN_FARE_UPDATED",
          {
            id: previous.id,
            version: previous.version,
            isActive: previous.isActive,
          },
          {
            version: created.version,
            supersedesId: previous.id,
            isActive: created.isActive,
          },
        );
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async setStatus(
    fareId: string,
    isActive: boolean,
    actor: AdminActionContext,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const fare = await tx.pricingRule.findUnique({
          where: { id: fareId },
        });
        if (!fare) throw errors.notFound("Fare rule not found");
        if (isActive) {
          await this.assertActiveVehicleCategory(tx, fare.vehicleCategoryId);
        }
        await this.lockScope(
          tx,
          fare.vehicleCategoryId,
          fare.rideType,
          fare.scopeKey,
        );
        if (isActive) {
          await this.assertNoOverlap(
            tx,
            {
              vehicleCategoryId: fare.vehicleCategoryId,
              rideType: fare.rideType,
              scopeKey: fare.scopeKey,
              effectiveFrom: fare.effectiveFrom,
              effectiveTo: fare.effectiveTo,
            },
            fare.id,
          );
        }
        const updated = await tx.pricingRule.update({
          where: { id: fareId },
          data: { isActive },
        });
        await this.audit(
          tx,
          actor,
          fareId,
          "ADMIN_FARE_STATUS_UPDATED",
          { isActive: fare.isActive },
          { isActive },
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  history(vehicleCategoryId?: string, rideType?: RideType, scopeKey?: string) {
    return prisma.pricingRule.findMany({
      where: { vehicleCategoryId, rideType, scopeKey },
      include: { createdByAdmin: true },
      orderBy: [
        { vehicleCategoryId: "asc" },
        { rideType: "asc" },
        { scopeKey: "asc" },
        { version: "desc" },
      ],
    });
  }

  preview(input: {
    vehicleCategoryId: string;
    rideType: RideType;
    distanceMeters: number;
    durationSeconds: number;
    waitingMinutes: number;
    tollCharge: number;
  }) {
    return this.pricing.calculate(input);
  }

  private moneyData(input: {
    baseFare: number;
    minimumFare: number;
    perKilometer: number;
    perMinute: number;
    waitingPerMinute: number;
    cancellationFee: number;
    driverAllowance: number;
    platformCommission: number;
    taxPercentage: number;
    nightCharge: number;
  }) {
    return {
      baseFare: new Prisma.Decimal(input.baseFare),
      minimumFare: new Prisma.Decimal(input.minimumFare),
      perKilometer: new Prisma.Decimal(input.perKilometer),
      perMinute: new Prisma.Decimal(input.perMinute),
      waitingPerMinute: new Prisma.Decimal(input.waitingPerMinute),
      cancellationFee: new Prisma.Decimal(input.cancellationFee),
      driverAllowance: new Prisma.Decimal(input.driverAllowance),
      platformCommission: new Prisma.Decimal(input.platformCommission),
      taxPercentage: new Prisma.Decimal(input.taxPercentage),
      nightCharge: new Prisma.Decimal(input.nightCharge),
    };
  }

  private lockScope(
    tx: Prisma.TransactionClient,
    categoryId: string,
    rideType: RideType,
    scopeKey: string,
  ) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fare:${categoryId}:${rideType}:${scopeKey}`}))`;
  }

  private async assertActiveVehicleCategory(
    tx: Prisma.TransactionClient,
    categoryId: string,
  ) {
    const category = await tx.vehicleCategory.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { isActive: true },
    });
    if (!category) throw errors.notFound("Vehicle category not found");
    if (!category.isActive) {
      throw errors.badRequest("Vehicle category is inactive");
    }
  }

  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    input: {
      vehicleCategoryId: string;
      rideType: RideType;
      scopeKey: string;
      effectiveFrom: Date;
      effectiveTo?: Date | null;
    },
    excludeId?: string,
  ) {
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
      throw errors.badRequest("Fare effective end must be after start");
    }
    const overlap = await tx.pricingRule.count({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        vehicleCategoryId: input.vehicleCategoryId,
        rideType: input.rideType,
        scopeKey: input.scopeKey,
        isActive: true,
        effectiveFrom: { lt: input.effectiveTo ?? new Date("9999-12-31") },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: input.effectiveFrom } },
        ],
      },
    });
    if (overlap) {
      throw errors.conflict(
        "An active fare rule overlaps this effective range",
      );
    }
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AdminActionContext,
    fareId: string,
    action: string,
    before: Prisma.InputJsonObject | undefined,
    after: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action,
        entityType: "PricingRule",
        entityId: fareId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        before,
        after,
      },
    });
  }
}
