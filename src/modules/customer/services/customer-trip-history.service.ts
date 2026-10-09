import { Prisma, TripStatus } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

/**
 * Customer ride-history filters. These map onto the canonical TripStatus values
 * stored in the database (see driver-trip-history.service.ts for the same
 * mapping used by the driver app):
 *
 *  - ALL         -> no trip status filter
 *  - ACCEPTED    -> TripStatus.CREATED (ride accepted, driver heading to pickup)
 *  - ONGOING     -> active trips: CREATED, DRIVER_ARRIVING, DRIVER_ARRIVED, STARTED
 *  - COMPLETED   -> TripStatus.COMPLETED
 *  - CANCELLED   -> TripStatus.CANCELLED
 *  - NO_SHOW     -> TripStatus.CANCELLED with booking cancellation reasonCode CUSTOMER_NO_SHOW
 *  - REJECTED    -> rejected dispatch offers never create a Trip row, so this is always empty
 */
export type CustomerTripStatus =
  | "ALL"
  | "ACCEPTED"
  | "ONGOING"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"
  | "NO_SHOW";

export const CUSTOMER_TRIP_STATUSES: readonly CustomerTripStatus[] = [
  "ALL",
  "ACCEPTED",
  "ONGOING",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "NO_SHOW",
];

export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = [
  TripStatus.CREATED,
  TripStatus.DRIVER_ARRIVING,
  TripStatus.DRIVER_ARRIVED,
  TripStatus.STARTED,
];

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export type CustomerTripHistoryFilters = {
  status?: CustomerTripStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  vehicleCategoryId?: string;
  page?: number;
  limit?: number;
  order?: "asc" | "desc";
};

type TripHistoryRow = Prisma.TripGetPayload<{
  select: ReturnType<CustomerTripHistoryService["tripSelect"]>;
}>;

type HistoryCounts = {
  all: number;
  accepted: number;
  ongoing: number;
  completed: number;
  cancelled: number;
  noShow: number;
};

export class CustomerTripHistoryService {
  /**
   * Returns paginated trip history for a single customer. `customerId` must
   * always come from the authenticated session context (never from request
   * input) so a customer can only ever see their own rides.
   */
  async getTripHistory(
    customerId: string,
    filters: CustomerTripHistoryFilters = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, filters.limit ?? DEFAULT_LIMIT),
    );
    const status = filters.status ?? "ALL";
    const order = filters.order === "asc" ? "asc" : "desc";
    const sort: Prisma.TripOrderByWithRelationInput = { createdAt: order };

    const baseWhere = this.buildWhere(customerId, filters);

    if (status === "REJECTED") {
      const counts = await this.counts(customerId, filters);
      return this.serializePage([], page, limit, 0, counts);
    }

    const where = this.mergeWhere(baseWhere, this.statusClause(status));

    const [trips, total, counts] = await Promise.all([
      prisma.trip.findMany({
        where,
        select: this.tripSelect(),
        orderBy: sort,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.trip.count({ where }),
      this.counts(customerId, filters),
    ]);

    return this.serializePage(trips, page, limit, total, counts);
  }

  private async counts(
    customerId: string,
    filters: CustomerTripHistoryFilters,
  ): Promise<HistoryCounts> {
    const where = this.buildWhere(customerId, {
      ...filters,
      status: undefined,
    });
    const [grouped, noShow] = await Promise.all([
      prisma.trip.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      prisma.trip.count({
        where: this.mergeWhere(where, this.statusClause("NO_SHOW")),
      }),
    ]);

    const countFor = (status: TripStatus) =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;

    const completed = countFor(TripStatus.COMPLETED);
    const cancelled = countFor(TripStatus.CANCELLED);
    const accepted = countFor(TripStatus.CREATED);
    const ongoing = ACTIVE_TRIP_STATUSES.reduce(
      (sum, status) => sum + countFor(status),
      0,
    );

    return {
      all: completed + cancelled + ongoing,
      accepted,
      ongoing,
      completed,
      cancelled,
      noShow,
    };
  }

  private statusClause(status: CustomerTripStatus): Prisma.TripWhereInput {
    switch (status) {
      case "ACCEPTED":
        return { status: TripStatus.CREATED };
      case "ONGOING":
        return { status: { in: [...ACTIVE_TRIP_STATUSES] } };
      case "COMPLETED":
        return { status: TripStatus.COMPLETED };
      case "CANCELLED":
        return { status: TripStatus.CANCELLED };
      case "NO_SHOW":
        return {
          status: TripStatus.CANCELLED,
          booking: { cancellation: { reasonCode: "CUSTOMER_NO_SHOW" } },
        };
      case "REJECTED":
      case "ALL":
      default:
        return {};
    }
  }

  private buildWhere(
    customerId: string,
    filters: CustomerTripHistoryFilters,
  ): Prisma.TripWhereInput {
    const bookingWhere: Prisma.BookingWhereInput = { customerId };

    if (filters.vehicleCategoryId) {
      bookingWhere.vehicleCategoryId = filters.vehicleCategoryId;
    }

    const where: Prisma.TripWhereInput = { booking: bookingWhere };

    if (filters.search) {
      const search = filters.search;
      where.OR = [
        ...(this.isUuid(search) ? [{ id: search }] : []),
        ...(this.isUuid(search) ? [{ bookingId: search }] : []),
        {
          booking: {
            pickupAddress: { contains: search, mode: "insensitive" },
          },
        },
        {
          booking: {
            dropAddress: { contains: search, mode: "insensitive" },
          },
        },
      ];
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) {
      createdAt.gte = this.dayBoundary(
        filters.dateFrom,
        "00:00:00.000",
        "dateFrom",
      );
    }
    if (filters.dateTo) {
      createdAt.lte = this.dayBoundary(
        filters.dateTo,
        "23:59:59.999",
        "dateTo",
      );
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    return where;
  }

  private mergeWhere(
    base: Prisma.TripWhereInput,
    extra: Prisma.TripWhereInput,
  ): Prisma.TripWhereInput {
    if (Object.keys(extra).length === 0) return base;
    const { booking: extraBooking, ...restExtra } = extra;
    return {
      ...base,
      ...restExtra,
      ...(base.booking || extraBooking
        ? { booking: { ...(base.booking as object), ...(extraBooking ?? {}) } }
        : {}),
    };
  }

  private tripSelect() {
    return {
      id: true,
      bookingId: true,
      status: true,
      createdAt: true,
      arrivedAt: true,
      startedAt: true,
      completedAt: true,
      actualDistanceMeters: true,
      actualDurationSeconds: true,
      booking: {
        select: {
          id: true,
          status: true,
          pickupAddress: true,
          pickupLatitude: true,
          pickupLongitude: true,
          dropAddress: true,
          dropLatitude: true,
          dropLongitude: true,
          distanceMeters: true,
          durationSeconds: true,
          estimatedFare: true,
          finalFare: true,
          vehicleCategoryId: true,
          cancellation: {
            select: { reasonCode: true, reason: true, createdAt: true },
          },
        },
      },
      vehicle: {
        select: {
          id: true,
          registrationNo: true,
          category: { select: { id: true, name: true } },
        },
      },
      driver: {
        select: {
          id: true,
          averageRating: true,
          user: { select: { displayName: true, phone: true } },
        },
      },
      statusHistory: {
        select: { toStatus: true, createdAt: true, metadata: true },
        orderBy: { createdAt: "desc" },
      },
    } satisfies Prisma.TripSelect;
  }

  private serializePage(
    trips: TripHistoryRow[],
    page: number,
    limit: number,
    total: number,
    counts: HistoryCounts,
  ) {
    return {
      trips: trips.map((trip) => this.serializeTrip(trip)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      counts,
    };
  }

  private serializeTrip(trip: TripHistoryRow) {
    const booking = trip.booking;
    const cancellationEvent = trip.statusHistory.find(
      (event) => event.toStatus === TripStatus.CANCELLED,
    );
    const cancelMetadata = (cancellationEvent?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const cancellationReason =
      (typeof cancelMetadata.reason === "string"
        ? cancelMetadata.reason
        : null) ??
      booking?.cancellation?.reasonCode ??
      booking?.cancellation?.reason ??
      null;

    return {
      id: trip.id,
      bookingId: trip.bookingId,
      status: trip.status,
      bookingStatus: booking?.status ?? null,
      pickup: {
        address: booking?.pickupAddress ?? null,
        latitude: booking ? Number(booking.pickupLatitude) : null,
        longitude: booking ? Number(booking.pickupLongitude) : null,
      },
      drop: {
        address: booking?.dropAddress ?? null,
        latitude: booking ? Number(booking.dropLatitude) : null,
        longitude: booking ? Number(booking.dropLongitude) : null,
      },
      vehicle: {
        id: trip.vehicle?.id ?? null,
        category: trip.vehicle?.category?.name ?? null,
        vehicleNumber: trip.vehicle?.registrationNo ?? null,
      },
      vehicleCategoryId: booking?.vehicleCategoryId ?? null,
      driver: {
        id: trip.driver?.id ?? null,
        name: trip.driver?.user?.displayName ?? null,
        phone: trip.driver?.user?.phone
          ? this.maskPhone(trip.driver.user.phone)
          : null,
        rating: trip.driver?.averageRating ?? null,
      },
      fare:
        booking?.finalFare != null || booking?.estimatedFare != null
          ? Number(booking.finalFare ?? booking.estimatedFare)
          : null,
      distance: trip.actualDistanceMeters ?? booking?.distanceMeters ?? null,
      duration: trip.actualDurationSeconds ?? booking?.durationSeconds ?? null,
      acceptedAt: trip.createdAt.toISOString(),
      startedAt: trip.startedAt?.toISOString() ?? null,
      completedAt: trip.completedAt?.toISOString() ?? null,
      cancelledAt: cancellationEvent?.createdAt?.toISOString() ?? null,
      cancellationReason,
    };
  }

  private dayBoundary(
    value: string,
    time: string,
    field: "dateFrom" | "dateTo",
  ) {
    const date = new Date(`${value}T${time}Z`);
    if (Number.isNaN(date.getTime())) {
      throw errors.badRequest(`${field} must be a valid YYYY-MM-DD date`);
    }
    return date;
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private maskPhone(phone: string) {
    if (phone.length <= 4) return "*".repeat(phone.length);
    return `${phone.slice(0, 2)}${"*".repeat(phone.length - 4)}${phone.slice(-2)}`;
  }
}
