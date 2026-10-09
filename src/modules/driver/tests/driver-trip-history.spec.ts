import { Prisma, TripStatus } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import {
  DriverTripHistoryService,
  driverTripHistoryQuerySchema,
} from "../services/driver-trip-history.service";
import { parse } from "../../../common/validation";
import { AppError } from "../../../common/errors";

const service = new DriverTripHistoryService();

const NOW = new Date("2026-09-21T10:00:00.000Z");

type MockStatusEvent = {
  toStatus: TripStatus;
  createdAt: Date;
  metadata: Record<string, unknown>;
};

type MockTrip = {
  id: string;
  bookingId: string;
  status: TripStatus;
  createdAt: Date;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  actualDistanceMeters: number | null;
  actualDurationSeconds: number | null;
  booking: {
    id: string;
    status: string;
    pickupAddress: string | null;
    pickupLatitude: number | null;
    pickupLongitude: number | null;
    dropAddress: string | null;
    dropLatitude: number | null;
    dropLongitude: number | null;
    distanceMeters: number | null;
    durationSeconds: number | null;
    estimatedFare: Prisma.Decimal | null;
    finalFare: Prisma.Decimal | null;
    vehicleCategoryId: string | null;
    cancellation: {
      reasonCode: string | null;
      reason: string | null;
      createdAt: Date | null;
    } | null;
    customer: {
      id: string;
      user: { displayName: string; phone: string };
    };
  };
  vehicle: {
    id: string;
    registrationNo: string;
    category: { id: string; name: string };
  };
  statusHistory: MockStatusEvent[];
};

function buildTrip(overrides: Partial<MockTrip> = {}): MockTrip {
  return {
    id: "trip-1",
    bookingId: "booking-1",
    status: TripStatus.COMPLETED,
    createdAt: NOW,
    arrivedAt: null,
    startedAt: new Date("2026-09-21T10:05:00.000Z"),
    completedAt: new Date("2026-09-21T10:40:00.000Z"),
    actualDistanceMeters: 12400,
    actualDurationSeconds: 2100,
    booking: {
      id: "booking-1",
      status: "COMPLETED",
      pickupAddress: "MG Road, Bengaluru",
      pickupLatitude: 12.9716,
      pickupLongitude: 77.5946,
      dropAddress: "Indiranagar, Bengaluru",
      dropLatitude: 12.9784,
      dropLongitude: 77.6408,
      distanceMeters: 12000,
      durationSeconds: 1800,
      estimatedFare: new Prisma.Decimal("400.00"),
      finalFare: new Prisma.Decimal("456.75"),
      vehicleCategoryId: "cat-sedan",
      cancellation: null,
      customer: {
        id: "customer-1",
        user: {
          displayName: "Rahul Sharma",
          phone: "+919876543210",
        },
      },
    },
    vehicle: {
      id: "vehicle-1",
      registrationNo: "KA01AB1234",
      category: { id: "cat-sedan", name: "Sedan" },
    },
    statusHistory: [
      { toStatus: TripStatus.COMPLETED, createdAt: NOW, metadata: {} },
    ],
    ...overrides,
  };
}

function canceledTrip(overrides: Partial<MockTrip> = {}): MockTrip {
  return buildTrip({
    status: TripStatus.CANCELLED,
    startedAt: null,
    completedAt: null,
    booking: {
      ...buildTrip().booking,
      status: "CANCELLED",
      finalFare: null,
    },
    statusHistory: [
      {
        toStatus: TripStatus.CANCELLED,
        createdAt: NOW,
        metadata: { reason: "Driver requested cancellation" },
      },
    ],
    ...overrides,
  });
}

const findMany = () => prisma.trip.findMany as unknown as jest.Mock;
const count = () => prisma.trip.count as unknown as jest.Mock;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();

  jest.spyOn(prisma.trip, "findMany").mockResolvedValue([] as never);
  jest.spyOn(prisma.trip, "count").mockResolvedValue(0);
  jest.spyOn(prisma.trip, "groupBy").mockResolvedValue([
    { status: TripStatus.COMPLETED, _count: { _all: 2 } },
    { status: TripStatus.CREATED, _count: { _all: 1 } },
    { status: TripStatus.STARTED, _count: { _all: 1 } },
    { status: TripStatus.CANCELLED, _count: { _all: 3 } },
  ] as never);
});

describe("DriverTripHistoryService.getTripHistory", () => {
  it("returns paginated trips with counts for the driver", async () => {
    const trip = buildTrip();
    findMany().mockResolvedValue([trip]);
    count().mockImplementation(
      (args?: { where?: { booking?: { cancellation?: unknown } } }) =>
        args?.where?.booking?.cancellation
          ? Promise.resolve(0)
          : Promise.resolve(1),
    );

    const result = await service.getTripHistory("driver-1");

    expect(findMany()).toHaveBeenCalledTimes(1);

    expect(result.trips).toHaveLength(1);
    const item = result.trips[0]!;
    expect(item.id).toBe("trip-1");
    expect(item.status).toBe("COMPLETED");
    expect(item.pickup.address).toBe("MG Road, Bengaluru");
    expect(item.drop.latitude).toBe(12.9784);
    expect(item.fare).toBe(456.75);
    expect(item.distance).toBe(12400);
    expect(item.customer.name).toBe("Rahul Sharma");
    expect(item.customer.phone).toBe("+9*********10");
    expect(item.vehicle.vehicleNumber).toBe("KA01AB1234");
    expect(item.acceptedAt).toBe(NOW.toISOString());
    expect(item.completedAt).toBe("2026-09-21T10:40:00.000Z");
    expect(item.cancellationReason).toBeNull();

    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(result.counts).toEqual({
      all: 7,
      accepted: 1,
      ongoing: 2,
      completed: 2,
      cancelled: 3,
      noShow: 0,
    });
  });

  it("queries only the authenticated driver's own trips", async () => {
    await service.getTripHistory("driver-auth-123");
    expect(findMany().mock.calls[0][0].where.driverId).toBe("driver-auth-123");

    await service.getTripHistory("driver-auth-999");
    expect(findMany().mock.calls[1][0].where.driverId).toBe("driver-auth-999");
  });

  it("returns an empty page when the driver has no trips", async () => {
    const result = await service.getTripHistory("driver-empty");

    expect(result.trips).toEqual([]);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it.each([
    ["COMPLETED", TripStatus.COMPLETED],
    ["CANCELLED", TripStatus.CANCELLED],
    ["ACCEPTED", TripStatus.CREATED],
  ])(
    "maps semantic status %s to canonical trip status %s",
    async (filter, expected) => {
      await service.getTripHistory("driver-1", { status: filter as never });

      expect(findMany().mock.calls[0][0].where).toMatchObject({
        driverId: "driver-1",
        status: expected,
      });
    },
  );

  it("maps ONGOING to all active trip statuses", async () => {
    await service.getTripHistory("driver-1", { status: "ONGOING" });

    expect(findMany().mock.calls[0][0].where.status.in).toEqual([
      TripStatus.CREATED,
      TripStatus.DRIVER_ARRIVING,
      TripStatus.DRIVER_ARRIVED,
      TripStatus.STARTED,
    ]);
  });

  it("maps NO_SHOW to CANCELLED with customer no-show cancellation", async () => {
    await service.getTripHistory("driver-1", { status: "NO_SHOW" });

    const where = findMany().mock.calls[0][0].where;
    expect(where.status).toBe(TripStatus.CANCELLED);
    expect(where.booking.cancellation.reasonCode).toBe("CUSTOMER_NO_SHOW");
  });

  it("returns empty trips for REJECTED without querying trips table", async () => {
    const result = await service.getTripHistory("driver-1", {
      status: "REJECTED",
    });

    expect(findMany()).not.toHaveBeenCalled();
    expect(result.trips).toEqual([]);
    expect(result.counts.all).toBe(7);
  });

  it("applies inclusive day boundaries for dateFrom/dateTo filters", async () => {
    await service.getTripHistory("driver-1", {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });

    const where = findMany().mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(where.createdAt.lte.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });

  it("applies the vehicleCategoryId filter on the booking", async () => {
    await service.getTripHistory("driver-1", {
      vehicleCategoryId: "cat-sedan",
    });

    const where = findMany().mock.calls[0][0].where;
    expect(where.booking.vehicleCategoryId).toBe("cat-sedan");
  });

  it("keeps the vehicleCategoryId filter when combined with a status filter", async () => {
    await service.getTripHistory("driver-1", {
      status: "COMPLETED",
      vehicleCategoryId: "cat-sedan",
    });

    const where = findMany().mock.calls[0][0].where;
    expect(where.status).toBe(TripStatus.COMPLETED);
    expect(where.booking.vehicleCategoryId).toBe("cat-sedan");
  });

  it("builds a search predicate across customer, pickup and drop", async () => {
    await service.getTripHistory("driver-1", { search: "Rahul" });

    const where = findMany().mock.calls[0][0].where;
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR).toContainEqual(
      expect.objectContaining({
        booking: {
          pickupAddress: { contains: "Rahul", mode: "insensitive" },
        },
      }),
    );
  });

  it("matches search by booking/trip id when value is a uuid", async () => {
    await service.getTripHistory("driver-1", {
      search: "7a0b3c4d-1111-4222-8333-444455556666",
    });

    const or = findMany().mock.calls[0][0].where.OR;
    expect(or).toContainEqual({ id: "7a0b3c4d-1111-4222-8333-444455556666" });
    expect(or).toContainEqual({
      bookingId: "7a0b3c4d-1111-4222-8333-444455556666",
    });
  });

  it("paginates with skip/take and default page=1 limit=20", async () => {
    await service.getTripHistory("driver-1");
    expect(findMany().mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });

    await service.getTripHistory("driver-1", { page: 3, limit: 10 });
    expect(findMany().mock.calls[1][0]).toMatchObject({ skip: 20, take: 10 });
  });

  it("orders newest first by default and honors explicit order", async () => {
    await service.getTripHistory("driver-1");
    expect(findMany().mock.calls[0][0].orderBy).toEqual({ createdAt: "desc" });

    await service.getTripHistory("driver-1", { order: "asc" });
    expect(findMany().mock.calls[1][0].orderBy).toEqual({ createdAt: "asc" });
  });

  it("computes totalPages from the filtered total", async () => {
    count().mockResolvedValue(57);
    await service.getTripHistory("driver-1", { limit: 20 });

    const result = await service.getTripHistory("driver-1", {
      limit: 20,
      page: 2,
      status: "COMPLETED",
    });
    expect(result.pagination.totalPages).toBe(3);
  });

  it("falls back to estimatedFare when finalFare is null", async () => {
    findMany().mockResolvedValue([
      buildTrip({
        booking: { ...buildTrip().booking, finalFare: null },
      }),
    ]);

    const result = await service.getTripHistory("driver-1");
    expect(result.trips[0]!.fare).toBe(400);
  });

  it("prefers the trip status-history reason for cancellations", async () => {
    findMany().mockResolvedValue([
      canceledTrip({
        booking: {
          ...buildTrip().booking,
          status: "CANCELLED",
          finalFare: null,
          cancellation: {
            reasonCode: "DRIVER_CANCELLED",
            reason: null,
            createdAt: NOW,
          },
        },
      }),
    ]);

    const result = await service.getTripHistory("driver-1", {
      status: "CANCELLED",
    });
    expect(result.trips[0]!.status).toBe("CANCELLED");
    expect(result.trips[0]!.cancelledAt).toBe(NOW.toISOString());
    expect(result.trips[0]!.cancellationReason).toBe(
      "Driver requested cancellation",
    );
  });
});

describe("driverTripHistoryQuerySchema", () => {
  it("rejects an unknown status with a 400 validation error", () => {
    expect(() =>
      parse(driverTripHistoryQuerySchema, { status: "IN_PROGRESS" }),
    ).toThrow(AppError);
    try {
      parse(driverTripHistoryQuerySchema, { status: "IN_PROGRESS" });
    } catch (error) {
      expect((error as AppError).statusCode).toBe(400);
    }
  });

  it("rejects invalid date strings", () => {
    expect(() =>
      parse(driverTripHistoryQuerySchema, { dateFrom: "21/09/2026" }),
    ).toThrow(AppError);
  });

  it("rejects page below 1 and limit above 100", () => {
    expect(() => parse(driverTripHistoryQuerySchema, { page: "0" })).toThrow(
      AppError,
    );
    expect(() => parse(driverTripHistoryQuerySchema, { limit: "101" })).toThrow(
      AppError,
    );
  });

  it("applies safe defaults", () => {
    expect(parse(driverTripHistoryQuerySchema, {})).toMatchObject({
      page: 1,
      limit: 20,
      sort: "createdAt",
    });
  });
});
