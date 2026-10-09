import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import {
  REALTIME_TTL,
  redisKeys,
  ACTIVE_TRIP_STATUSES,
} from "../../../realtime/socket.constants";

/* ─── shared filter types ─── */
export interface DashboardFilter {
  dateFrom?: Date;
  dateTo?: Date;
  timezone?: string;
  serviceAreaId?: string;
  categoryId?: string;
  bookingType?: "IMMEDIATE" | "SCHEDULED";
}

export interface OverviewFilter extends DashboardFilter {
  groupBy: "hour" | "day" | "week" | "month" | "year";
  period?: "day" | "week" | "month" | "year";
}

export interface TopVehiclesFilter extends DashboardFilter {
  limit: number;
  metric: "bookings" | "revenue" | "completedTrips" | "utilization" | "rating";
}

export interface RecentBookingsFilter extends DashboardFilter {
  limit: number;
  status?: string;
}

export interface DriverPerformanceFilter extends DashboardFilter {
  limit: number;
  sortBy:
    | "completedTrips"
    | "earnings"
    | "rating"
    | "acceptanceRate"
    | "completionRate"
    | "onlineHours";
}

/* ─── helpers ─── */

function filterHash(obj: object): string {
  return createHash("md5")
    .update(JSON.stringify(obj))
    .digest("hex")
    .slice(0, 16);
}

async function cached<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const result = await fn();
  await redis.set(key, JSON.stringify(result), "EX", ttl);
  return result;
}

function safePercent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function safeChange(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const duration = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - duration),
    to: new Date(from.getTime()),
  };
}

function comparisonLabel(groupBy: OverviewFilter["groupBy"]): string {
  switch (groupBy) {
    case "hour":
    case "day":
      return "vs yesterday";
    case "week":
      return "vs last week";
    case "month":
      return "vs last month";
    case "year":
      return "vs last year";
    default:
      return "vs previous period";
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function startOfUtcWeek(date: Date): Date {
  const day = date.getUTCDay() || 7;
  const start = startOfUtcDay(date);
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start;
}

function resolveRevenueFilter(filter: OverviewFilter): {
  from: Date;
  to: Date;
  groupBy: OverviewFilter["groupBy"];
  period: "day" | "week" | "month" | "year" | OverviewFilter["groupBy"];
} {
  const now = new Date();

  if (filter.dateFrom || filter.dateTo) {
    return {
      from: filter.dateFrom ?? new Date(Date.now() - 30 * 86_400_000),
      to: filter.dateTo ?? now,
      groupBy: filter.groupBy,
      period: filter.period ?? filter.groupBy,
    };
  }

  switch (filter.period) {
    case "day":
      return {
        from: startOfUtcDay(now),
        to: now,
        groupBy: "hour",
        period: "day",
      };
    case "week":
      return {
        from: startOfUtcWeek(now),
        to: now,
        groupBy: "day",
        period: "week",
      };
    case "year":
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
        to: now,
        groupBy: "month",
        period: "year",
      };
    case "month":
    default:
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        to: now,
        groupBy: "day",
        period: "month",
      };
  }
}

function bookingDateRange(filter: DashboardFilter) {
  return {
    gte: filter.dateFrom,
    lte: filter.dateTo,
  };
}

function pgBucket(groupBy: string): string {
  switch (groupBy) {
    case "hour":
      return "hour";
    case "week":
      return "week";
    case "month":
      return "month";
    case "year":
      return "year";
    default:
      return "day";
  }
}

/* ─── service ─── */

export class AdminDashboardService {
  /* ════════════════════════════════════════════════════════════
     1.  COMBINED — runs all sections in parallel
  ═══════════════════════════════════════════════════════════ */
  async combined(filter: DashboardFilter) {
    const overviewFilter: OverviewFilter = { ...filter, groupBy: "day" };
    const now = new Date();

    const [
      summary,
      bookingOverview,
      bookingStatus,
      topVehicles,
      revenueOverview,
      recentBookings,
      driverPerformance,
      liveOps,
      alerts,
    ] = await Promise.allSettled([
      this.summary(filter),
      this.bookingOverview(overviewFilter),
      this.bookingStatus(filter),
      this.topVehicles({ ...filter, limit: 5, metric: "bookings" }),
      this.revenueOverview(overviewFilter),
      this.recentBookings({ limit: 10 }),
      this.driverPerformance({
        ...filter,
        limit: 10,
        sortBy: "completedTrips",
      }),
      this.liveOperations(),
      this.alerts(5),
    ]);

    const unwrap = <T>(r: PromiseSettledResult<T>) =>
      r.status === "fulfilled" ? r.value : null;

    return {
      summary: unwrap(summary),
      bookingOverview: unwrap(bookingOverview),
      bookingStatus: unwrap(bookingStatus),
      topVehicles: unwrap(topVehicles),
      revenueOverview: unwrap(revenueOverview),
      recentBookings: unwrap(recentBookings),
      driverPerformance: unwrap(driverPerformance),
      liveOperations: unwrap(liveOps),
      alerts: unwrap(alerts),
      meta: {
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        timezone: filter.timezone ?? "UTC",
        currency: "INR",
        generatedAt: now,
      },
    };
  }

  /* ════════════════════════════════════════════════════════════
     2.  SUMMARY CARD
  ═══════════════════════════════════════════════════════════ */
  async summary(filter: DashboardFilter) {
    const hash = filterHash(filter);
    const key = redisKeys.adminDashboardSummary(hash);
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const createdAt = bookingDateRange(filter);
      const prev =
        filter.dateFrom && filter.dateTo
          ? previousRange(filter.dateFrom, filter.dateTo)
          : null;

      const bookingWhere: Prisma.BookingWhereInput = {
        createdAt,
        ...(filter.categoryId ? { vehicleCategoryId: filter.categoryId } : {}),
        ...(filter.bookingType ? { type: filter.bookingType } : {}),
      };

      const [
        /* revenue */
        captured,
        refunded,
        cashPayments,
        pendingPayments,
        /* bookings */
        totalBookings,
        completedBookings,
        cancelledBookings,
        noDriverBookings,
        immediateBookings,
        scheduledBookings,
        /* prev period bookings */
        prevTotalBookings,
        /* drivers */
        totalRegisteredDrivers,
        approvedDrivers,
        suspendedDrivers,
        /* prev period revenue */
        prevCaptured,
        prevRefunded,
        /* customers */
        totalCustomers,
        newCustomers,
        repeatCustomers,
        blockedCustomers,
        prevTotalCustomers,
        /* active drivers for change percentage */
        newActiveDrivers,
        prevNewActiveDrivers,
      ] = await Promise.all([
        /* captured payments (gross revenue) */
        prisma.payment.aggregate({
          where: { status: "CAPTURED", createdAt },
          _sum: { amountPaid: true },
        }),
        /* successful refunds */
        prisma.refund.aggregate({
          where: { status: "COMPLETED", processedAt: createdAt },
          _sum: { amount: true },
        }),
        /* cash payments */
        prisma.payment.aggregate({
          where: { status: "CAPTURED", method: "CASH", createdAt },
          _sum: { amountPaid: true },
        }),
        /* pending payments */
        prisma.payment.count({
          where: {
            status: { in: ["CREATED", "PENDING", "AUTHORIZED"] },
            createdAt,
          },
        }),
        /* booking counts */
        prisma.booking.count({ where: bookingWhere }),
        prisma.booking.count({
          where: { ...bookingWhere, status: "TRIP_COMPLETED" },
        }),
        prisma.booking.count({
          where: { ...bookingWhere, status: "CANCELLED" },
        }),
        prisma.booking.count({
          where: { ...bookingWhere, status: "NO_DRIVER_FOUND" },
        }),
        prisma.booking.count({ where: { ...bookingWhere, type: "IMMEDIATE" } }),
        prisma.booking.count({ where: { ...bookingWhere, type: "SCHEDULED" } }),
        /* prev period */
        prev
          ? prisma.booking.count({
              where: { createdAt: { gte: prev.from, lte: prev.to } },
            })
          : Promise.resolve(0),
        /* drivers */
        prisma.driverProfile.count(),
        prisma.driverProfile.count({
          where: { verificationStatus: "VERIFIED" },
        }),
        prisma.driverProfile.count({
          where: { user: { status: "SUSPENDED" } },
        }),
        /* prev revenue */
        prev
          ? prisma.payment.aggregate({
              where: {
                status: "CAPTURED",
                createdAt: { gte: prev.from, lte: prev.to },
              },
              _sum: { amountPaid: true },
            })
          : Promise.resolve({ _sum: { amountPaid: null } }),
        prev
          ? prisma.refund.aggregate({
              where: {
                status: "COMPLETED",
                processedAt: { gte: prev.from, lte: prev.to },
              },
              _sum: { amount: true },
            })
          : Promise.resolve({ _sum: { amount: new Prisma.Decimal(0) } }),
        /* customers */
        prisma.customerProfile.count(),
        prisma.customerProfile.count({ where: { createdAt } }),
        prisma
          .$queryRaw<[{ count: bigint }]>(
            Prisma.sql`
          SELECT COUNT(DISTINCT "customerId")::bigint AS count
          FROM "Booking"
          WHERE status = 'TRIP_COMPLETED'
          GROUP BY "customerId"
          HAVING COUNT(*) > 1
        `,
          )
          .then((r) => r.length),
        prisma.customerProfile.count({
          where: { user: { status: "BLOCKED" } },
        }),
        prev
          ? prisma.customerProfile.count({
              where: { createdAt: { gte: prev.from, lte: prev.to } },
            })
          : Promise.resolve(0),
        /* active drivers for change percentage */
        prisma.driverProfile.count({
          where: { verificationStatus: "VERIFIED", createdAt },
        }),
        prev
          ? prisma.driverProfile.count({
              where: { verificationStatus: "VERIFIED", createdAt: { gte: prev.from, lte: prev.to } },
            })
          : Promise.resolve(0),
      ]);

      /* Redis for realtime driver counts */
      const [onlineCount, busyCount] = await Promise.all([
        redis.scard(redisKeys.globalOnlineDrivers),
        redis.scard(redisKeys.globalBusyDrivers),
      ]);

      const grossRevenue = captured._sum.amountPaid ?? new Prisma.Decimal(0);
      const refundedAmount = refunded._sum.amount ?? new Prisma.Decimal(0);
      const netRevenue = new Prisma.Decimal(grossRevenue).minus(refundedAmount);
      const onlineCollected = new Prisma.Decimal(grossRevenue).minus(
        cashPayments._sum.amountPaid ?? new Prisma.Decimal(0),
      );
      const cashCollected =
        cashPayments._sum.amountPaid ?? new Prisma.Decimal(0);

      const prevGross = prevCaptured._sum.amountPaid ?? new Prisma.Decimal(0);
      const prevRefund = prevRefunded._sum.amount ?? new Prisma.Decimal(0);
      const prevNet = new Prisma.Decimal(prevGross).minus(prevRefund);

      const activeBookings = await prisma.booking.count({
        where: {
          status: {
            in: [
              "DRIVER_ASSIGNED",
              "DRIVER_ARRIVING",
              "DRIVER_ARRIVED",
              "TRIP_STARTED",
              "SEARCHING_DRIVER",
            ],
          },
          ...(filter.categoryId
            ? { vehicleCategoryId: filter.categoryId }
            : {}),
        },
      });

      let comparisonLabel = "vs previous period";
      if (filter.dateFrom && filter.dateTo) {
        const days = Math.round((filter.dateTo.getTime() - filter.dateFrom.getTime()) / 86400000);
        if (days === 1) comparisonLabel = "vs yesterday";
        else if (days === 7) comparisonLabel = "vs last week";
        else if (days >= 28 && days <= 31) comparisonLabel = "vs last month";
        else if (days === 365 || days === 366) comparisonLabel = "vs last year";
        else comparisonLabel = `vs previous ${days} days`;
      }

      return {
        comparisonLabel,
        totalRevenue: {
          grossRevenue: grossRevenue.toFixed(2),
          netRevenue: netRevenue.toFixed(2),
          refundedAmount: refundedAmount.toFixed(2),
          cashCollected: cashCollected.toFixed(2),
          onlineCollected: onlineCollected.toFixed(2),
          pendingPayments,
          currency: "INR",
          changePercentage: safeChange(Number(netRevenue), Number(prevNet)),
        },
        totalBookings: {
          totalBookings,
          immediateBookings,
          scheduledBookings,
          completedBookings,
          cancelledBookings,
          activeBookings,
          noDriverFoundBookings: noDriverBookings,
          changePercentage: safeChange(totalBookings, prevTotalBookings),
        },
        activeDrivers: {
          totalRegisteredDrivers,
          approvedDrivers,
          onlineDrivers: onlineCount,
          availableDrivers: Math.max(0, onlineCount - busyCount),
          busyDrivers: busyCount,
          suspendedDrivers,
          offlineDrivers: Math.max(
            0,
            approvedDrivers - onlineCount - busyCount,
          ),
          changePercentage: safeChange(newActiveDrivers, prevNewActiveDrivers),
        },
        totalCustomers: {
          totalCustomers,
          newCustomers,
          repeatCustomers,
          blockedCustomers,
          changePercentage: safeChange(newCustomers, prevTotalCustomers),
        },
      };
    });
  }

  /* ════════════════════════════════════════════════════════════
     3.  BOOKING OVERVIEW — time series
  ═══════════════════════════════════════════════════════════ */
  async bookingOverview(filter: OverviewFilter) {
    const hash = filterHash(filter);
    const key = redisKeys.adminDashboardBookingOverview(hash);
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const resolved = resolveRevenueFilter(filter);
      const bucket = pgBucket(resolved.groupBy);
      const { from, to } = resolved;
      const tz = filter.timezone ?? "UTC";

      const intervalMap: Record<string, string> = {
        hour: "1 hour",
        day: "1 day",
        week: "1 week",
        month: "1 month",
        year: "1 year",
      };
      const interval = intervalMap[resolved.groupBy] || "1 day";

      // 1. Generate all required date buckets to ensure 0s are rendered for missing data
      const buckets = await prisma.$queryRaw<Array<{ label: string }>>(Prisma.sql`
        SELECT to_char(generate_series(
          date_trunc(${bucket}, ${from}::timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${tz}),
          date_trunc(${bucket}, ${to}::timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${tz}),
          ${interval}::interval
        ), 'YYYY-MM-DD HH24:MI') AS label
      `);

      // 2. Initialize map with all generated buckets
      const map = new Map<string, { completed: number; cancelled: number }>();
      for (const b of buckets) {
        map.set(b.label, { completed: 0, cancelled: 0 });
      }

      // 3. Fetch actual data
      const rows = await prisma.$queryRaw<
        Array<{ label: string; status: string; count: bigint }>
      >(Prisma.sql`
        SELECT
          to_char(date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), 'YYYY-MM-DD HH24:MI') AS label,
          "status",
          COUNT(*)::bigint AS count
        FROM "Booking"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          ${filter.categoryId ? Prisma.sql`AND "vehicleCategoryId" = ${filter.categoryId}::uuid` : Prisma.empty}
        GROUP BY 1, "status"
        ORDER BY 1 ASC
      `);

      /* 4. Consolidate into completed / cancelled per period */
      for (const row of rows) {
        const entry = map.get(row.label);
        if (!entry) continue; // Skip if somehow outside range, though query filters it

        if (row.status === "TRIP_COMPLETED" || row.status === "PAYMENT_COMPLETED") {
          entry.completed += Number(row.count);
        }
        if (row.status === "CANCELLED") {
          entry.cancelled += Number(row.count);
        }
      }

      const series = [...map.entries()].map(([label, v]) => ({
        label,
        ...v,
      }));

      const totals = series.reduce(
        (acc, s) => ({
          completed: acc.completed + s.completed,
          cancelled: acc.cancelled + s.cancelled,
        }),
        { completed: 0, cancelled: 0 },
      );

      return { groupBy: filter.groupBy, series, totals };
    });
  }

  /* ════════════════════════════════════════════════════════════
     4.  BOOKING STATUS BREAKDOWN
  ═══════════════════════════════════════════════════════════ */
  async bookingStatus(filter: DashboardFilter) {
    const hash = filterHash(filter);
    const key = redisKeys.adminDashboardBookingStatus(hash);
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const createdAt = bookingDateRange(filter);
      const rows = await prisma.booking.groupBy({
        by: ["status"],
        where: {
          createdAt,
          ...(filter.categoryId
            ? { vehicleCategoryId: filter.categoryId }
            : {}),
        },
        _count: { _all: true },
        orderBy: { _count: { status: "desc" } },
      });

      const total = rows.reduce((s, r) => s + r._count._all, 0);
      const statuses = rows.map((r) => ({
        status: r.status,
        count: r._count._all,
        percentage: safePercent(r._count._all, total),
      }));

      return { total, statuses };
    });
  }

  /* ════════════════════════════════════════════════════════════
     5.  TOP VEHICLES (by category)
  ═══════════════════════════════════════════════════════════ */
  async topVehicles(filter: TopVehiclesFilter) {
    const hash = filterHash(filter);
    const key = redisKeys.adminDashboardTopVehicles(hash);
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const from = filter.dateFrom ?? new Date(Date.now() - 30 * 86_400_000);
      const to = filter.dateTo ?? new Date();

      const rows = await prisma.$queryRaw<
        Array<{
          categoryId: string;
          categoryName: string;
          categoryImageUrl: string | null;
          totalBookings: bigint;
          completedTrips: bigint;
          cancelledBookings: bigint;
          grossRevenue: string;
        }>
      >(Prisma.sql`
        SELECT
          vc.id AS "categoryId",
          vc.name AS "categoryName",
          vc."imageUrl" AS "categoryImageUrl",
          COUNT(b.id)::bigint AS "totalBookings",
          COUNT(b.id) FILTER (WHERE b.status = 'TRIP_COMPLETED')::bigint AS "completedTrips",
          COUNT(b.id) FILTER (WHERE b.status = 'CANCELLED')::bigint AS "cancelledBookings",
          COALESCE(SUM(p."amountPaid") FILTER (WHERE p.status = 'CAPTURED'), 0)::text AS "grossRevenue"
        FROM "VehicleCategory" vc
        LEFT JOIN "Booking" b
          ON b."vehicleCategoryId" = vc.id
          AND b."createdAt" >= ${from} AND b."createdAt" <= ${to}
        LEFT JOIN "Payment" p ON p."bookingId" = b.id
        WHERE vc."isActive" = true
        GROUP BY vc.id, vc.name, vc."imageUrl"
        ORDER BY "totalBookings" DESC
        LIMIT ${filter.limit}
      `);

      return rows.map((r, i) => ({
        rank: i + 1,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        categoryImageUrl: r.categoryImageUrl,
        totalBookings: Number(r.totalBookings),
        completedTrips: Number(r.completedTrips),
        cancelledBookings: Number(r.cancelledBookings),
        grossRevenue: r.grossRevenue,
        averageFare:
          Number(r.completedTrips) > 0
            ? (parseFloat(r.grossRevenue) / Number(r.completedTrips)).toFixed(2)
            : "0.00",
      }));
    });
  }

  /* ════════════════════════════════════════════════════════════
     6.  REVENUE OVERVIEW — time series
  ═══════════════════════════════════════════════════════════ */
  async revenueOverview(filter: OverviewFilter) {
    const hash = filterHash(filter);
    const key = redisKeys.adminDashboardRevenueOverview(hash);
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const resolved = resolveRevenueFilter(filter);
      const bucket = pgBucket(resolved.groupBy);
      const { from, to } = resolved;
      const tz = filter.timezone ?? "UTC";
      const prev = previousRange(from, to);

      type RevenueRow = {
        label: string;
        grossRevenue: string;
        refunds: string;
      };

      const revenueRows = (rangeFrom: Date, rangeTo: Date) =>
        prisma.$queryRaw<Array<RevenueRow>>(Prisma.sql`
        SELECT
          to_char(date_trunc(${bucket}, p."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), 'YYYY-MM-DD HH24:MI') AS label,
          COALESCE(SUM(p."amountPaid") FILTER (WHERE p.status = 'CAPTURED'), 0)::text AS "grossRevenue",
          COALESCE(SUM(r."amount") FILTER (WHERE r.status = 'COMPLETED'), 0)::text AS "refunds"
        FROM "Payment" p
        LEFT JOIN "Refund" r ON r."paymentId" = p.id
        WHERE p."createdAt" >= ${rangeFrom} AND p."createdAt" <= ${rangeTo}
        GROUP BY 1
        ORDER BY 1 ASC
      `);

      const [rows, previousRows] = await Promise.all([
        revenueRows(from, to),
        revenueRows(prev.from, prev.to),
      ]);

      const series = rows.map((r) => ({
        label: r.label,
        grossRevenue: r.grossRevenue,
        netRevenue: (
          parseFloat(r.grossRevenue) - parseFloat(r.refunds)
        ).toFixed(2),
        refunds: r.refunds,
      }));

      const totals = series.reduce(
        (acc, s) => ({
          grossRevenue: (
            parseFloat(acc.grossRevenue) + parseFloat(s.grossRevenue)
          ).toFixed(2),
          netRevenue: (
            parseFloat(acc.netRevenue) + parseFloat(s.netRevenue)
          ).toFixed(2),
          refunds: (parseFloat(acc.refunds) + parseFloat(s.refunds)).toFixed(2),
        }),
        { grossRevenue: "0.00", netRevenue: "0.00", refunds: "0.00" },
      );

      const previousTotals = previousRows.reduce(
        (acc, r) => {
          const netRevenue = parseFloat(r.grossRevenue) - parseFloat(r.refunds);
          return {
            grossRevenue: (
              parseFloat(acc.grossRevenue) + parseFloat(r.grossRevenue)
            ).toFixed(2),
            netRevenue: (parseFloat(acc.netRevenue) + netRevenue).toFixed(2),
            refunds: (parseFloat(acc.refunds) + parseFloat(r.refunds)).toFixed(
              2,
            ),
          };
        },
        { grossRevenue: "0.00", netRevenue: "0.00", refunds: "0.00" },
      );

      return {
        groupBy: resolved.groupBy,
        currency: "INR",
        period: { from, to },
        previousPeriod: { from: prev.from, to: prev.to },
        series,
        totals,
        previousTotals,
        comparison: {
          percentage: safeChange(
            parseFloat(totals.netRevenue),
            parseFloat(previousTotals.netRevenue),
          ),
          label:
            resolved.period === "day"
              ? "vs yesterday"
              : comparisonLabel(resolved.period),
        },
      };
    });
  }

  /* ════════════════════════════════════════════════════════════
     7.  RECENT BOOKINGS
  ═══════════════════════════════════════════════════════════ */
  async recentBookings(filter: RecentBookingsFilter) {
    const bookings = await prisma.booking.findMany({
      where: {
        createdAt: bookingDateRange(filter),
        ...(filter.status ? { status: filter.status as never } : {}),
        ...(filter.categoryId ? { vehicleCategoryId: filter.categoryId } : {}),
        ...(filter.bookingType ? { type: filter.bookingType } : {}),
      },
      include: {
        customer: {
          include: {
            user: { select: { displayName: true, phone: true } },
          },
        },
        dispatchOffers: {
          where: { status: "ACCEPTED" },
          include: {
            driver: {
              include: { user: { select: { displayName: true, phone: true } } },
            },
            vehicle: {
              select: { registrationNo: true, categoryId: true },
            },
          },
          take: 1,
        },
        trip: {
          select: { startedAt: true, completedAt: true },
        },
        payments: {
          select: { status: true, amountPaid: true, method: true },
          take: 1,
          orderBy: { createdAt: "desc" as const },
        },
      },
      orderBy: { createdAt: "desc" },
      take: filter.limit,
    });

    return bookings.map((b) => {
      const offer = b.dispatchOffers[0];
      const phone = b.customer.user.phone;
      return {
        bookingId: b.id,
        customer: {
          name:
            b.customer.user.displayName ||
            (phone ? `Customer (${phone})` : "Unknown Customer"),
          /* mask middle digits: +91 98765XXXXX */
          phoneMasked: phone
            ? phone.slice(0, -5).replace(/\d(?=.)/g, "*") + phone.slice(-2)
            : null,
        },
        driver: offer
          ? {
              name:
                offer.driver.user.displayName ||
                (offer.driver.user.phone
                  ? `Driver (${offer.driver.user.phone})`
                  : "Unknown Driver"),
            }
          : null,
        vehicleCategory: offer?.vehicle.categoryId ?? b.vehicleCategoryId,
        pickupAddress: b.pickupAddress,
        dropAddress: b.dropAddress,
        bookingType: b.type,
        bookingStatus: b.status,
        paymentStatus: b.payments[0]?.status ?? null,
        fare: b.finalFare?.toFixed(2) ?? b.estimatedFare.toFixed(2),
        createdAt: b.createdAt,
        scheduledAt: b.scheduledAt,
        tripStartedAt: b.trip?.startedAt ?? null,
        tripCompletedAt: b.trip?.completedAt ?? null,
      };
    });
  }

  /* ════════════════════════════════════════════════════════════
     8.  DRIVER PERFORMANCE
  ═══════════════════════════════════════════════════════════ */
  async driverPerformance(filter: DriverPerformanceFilter) {
    const hash = filterHash(filter);
    const key = redisKeys.adminDashboardDriverPerformance(hash);
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const from = filter.dateFrom ?? new Date(Date.now() - 30 * 86_400_000);
      const to = filter.dateTo ?? new Date();

      const orderMap: Record<string, string> = {
        completedTrips: '"completedTrips" DESC',
        earnings: '"grossEarnings" DESC',
        rating: '"averageRating" DESC NULLS LAST',
        acceptanceRate: '"acceptanceRate" DESC',
        completionRate: '"completionRate" DESC',
        onlineHours: '"onlineHours" DESC',
      };
      const orderClause = Prisma.raw(
        orderMap[filter.sortBy] ?? '"completedTrips" DESC',
      );

      const rows = await prisma.$queryRaw<
        Array<{
          driverId: string;
          fullName: string | null;
          profileImageUrl: string | null;
          completedTrips: bigint;
          cancelledTrips: bigint;
          acceptedOffers: bigint;
          totalOffers: bigint;
          averageRating: string | null;
          grossEarnings: string;
        }>
      >(Prisma.sql`
        SELECT
          dp.id AS "driverId",
          u."displayName" AS "fullName",
          dp."profileImageUrl",
          COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::bigint AS "completedTrips",
          COUNT(t.id) FILTER (WHERE t.status = 'CANCELLED')::bigint AS "cancelledTrips",
          COUNT(dof.id) FILTER (WHERE dof.status = 'ACCEPTED')::bigint AS "acceptedOffers",
          COUNT(dof.id) FILTER (WHERE dof.status IN ('ACCEPTED','REJECTED','EXPIRED'))::bigint AS "totalOffers",
          AVG(r.score)::text AS "averageRating",
          COALESCE(SUM(de."grossFare") FILTER (WHERE de."createdAt" >= ${from} AND de."createdAt" <= ${to}), 0)::text AS "grossEarnings"
        FROM "DriverProfile" dp
        JOIN "User" u ON u.id = dp."userId"
        LEFT JOIN "Trip" t
          ON t."driverId" = dp.id
          AND t."createdAt" >= ${from} AND t."createdAt" <= ${to}
        LEFT JOIN "DispatchOffer" dof
          ON dof."driverId" = dp.id
          AND dof."createdAt" >= ${from} AND dof."createdAt" <= ${to}
        LEFT JOIN "Rating" r ON r."subjectUserId" = dp."userId" AND r."subjectType" = 'DRIVER'
        LEFT JOIN "DriverEarning" de ON de."driverId" = dp.id
        WHERE dp."verificationStatus" = 'VERIFIED'
        GROUP BY dp.id, u."displayName", dp."profileImageUrl"
        ORDER BY ${orderClause}
        LIMIT ${filter.limit}
      `);

      return rows.map((r, i) => {
        const completed = Number(r.completedTrips);
        const accepted = Number(r.acceptedOffers);
        const total = Number(r.totalOffers);
        const acceptanceRate = safePercent(accepted, total);
        const completionRate = safePercent(completed, accepted);

        return {
          rank: i + 1,
          driverId: r.driverId,
          fullName: r.fullName,
          profileImageUrl: r.profileImageUrl,
          completedTrips: completed,
          cancelledTrips: Number(r.cancelledTrips),
          acceptedOffers: accepted,
          rejectedOffers: total - accepted,
          acceptanceRate,
          completionRate,
          averageRating: r.averageRating
            ? parseFloat(r.averageRating).toFixed(1)
            : null,
          grossEarnings: r.grossEarnings,
        };
      });
    });
  }

  /* ════════════════════════════════════════════════════════════
     9.  LIVE OPERATIONS
  ═══════════════════════════════════════════════════════════ */
  async liveOperations() {
    const now = new Date();

    const [
      onlineCount,
      busyCount,
      activeTrips,
      searchingBookings,
      assignedBookings,
      arrivingBookings,
      arrivedBookings,
      scheduledDueSoon,
      failedPayments,
      urgentTickets,
      openSos,
      attentionRequired,
    ] = await Promise.all([
      redis.scard(redisKeys.globalOnlineDrivers),
      redis.scard(redisKeys.globalBusyDrivers),
      prisma.trip.count({
        where: { status: { in: [...ACTIVE_TRIP_STATUSES] } },
      }),
      prisma.booking.count({ where: { status: "SEARCHING_DRIVER" } }),
      prisma.booking.count({ where: { status: "DRIVER_ASSIGNED" } }),
      prisma.booking.count({ where: { status: "DRIVER_ARRIVING" } }),
      prisma.booking.count({ where: { status: "DRIVER_ARRIVED" } }),
      prisma.scheduledBooking.count({
        where: {
          scheduledAt: {
            gte: now,
            lte: new Date(now.getTime() + 60 * 60_000),
          },
          booking: { status: "PENDING" },
        },
      }),
      prisma.payment.count({
        where: {
          status: "FAILED",
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
        },
      }),
      prisma.supportTicket.count({
        where: {
          priority: "URGENT",
          status: {
            in: ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "ESCALATED"],
          },
        },
      }),
      prisma.sosRequest.count({ where: { status: "OPEN" } }),
      /* Note: ATTENTION_REQUIRED is not in BookingStatus enum, use 0 as placeholder */
      Promise.resolve(0),
    ]);

    return {
      availableDrivers: Math.max(0, onlineCount - busyCount),
      busyDrivers: busyCount,
      onlineDrivers: onlineCount,
      activeTrips,
      searchingBookings,
      assignedBookings,
      driversArriving: arrivingBookings,
      driversArrived: arrivedBookings,
      scheduledRidesDueSoon: scheduledDueSoon,
      paymentFailuresLast24h: failedPayments,
      openUrgentTickets: urgentTickets,
      activeSosCases: openSos,
      attentionRequiredBookings: attentionRequired,
      timestamp: now,
    };
  }

  /* ════════════════════════════════════════════════════════════
     10.  ALERTS
  ═══════════════════════════════════════════════════════════ */
  async alerts(limit: number) {
    const now = new Date();

    const [sos, payments, expiringDocs, urgentTickets] = await Promise.all([
      prisma.sosRequest.findMany({
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.payment.findMany({
        where: {
          status: "FAILED",
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.vehicleDocument.findMany({
        where: {
          expiresAt: {
            gte: now,
            lte: new Date(now.getTime() + 30 * 86_400_000),
          },
        },
        include: { vehicle: { select: { id: true, registrationNo: true } } },
        orderBy: { expiresAt: "asc" },
        take: limit,
      }),
      prisma.supportTicket.findMany({
        where: {
          priority: "URGENT",
          status: { in: ["OPEN", "IN_PROGRESS", "ESCALATED"] },
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      }),
    ]);

    const unified: Array<{
      id: string;
      type: string;
      severity: "critical" | "high" | "medium" | "low";
      title: string;
      message: string;
      entityType: string;
      entityId: string;
      createdAt: Date;
    }> = [];

    for (const s of sos) {
      unified.push({
        id: s.id,
        type: "ACTIVE_SOS",
        severity: "critical",
        title: "Active SOS Request",
        message: `SOS request opened by user ${s.createdByUserId}`,
        entityType: "SosRequest",
        entityId: s.id,
        createdAt: s.createdAt,
      });
    }

    for (const p of payments) {
      unified.push({
        id: p.id,
        type: "PAYMENT_FAILED",
        severity: "high",
        title: "Payment Failed",
        message: `Payment of ₹${p.amount.toString()} failed for booking ${p.bookingId}`,
        entityType: "Payment",
        entityId: p.id,
        createdAt: p.createdAt,
      });
    }

    for (const d of expiringDocs) {
      unified.push({
        id: d.id,
        type: "VEHICLE_DOCUMENT_EXPIRED",
        severity: "medium",
        title: "Vehicle Document Expiring",
        message: `Document for vehicle ${d.vehicle.registrationNo} expires on ${d.expiresAt?.toDateString()}`,
        entityType: "VehicleDocument",
        entityId: d.id,
        createdAt: now,
      });
    }

    for (const t of urgentTickets) {
      unified.push({
        id: t.id,
        type: "URGENT_SUPPORT_TICKET",
        severity: "high",
        title: "Urgent Support Ticket",
        message: t.subject,
        entityType: "SupportTicket",
        entityId: t.id,
        createdAt: t.createdAt,
      });
    }

    return unified
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async counts(filter: DashboardFilter = {}) {
    const key = `admin:dashboard:counts:${filterHash(filter)}`;
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const createdAt = bookingDateRange(filter);
      const driverWhere: Prisma.DriverProfileWhereInput = { createdAt };
      const customerWhere: Prisma.CustomerProfileWhereInput = { createdAt };
      const bookingWhere: Prisma.BookingWhereInput = {
        createdAt,
        ...(filter.categoryId ? { vehicleCategoryId: filter.categoryId } : {}),
        ...(filter.bookingType ? { type: filter.bookingType } : {}),
      };
      const tripWhere: Prisma.TripWhereInput = { createdAt };
      const vehicleWhere: Prisma.VehicleWhereInput = {
        createdAt,
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      };

      const [
        driversTotal,
        activeDrivers,
        onTripDrivers,
        pendingDrivers,
        suspendedDrivers,
        customersTotal,
        activeCustomers,
        inactiveCustomers,
        bookingsTotal,
        completedBookings,
        inProgressBookings,
        cancelledBookings,
        noShowBookings,
        tripsTotal,
        completedTrips,
        cancelledTrips,
        vehiclesTotal,
      ] = await Promise.all([
        prisma.driverProfile.count({ where: driverWhere }),
        prisma.driverProfile.count({
          where: { ...driverWhere, verificationStatus: "VERIFIED" },
        }),
        prisma.driverProfile.count({
          where: {
            ...driverWhere,
            availability: "BUSY",
          },
        }),
        prisma.driverProfile.count({
          where: { ...driverWhere, verificationStatus: { not: "VERIFIED" } },
        }),
        prisma.driverProfile.count({
          where: { ...driverWhere, user: { status: "SUSPENDED" } },
        }),
        prisma.customerProfile.count({ where: customerWhere }),
        prisma.customerProfile.count({
          where: { ...customerWhere, user: { status: "ACTIVE" } },
        }),
        prisma.customerProfile.count({
          where: { ...customerWhere, user: { status: { not: "ACTIVE" } } },
        }),
        prisma.booking.count({ where: bookingWhere }),
        prisma.booking.count({
          where: { ...bookingWhere, status: "TRIP_COMPLETED" },
        }),
        prisma.booking.count({
          where: {
            ...bookingWhere,
            status: {
              in: [
                "SEARCHING_DRIVER",
                "DRIVER_ASSIGNED",
                "DRIVER_ARRIVING",
                "DRIVER_ARRIVED",
                "TRIP_STARTED",
              ],
            },
          },
        }),
        prisma.booking.count({
          where: { ...bookingWhere, status: "CANCELLED" },
        }),
        prisma.booking.count({
          where: { ...bookingWhere, status: "NO_DRIVER_FOUND" },
        }),
        prisma.trip.count({ where: tripWhere }),
        prisma.trip.count({ where: { ...tripWhere, status: "COMPLETED" } }),
        prisma.trip.count({ where: { ...tripWhere, status: "CANCELLED" } }),
        prisma.vehicle.count({ where: vehicleWhere }),
      ]);

      return {
        driversCount: {
          total: driversTotal,
          active: activeDrivers,
          offline: Math.max(0, activeDrivers - onTripDrivers),
          onTrip: onTripDrivers,
          pending: pendingDrivers,
          suspended: suspendedDrivers,
        },
        customersCount: {
          total: customersTotal,
          active: activeCustomers,
          inactive: inactiveCustomers,
        },
        bookingsCount: {
          total: bookingsTotal,
          completed: completedBookings,
          inProgress: inProgressBookings,
          cancelled: cancelledBookings,
          noShow: noShowBookings,
        },
        tripsCount: {
          total: tripsTotal,
          completed: completedTrips,
          cancelled: cancelledTrips,
        },
        vehiclesCount: {
          total: vehiclesTotal,
        },
      };
    });
  }

  async tripsOverview(filter: DashboardFilter) {
    const key = `admin:dashboard:tripsOverview:${JSON.stringify(filter)}`;
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const from = filter.dateFrom ?? new Date(Date.now() - 30 * 86_400_000);
      const to = filter.dateTo ?? new Date();

      const statusCounts = await prisma.trip.groupBy({
        by: ["status"],
        where: {
          createdAt: {
            gte: from,
            lte: to,
          },
        },
        _count: true,
      });
      const total = statusCounts.reduce((acc, curr) => acc + curr._count, 0);
      return { total, statusCounts };
    });
  }

  async customerOverview(filter: DashboardFilter) {
    const key = `admin:dashboard:customerOverview:${JSON.stringify(filter)}`;
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      const from = filter.dateFrom ?? new Date(Date.now() - 30 * 86_400_000);
      const to = filter.dateTo ?? new Date();

      const total = await prisma.user.count({
        where: {
          roles: { some: { role: { name: "CUSTOMER" } } },
          createdAt: {
            gte: from,
            lte: to,
          },
        },
      });
      return { total };
    });
  }

  async recentDrivers(limit: number = 10) {
    const key = `admin:dashboard:recentDrivers:${limit}`;
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      return prisma.driverProfile.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          user: {
            select: { id: true, displayName: true, email: true, phone: true },
          },
        },
      });
    });
  }

  async recentCustomers(limit: number = 10) {
    const key = `admin:dashboard:recentCustomers:${limit}`;
    return cached(key, REALTIME_TTL.DASHBOARD_CACHE_SECONDS, async () => {
      return prisma.user.findMany({
        where: { roles: { some: { role: { name: "CUSTOMER" } } } },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          displayName: true,
          email: true,
          phone: true,
          createdAt: true,
        },
      });
    });
  }
}
