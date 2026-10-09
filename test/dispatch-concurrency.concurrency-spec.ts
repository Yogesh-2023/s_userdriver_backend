import { prisma } from "../src/database/prisma";
import { redis } from "../src/infrastructure/redis";
import { DispatchLockService } from "../src/modules/dispatch/dispatch-lock.service";
import { DriverAvailabilityService } from "../src/modules/driver/services/driver-availability.service";
import { closeQueues } from "../src/infrastructure/queues";

describe("dispatch concurrency contract", () => {
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await closeQueues();
    redis.disconnect();
    await prisma.$disconnect();
  });

  it("allows one of five different drivers to win a ten-offer batch", async () => {
    const offers = new Map(
      Array.from({ length: 10 }, (_, index) => {
        const value = {
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          bookingId: "booking-id",
          dispatchCycleId: "cycle-id",
          driverId: `driver-${index}`,
          vehicleId: `vehicle-${index}`,
          attemptNumber: 1,
          status: "OFFERED",
          expiresAt: new Date(Date.now() + 30_000),
          assignment: null,
          booking: { assignedDriverId: null, trip: null },
        };
        return [value.id, value] as const;
      }),
    );
    jest
      .spyOn(prisma.dispatchOffer, "findUnique")
      .mockImplementation(({ where }) => offers.get(String(where.id)) as never);
    jest
      .spyOn(DriverAvailabilityService.prototype, "eligibility")
      .mockImplementation((driverId) =>
        Promise.resolve({
          eligible: true,
          vehicle: { id: `vehicle-${driverId.split("-")[1]}` },
        } as never),
      );
    jest
      .spyOn(redis, "set")
      .mockResolvedValueOnce("OK")
      .mockResolvedValue(null);
    jest.spyOn(redis, "eval").mockResolvedValue(1);
    jest.spyOn(prisma.driverAssignment, "findFirst").mockResolvedValue(null);
    jest.spyOn(prisma, "$transaction").mockResolvedValue({
      assignmentId: "assignment-id",
      bookingId: "booking-id",
      tripId: "trip-id",
      vehicleId: "vehicle-0",
      driverId: "driver-0",
      dispatchCycleId: "cycle-id",
      attemptNumber: 1,
    });
    jest
      .spyOn(DispatchLockService.prototype as never, "afterAcceptance" as never)
      .mockResolvedValue(undefined as never);

    const service = new DispatchLockService();
    const outcomes = await Promise.allSettled(
      [...offers.values()]
        .slice(0, 5)
        .map((offer) => service.acceptRide(offer.id, offer.driverId)),
    );

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      4,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns the same assignment for a winning-driver replay", async () => {
    const transaction = jest.spyOn(prisma, "$transaction");
    jest.spyOn(prisma.dispatchOffer, "findUnique").mockResolvedValue({
      id: "offer-id",
      bookingId: "booking-id",
      driverId: "driver-id",
      vehicleId: "vehicle-id",
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() - 1),
      assignment: { id: "assignment-id" },
      booking: {
        assignedDriverId: "driver-id",
        trip: { id: "trip-id" },
      },
    } as never);
    const result = await new DispatchLockService().acceptRide(
      "offer-id",
      "driver-id",
    );
    expect(result).toEqual({
      assignmentId: "assignment-id",
      bookingId: "booking-id",
      tripId: "trip-id",
      vehicleId: "vehicle-id",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
