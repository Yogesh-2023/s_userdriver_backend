import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { errors } from "../../../common/errors";
import { env } from "../../../config/env";
import { prisma } from "../../../database/prisma";
import { queues } from "../../../infrastructure/queues";
import {
  createPrivateDownloadUrl,
  putReportFile,
} from "../../../integrations/storage";
import {
  ACTIVE_BOOKING_STATUSES,
  type AdminActionContext,
} from "../admin.constants";

export class AdminReportService {
  async dashboard(from?: Date, to?: Date) {
    const createdAt = { gte: from, lte: to };
    const [
      customers,
      activeCustomers,
      drivers,
      onlineDrivers,
      availableDrivers,
      vehicles,
      availableVehicles,
      bookings,
      activeBookings,
      completedTrips,
      cancelledTrips,
      bookingValue,
      paymentStats,
      pendingPayments,
      refunds,
      rating,
      verifiedDrivers,
      activeVehicles,
    ] = await Promise.all([
      prisma.customerProfile.count({ where: { createdAt } }),
      prisma.customerProfile.count({
        where: { user: { status: "ACTIVE" }, createdAt },
      }),
      prisma.driverProfile.count({ where: { createdAt } }),
      prisma.driverProfile.count({
        where: { availability: { in: ["ONLINE", "BUSY"] } },
      }),
      prisma.driverProfile.count({ where: { availability: "ONLINE" } }),
      prisma.vehicle.count({ where: { createdAt, deletedAt: null } }),
      prisma.vehicle.count({
        where: {
          status: "ACTIVE",
          verificationStatus: "APPROVED",
          isAvailable: true,
          deletedAt: null,
        },
      }),
      prisma.booking.count({ where: { createdAt } }),
      prisma.booking.count({
        where: { status: { in: [...ACTIVE_BOOKING_STATUSES] } },
      }),
      prisma.trip.count({
        where: { status: "COMPLETED", completedAt: createdAt },
      }),
      prisma.booking.count({ where: { status: "CANCELLED", createdAt } }),
      prisma.booking.aggregate({
        where: {
          status: {
            in: ["TRIP_COMPLETED", "PAYMENT_PENDING", "PAYMENT_COMPLETED"],
          },
          createdAt,
        },
        _sum: { finalFare: true },
        _avg: { finalFare: true },
      }),
      prisma.payment.aggregate({
        where: { status: "CAPTURED", paidAt: createdAt },
        _sum: { amountPaid: true },
        _count: true,
      }),
      prisma.payment.count({
        where: {
          status: { in: ["CREATED", "PENDING", "AUTHORIZED"] },
          createdAt,
        },
      }),
      prisma.refund.aggregate({
        where: { status: "COMPLETED", processedAt: createdAt },
        _sum: { amount: true },
      }),
      prisma.rating.aggregate({ where: { createdAt }, _avg: { score: true } }),
      prisma.driverProfile.count({ where: { verificationStatus: "VERIFIED" } }),
      prisma.vehicle.count({
        where: { status: "ACTIVE", verificationStatus: "APPROVED" },
      }),
    ]);
    const busyDrivers = onlineDrivers - availableDrivers;
    return {
      totalCustomers: customers,
      totalActiveCustomers: activeCustomers,
      totalDrivers: drivers,
      onlineDrivers,
      availableDrivers,
      totalVehicles: vehicles,
      availableVehicles,
      totalBookings: bookings,
      activeBookings,
      completedTrips,
      cancelledTrips,
      grossBookingValue: bookingValue._sum.finalFare ?? new Prisma.Decimal(0),
      successfulPayments: paymentStats._count,
      grossCollectedRevenue:
        paymentStats._sum.amountPaid ?? new Prisma.Decimal(0),
      pendingPayments,
      refundedAmount: refunds._sum.amount ?? new Prisma.Decimal(0),
      averageFare: bookingValue._avg.finalFare ?? new Prisma.Decimal(0),
      averageRating: rating._avg.score ?? 0,
      driverUtilization: verifiedDrivers ? busyDrivers / verifiedDrivers : 0,
      vehicleUtilization: activeVehicles
        ? (activeVehicles - availableVehicles) / activeVehicles
        : 0,
      revenueDefinitions: {
        grossBookingValue: "Sum of final fares for completed trip workflows",
        grossCollectedRevenue: "Captured payment amount before refunds",
        refundedAmount: "Completed refunds",
        settledRevenue:
          "Not available until provider settlement data is integrated",
      },
      timezone: "UTC",
    };
  }

  async report(
    type:
      | "bookings"
      | "trips"
      | "revenue"
      | "customers"
      | "drivers"
      | "vehicles"
      | "cancellations"
      | "payments"
      | "support",
    input: { from?: Date; to?: Date; groupBy: "daily" | "weekly" | "monthly" },
  ) {
    const from = input.from ?? new Date(Date.now() - 30 * 86_400_000);
    const to = input.to ?? new Date();
    if (to <= from) throw errors.badRequest("Invalid report date range");
    const bucket =
      input.groupBy === "weekly"
        ? "week"
        : input.groupBy === "monthly"
          ? "month"
          : "day";
    if (type === "bookings") {
      return prisma.$queryRaw(Prisma.sql`
        SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC') AS "period",
               "status", COUNT(*)::int AS "count",
               COALESCE(SUM("estimatedFare"), 0) AS "estimatedValue"
        FROM "Booking"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1, "status" ORDER BY 1 ASC
      `);
    }
    if (type === "trips") {
      return prisma.$queryRaw(Prisma.sql`
        SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC') AS "period",
               "status", COUNT(*)::int AS "count",
               COALESCE(AVG("actualDistanceMeters"), 0) AS "averageDistanceMeters",
               COALESCE(AVG("actualDurationSeconds"), 0) AS "averageDurationSeconds"
        FROM "Trip"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1, "status" ORDER BY 1 ASC
      `);
    }
    if (type === "revenue") {
      return prisma.$queryRaw(Prisma.sql`
        SELECT date_trunc(${bucket}, p."createdAt" AT TIME ZONE 'UTC') AS "period",
               COALESCE(SUM(p."amountPaid") FILTER (WHERE p."status" = 'CAPTURED'), 0) AS "grossCollected",
               COALESCE(SUM(r."amount"), 0) AS "refunded",
               COALESCE(SUM(p."amountPaid") FILTER (WHERE p."status" = 'CAPTURED'), 0)
                 - COALESCE(SUM(r."amount"), 0) AS "netAfterRefunds"
        FROM "Payment" p
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM("amount"), 0) AS "amount"
          FROM "Refund"
          WHERE "paymentId" = p."id" AND "status" = 'COMPLETED'
        ) r ON true
        WHERE p."createdAt" >= ${from} AND p."createdAt" <= ${to}
        GROUP BY 1 ORDER BY 1 ASC
      `);
    }
    if (type === "customers") {
      return this.countReport("CustomerProfile", bucket, from, to);
    }
    if (type === "drivers") {
      return prisma.$queryRaw(Prisma.sql`
        SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC') AS "period",
               "verificationStatus", COUNT(*)::int AS "count"
        FROM "DriverProfile"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1, "verificationStatus" ORDER BY 1 ASC
      `);
    }
    if (type === "vehicles") {
      return prisma.$queryRaw(Prisma.sql`
        SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC') AS "period",
               "status", "verificationStatus", COUNT(*)::int AS "count"
        FROM "Vehicle"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1, "status", "verificationStatus" ORDER BY 1 ASC
      `);
    }
    if (type === "cancellations") {
      return prisma.$queryRaw(Prisma.sql`
        SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC') AS "period",
               "reasonCode", COUNT(*)::int AS "count", COALESCE(SUM("fee"), 0) AS "fees"
        FROM "BookingCancellation"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1, "reasonCode" ORDER BY 1 ASC
      `);
    }
    if (type === "payments") {
      return prisma.$queryRaw(Prisma.sql`
        SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC') AS "period",
               "status", "method", COUNT(*)::int AS "count",
               COALESCE(SUM("amountPaid"), 0) AS "amountPaid"
        FROM "Payment"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1, "status", "method" ORDER BY 1 ASC
      `);
    }
    return prisma.$queryRaw(Prisma.sql`
      SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC') AS "period",
             "status", "priority", COUNT(*)::int AS "count",
             AVG(EXTRACT(EPOCH FROM ("firstRespondedAt" - "createdAt"))) AS "averageFirstResponseSeconds",
             AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt"))) AS "averageResolutionSeconds"
      FROM "SupportTicket"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1, "status", "priority" ORDER BY 1 ASC
    `);
  }

  async createExport(
    input: {
      type: string;
      format: string;
      from?: Date;
      to?: Date;
      groupBy: string;
    },
    actor: AdminActionContext,
  ) {
    const exportRecord = await prisma.reportExport.create({
      data: {
        requestedByAdminId: actor.adminId,
        type: input.type,
        format: input.format,
        filters: {
          from: input.from?.toISOString(),
          to: input.to?.toISOString(),
          groupBy: input.groupBy,
        },
      },
    });
    await queues.reports.add(
      "export",
      { exportId: exportRecord.id },
      { jobId: `report-export-${exportRecord.id}` },
    );
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ADMIN_REPORT_EXPORT_REQUESTED",
        entityType: "ReportExport",
        entityId: exportRecord.id,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        after: { type: input.type, format: input.format },
      },
    });
    return exportRecord;
  }

  async getExport(exportId: string, adminId: string, isSuperAdmin: boolean) {
    const exportRecord = await prisma.reportExport.findFirst({
      where: {
        id: exportId,
        requestedByAdminId: isSuperAdmin ? undefined : adminId,
      },
    });
    if (!exportRecord) throw errors.notFound("Report export not found");
    if (
      exportRecord.status === "COMPLETED" &&
      exportRecord.fileKey &&
      exportRecord.expiresAt &&
      exportRecord.expiresAt > new Date()
    ) {
      return {
        ...exportRecord,
        downloadUrl: await createPrivateDownloadUrl(exportRecord.fileKey),
      };
    }
    return { ...exportRecord, downloadUrl: null };
  }

  async executeExport(exportId: string) {
    const exportRecord = await prisma.reportExport.findUnique({
      where: { id: exportId },
    });
    if (!exportRecord || exportRecord.status !== "QUEUED") return;
    await prisma.reportExport.update({
      where: { id: exportId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });
    try {
      const filters = exportRecord.filters as {
        from?: string;
        to?: string;
        groupBy?: "daily" | "weekly" | "monthly";
      };
      const rows = (await this.report(exportRecord.type as never, {
        from: filters.from ? new Date(filters.from) : undefined,
        to: filters.to ? new Date(filters.to) : undefined,
        groupBy: filters.groupBy ?? "daily",
      })) as Array<Record<string, unknown>>;
      const csv = this.csv(rows);
      const key = `reports/${exportRecord.requestedByAdminId}/${randomUUID()}.csv`;
      await putReportFile(key, csv);
      await prisma.reportExport.update({
        where: { id: exportId },
        data: {
          status: "COMPLETED",
          fileKey: key,
          rowCount: rows.length,
          completedAt: new Date(),
          expiresAt: new Date(
            Date.now() + env.REPORT_EXPORT_TTL_SECONDS * 1_000,
          ),
        },
      });
    } catch (error) {
      await prisma.reportExport.update({
        where: { id: exportId },
        data: {
          status: "FAILED",
          errorCode: error instanceof Error ? error.name : "EXPORT_ERROR",
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private countReport(
    table: "CustomerProfile",
    bucket: string,
    from: Date,
    to: Date,
  ) {
    const tableName = Prisma.raw(`"${table}"`);
    return prisma.$queryRaw(Prisma.sql`
      SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC') AS "period",
             COUNT(*)::int AS "count"
      FROM ${tableName}
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1 ORDER BY 1 ASC
    `);
  }

  private csv(rows: Array<Record<string, unknown>>) {
    if (!rows.length) return "";
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const escape = (value: unknown) => {
      const normalized =
        value instanceof Date
          ? value.toISOString()
          : typeof value === "bigint"
            ? value.toString()
            : typeof value === "object"
              ? value === null
                ? ""
                : (JSON.stringify(value) ?? "")
              : typeof value === "string" ||
                  typeof value === "number" ||
                  typeof value === "boolean"
                ? String(value)
                : "";
      return `"${normalized.replaceAll('"', '""')}"`;
    };
    return [
      headers.map(escape).join(","),
      ...rows.map((row) => headers.map((key) => escape(row[key])).join(",")),
    ].join("\n");
  }
}
