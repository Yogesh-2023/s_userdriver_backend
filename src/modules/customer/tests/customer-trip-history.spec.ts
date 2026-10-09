import { Prisma, TripStatus } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { CustomerTripHistoryService } from "../services/customer-trip-history.service";

const service = new CustomerTripHistoryService();

const NOW = new Date("2026-09-21T10:00:00.000Z");

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
    pickupAddress: string;
    pickupLatitude: number;
    pickupLongitude: number;
    dropAddress: string;
    dropLatitude: number;
    dropLongitude: number;
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
  };
  vehicle: {
    id: string;
    registrationNo: string;
    category: { id: string; name: string };
  };
  driver: {
    id: string;
    averageRating: number | null;
    user: { displayName: string; phone: string };
  };
  statusHistory: {
    toStatus: TripStatus;
    createdAt: Date;
    metadata: Record<string, unknown>;
  }[];
};

const findMany = () => prisma.trip.findMany as unknown as jest.Mock;
const count = () => prisma.trip.count as unknown as jest.Mock;

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
      status: "TRIP_COMPLETED",
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
    },
    vehicle: {
      id: "vehicle-1",
      registrationNo: "KA01AB1234",
      category: { id: "cat-sedan", name: "Sedan" },
    },
    driver: {
      id: "driver-1",
      averageRating: 4.6,
      user: { displayName: "Amit Kumar", phone: "+919012345678" },
    },
    statusHistory: [
      { toStatus: TripStatus.COMPLETED, createdAt: NOW, metadata: {} },
    ],
    ...overrides,
  };
}

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

describe("CustomerTripHistoryService.getTripHistory", () => {
  it("returns paginated sanitized trips with counts for the customer", async () => {
    findMany().mockResolvedValue([buildTrip()]);
    count().mockImplementation(
      (args?: { where?: { booking?: { cancellation?: unknown } } }) =>
        args?.where?.booking?.cancellation
          ? Promise.resolve(0)
          : Promise.resolve(1),
    );

    const result = await service.getTripHistory("customer-1");

    const trip = result.trips[0]!;
    expect(trip.id).toBe("trip-1");
    expect(trip.status).toBe("COMPLETED");
    expect(trip.bookingStatus).toBe("TRIP_COMPLETED");
    expect(trip.pickup.address).toBe("MG Road, Bengaluru");
    expect(trip.drop.latitude).toBe(12.9784);
    expect(trip.vehicle.vehicleNumber).toBe("KA01AB1234");
    expect(trip.driver.name).toBe("Amit Kumar");
    expect(trip.driver.phone).toBe("+9*********78");
    expect(trip.fare).toBe(456.75);
    expect(trip.distance).toBe(12400);
    expect(trip.acceptedAt).toBe(NOW.toISOString());

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

  it("never leaks trip internals such as OTP hashes to the client", async () => {
    findMany().mockResolvedValue([buildTrip()]);
    const result = await service.getTripHistory("customer-1");
    const serialized = JSON.stringify(result.trips[0]);
    expect(serialized).not.toMatch(/verificationOtp|otpAttempts|otpHash/i);
  });

  it("queries only the authenticated customer's own trips", async () => {
    await service.getTripHistory("customer-abc");
    expect(findMany().mock.calls[0][0].where.booking.customerId).toBe(
      "customer-abc",
    );
  });

  it("returns an empty page when the customer has no trips", async () => {
    const result = await service.getTripHistory("customer-empty");
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
  ])("maps status %s to canonical trip status %s", async (filter, expected) => {
    await service.getTripHistory("customer-1", { status: filter as never });
    expect(findMany().mock.calls[0][0].where.status).toBe(expected);
  });

  it("maps ONGOING to all active statuses", async () => {
    await service.getTripHistory("customer-1", { status: "ONGOING" });
    expect(findMany().mock.calls[0][0].where.status.in).toEqual([
      TripStatus.CREATED,
      TripStatus.DRIVER_ARRIVING,
      TripStatus.DRIVER_ARRIVED,
      TripStatus.STARTED,
    ]);
  });

  it("maps NO_SHOW to CANCELLED with customer no-show cancellation", async () => {
    await service.getTripHistory("customer-1", { status: "NO_SHOW" });
    const where = findMany().mock.calls[0][0].where;
    expect(where.status).toBe(TripStatus.CANCELLED);
    expect(where.booking.cancellation.reasonCode).toBe("CUSTOMER_NO_SHOW");
  });

  it("returns empty for REJECTED without querying trips", async () => {
    const result = await service.getTripHistory("customer-1", {
      status: "REJECTED",
    });
    expect(findMany()).not.toHaveBeenCalled();
    expect(result.trips).toEqual([]);
    expect(result.counts.all).toBe(7);
  });

  it("applies inclusive day boundaries for date filters", async () => {
    await service.getTripHistory("customer-1", {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
    const where = findMany().mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(where.createdAt.lte.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });

  it("applies vehicleCategoryId and merges it with a status filter", async () => {
    await service.getTripHistory("customer-1", {
      vehicleCategoryId: "cat-sedan",
    });
    expect(findMany().mock.calls[0][0].where.booking.vehicleCategoryId).toBe(
      "cat-sedan",
    );

    await service.getTripHistory("customer-1", {
      status: "CANCELLED",
      vehicleCategoryId: "cat-sedan",
    });
    const where = findMany().mock.calls[1][0].where;
    expect(where.status).toBe(TripStatus.CANCELLED);
    expect(where.booking.vehicleCategoryId).toBe("cat-sedan");
  });

  it("builds a search predicate across pickup, drop and booking id", async () => {
    await service.getTripHistory("customer-1", { search: "indiranagar" });
    const where = findMany().mock.calls[0][0].where;
    expect(where.OR).toContainEqual({
      booking: {
        pickupAddress: { contains: "indiranagar", mode: "insensitive" },
      },
    });
  });

  it("paginates with skip/take and orders newest first by default", async () => {
    await service.getTripHistory("customer-1");
    expect(findMany().mock.calls[0][0]).toMatchObject({
      skip: 0,
      take: 20,
      orderBy: { createdAt: "desc" },
    });

    await service.getTripHistory("customer-1", {
      page: 2,
      limit: 10,
      order: "asc",
    });
    expect(findMany().mock.calls[1][0]).toMatchObject({
      skip: 10,
      take: 10,
      orderBy: { createdAt: "asc" },
    });
  });

  it("falls back to estimatedFare when finalFare is null", async () => {
    findMany().mockResolvedValue([
      buildTrip({ booking: { ...buildTrip().booking, finalFare: null } }),
    ]);
    const result = await service.getTripHistory("customer-1");
    expect(result.trips[0]!.fare).toBe(400);
  });

  it("derives cancellation reason from trip status history metadata", async () => {
    findMany().mockResolvedValue([
      buildTrip({
        status: TripStatus.CANCELLED,
        statusHistory: [
          {
            toStatus: TripStatus.CANCELLED,
            createdAt: NOW,
            metadata: { reason: "Customer request" },
          },
        ],
      }),
    ]);
    const result = await service.getTripHistory("customer-1");
    expect(result.trips[0]!.cancelledAt).toBe(NOW.toISOString());
    expect(result.trips[0]!.cancellationReason).toBe("Customer request");
  });

  it("keeps the customer filter when a date range is applied", async () => {
    await service.getTripHistory("customer-123", { dateFrom: "2026-09-01" });
    const where = findMany().mock.calls[0][0].where;
    expect(where.booking.customerId).toBe("customer-123");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });
});
