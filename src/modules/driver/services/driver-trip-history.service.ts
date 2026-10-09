import { Prisma, TripStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

/**
 * Semantic ride-history filters exposed to the driver app. These map onto the
 * canonical TripStatus values actually stored in the database:
 *
 *  - ALL         -> no trip status filter
 *  - ACCEPTED    -> TripStatus.CREATED (ride accepted, driver heading/pending pickup)
 *  - ONGOING     -> active trips: CREATED, DRIVER_ARRIVING, DRIVER_ARRIVED, STARTED
 *  - COMPLETED   -> TripStatus.COMPLETED
 *  - CANCELLED   -> TripStatus.CANCELLED
 *  - NO_SHOW     -> TripStatus.CANCELLED with booking cancellation reasonCode CUSTOMER_NO_SHOW
 *  - REJECTED    -> rejected dispatch offers are not trips (no Trip row is created),
 *                   so this always resolves to an empty history
 */
export type DriverTripHistoryStatus =
  | "ALL"
  | "ACCEPTED"
  | "ONGOING"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"
  | "NO_SHOW";

export const DRIVER_TRIP_HISTORY_STATUSES: readonly DriverTripHistoryStatus[] =
  [
    "ALL",
    "ACCEPTED",
    "ONGOING",
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
    "NO_SHOW",
  ];

export const ONGOING_TRIP_STATUSES: readonly TripStatus[] = [
  TripStatus.CREATED,
  TripStatus.DRIVER_ARRIVING,
  TripStatus.DRIVER_ARRIVED,
  TripStatus.STARTED,
];

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export type DriverTripHistoryFilters = {
  status?: DriverTripHistoryStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  vehicleCategoryId?: string;
  page?: number;
  limit?: number;
  order?: "asc" | "desc";
};

export const driverTripHistoryQuerySchema = z.object({
  status: z
    .enum(
      DRIVER_TRIP_HISTORY_STATUSES as readonly [
        DriverTripHistoryStatus,
        ...DriverTripHistoryStatus[],
      ],
    )
    .optional(),
  dateFrom: z.string().date("Invalid date. Expected YYYY-MM-DD").optional(),
  dateTo: z.string().date("Invalid date. Expected YYYY-MM-DD").optional(),
  search: z.string().trim().min(1).max(100).optional(),
  vehicleCategoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).optional(),
});

export type DriverTripHistoryQuery = z.infer<
  typeof driverTripHistoryQuerySchema
>;

const ACTIVE_STATUS_KEYS: readonly TripStatus[] = [
  TripStatus.CREATED,
  TripStatus.DRIVER_ARRIVING,
  TripStatus.DRIVER_ARRIVED,
  TripStatus.STARTED,
];

type TripHistoryRow = Prisma.TripGetPayload<{
  select: ReturnType<DriverTripHistoryService["tripSelect"]>;
}>;

type HistoryCounts = {
  all: number;
  accepted: number;
  ongoing: number;
  completed: number;
  cancelled: number;
  noShow: number;
};

export class DriverTripHistoryService {
  /**
   * Returns paginated trip history for a single driver. `driverId` must always
   * come from the authenticated session context (never from request input) so a
   * driver can only ever see their own trips.
   */
  async getTripHistory(
    driverId: string,
    filters: DriverTripHistoryFilters = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, filters.limit ?? DEFAULT_LIMIT),
    );
    const status = filters.status ?? "ALL";
    const order = filters.order === "asc" ? "asc" : "desc";
    const sort: Prisma.TripOrderByWithRelationInput = { createdAt: order };

    const baseWhere = this.buildWhere(driverId, filters);

    if (status === "REJECTED") {
      // Rejected dispatch offers never produce a Trip row, so there is no
      // trip-level history for them. Return an empty page but still provide
      // accurate status counts for the driver.
      const counts = await this.counts(driverId, filters);
      return this.serializePage([], page, limit, 0, counts);
    }

    const statusWhere = this.statusClause(status);
    const where = this.mergeWhere(baseWhere, statusWhere);

    const [trips, total, counts] = await Promise.all([
      prisma.trip.findMany({
        where,
        select: this.tripSelect(),
        orderBy: sort,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.trip.count({ where }),
      this.counts(driverId, filters),
    ]);

    return this.serializePage(trips, page, limit, total, counts);
  }

  async getTripDetails(driverId: string, tripId: string) {
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, driverId },
      include: {
        booking: true,
        statusHistory: true,
      },
    });
    if (!trip) throw errors.notFound("Trip not found");
    return trip;
  }

  /**
   * Status-wise trip counts for the current driver, ignoring the `status`
   * filter (so the app can render tab badges for the full history) but still
   * honoring date/search/category filters.
   */
  private async counts(
    driverId: string,
    filters: DriverTripHistoryFilters,
  ): Promise<HistoryCounts> {
    const where = this.buildWhere(driverId, {
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
    const ongoing = ACTIVE_STATUS_KEYS.reduce(
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

  private statusClause(status: DriverTripHistoryStatus): Prisma.TripWhereInput {
    switch (status) {
      case "ACCEPTED":
        return { status: TripStatus.CREATED };
      case "ONGOING":
        return { status: { in: [...ONGOING_TRIP_STATUSES] } };
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
    driverId: string,
    filters: DriverTripHistoryFilters,
  ): Prisma.TripWhereInput {
    const where: Prisma.TripWhereInput = { driverId };

    const bookingWhere: Prisma.BookingWhereInput = {};
    if (filters.vehicleCategoryId) {
      bookingWhere.vehicleCategoryId = filters.vehicleCategoryId;
    }
    if (filters.search) {
      bookingWhere.customer = {
        user: {
          OR: [
            { displayName: { contains: filters.search, mode: "insensitive" } },
            { phone: { contains: filters.search } },
          ],
        },
      };
      where.OR = [
        ...(this.isUuid(filters.search) ? [{ id: filters.search }] : []),
        ...(this.isUuid(filters.search) ? [{ bookingId: filters.search }] : []),
        {
          booking: {
            pickupAddress: { contains: filters.search, mode: "insensitive" },
          },
        },
        {
          booking: {
            dropAddress: { contains: filters.search, mode: "insensitive" },
          },
        },
        { booking: bookingWhere },
      ];
    } else if (filters.vehicleCategoryId) {
      where.booking = bookingWhere;
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) {
      createdAt.gte = this.startOfDay(filters.dateFrom);
    }
    if (filters.dateTo) {
      createdAt.lte = this.endOfDay(filters.dateTo);
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
          customer: {
            select: {
              id: true,
              user: { select: { displayName: true, phone: true } },
            },
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
      customer: {
        id: booking?.customer?.id ?? null,
        name: booking?.customer?.user?.displayName ?? null,
        phone: booking?.customer?.user?.phone
          ? this.maskPhone(booking.customer.user.phone)
          : null,
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

  private startOfDay(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw errors.badRequest("dateFrom must be a valid YYYY-MM-DD date");
    }
    return date;
  }

  private endOfDay(value: string) {
    const date = new Date(`${value}T23:59:59.999Z`);
    if (Number.isNaN(date.getTime())) {
      throw errors.badRequest("dateTo must be a valid YYYY-MM-DD date");
    }
    return date;
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  async getRatingsSummary(driverId: string) {
    const profile = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true, averageRating: true, totalTrips: true },
    });
    if (!profile) throw errors.notFound("Driver profile not found");

    const recentRatings = await prisma.rating.findMany({
      where: { subjectUserId: profile.userId, subjectType: "DRIVER" },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { review: true },
    });

    return {
      summary: {
        averageRating: profile.averageRating,
        totalTrips: profile.totalTrips,
      },
      recentRatings,
    };
  }

  async getRatings(driverId: string, limit = 20, offset = 0) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    const where = {
      subjectUserId: driver.userId,
      subjectType: "DRIVER" as const,
    };
    const [items, total] = await Promise.all([
      prisma.rating.findMany({
        where,
        include: {
          review: true,
          trip: {
            select: {
              bookingId: true,
              completedAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.rating.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async rateCustomer(
    driverId: string,
    tripId: string,
    rating: number,
    comment?: string,
  ) {
    if (rating < 1 || rating > 5)
      throw errors.badRequest("Rating must be between 1 and 5");

    const trip = await prisma.trip.findFirst({
      where: { id: tripId, driverId, status: "COMPLETED" },
      include: {
        driver: { select: { userId: true } },
        booking: {
          include: { customer: { select: { userId: true } } },
        },
      },
    });
    if (!trip) throw errors.notFound("Completed trip not found");

    const existingRating = await prisma.rating.findFirst({
      where: { tripId, authorUserId: trip.driver.userId },
    });
    if (existingRating)
      throw errors.conflict("You have already rated this trip");

    return prisma.$transaction(async (tx) => {
      const newRating = await tx.rating.create({
        data: {
          tripId,
          authorUserId: trip.driver.userId,
          subjectUserId: trip.booking.customer.userId,
          subjectType: "CUSTOMER",
          score: rating,
          tags: [],
          ...(comment
            ? { review: { create: { comment: comment.trim() } } }
            : {}),
        },
      });

      // Customer aggregate recalculation can be dispatched to BullMQ
      return newRating;
    });
  }

  private maskPhone(phone: string) {
    if (phone.length <= 4) return "*".repeat(phone.length);
    return `${phone.slice(0, 2)}${"*".repeat(phone.length - 4)}${phone.slice(-2)}`;
  }
}
