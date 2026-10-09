import { prisma } from "../../../database/prisma";
import { closeQueues } from "../../../infrastructure/queues";
import { redis } from "../../../infrastructure/redis";
import { DriverAvailabilityService } from "../../driver/services/driver-availability.service";
import { DispatchLockService } from "../dispatch-lock.service";
import { DispatchService } from "../service";

describe("dispatch acceptance race", () => {
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await closeQueues();
    redis.disconnect();
    await prisma.$disconnect();
  });

  it("allows only the Redis lock holder into the serializable transaction", async () => {
    jest.spyOn(prisma.driverProfile, "findUnique").mockImplementation(
      ({ where }) =>
        ({
          id:
            "userId" in where &&
            where.userId === "00000000-0000-0000-0000-000000000004"
              ? "00000000-0000-0000-0000-000000000002"
              : "00000000-0000-0000-0000-000000000003",
        }) as never,
    );
    jest.spyOn(prisma.dispatchOffer, "findUnique").mockImplementation(
      ({ where }) =>
        ({
          id: String(where.id),
          bookingId: "00000000-0000-0000-0000-000000000001",
          dispatchCycleId: "cycle-id",
          driverId:
            where.id === "00000000-0000-0000-0000-000000000006"
              ? "00000000-0000-0000-0000-000000000002"
              : "00000000-0000-0000-0000-000000000003",
          vehicleId:
            where.id === "00000000-0000-0000-0000-000000000006"
              ? "00000000-0000-0000-0000-000000000008"
              : "00000000-0000-0000-0000-000000000009",
          attemptNumber: 1,
          status: "OFFERED",
          expiresAt: new Date(Date.now() + 30_000),
          assignment: null,
          booking: { assignedDriverId: null, trip: null },
        }) as never,
    );
    jest
      .spyOn(DriverAvailabilityService.prototype, "eligibility")
      .mockImplementation((driverId) =>
        Promise.resolve({
          eligible: true,
          vehicle: {
            id:
              driverId === "00000000-0000-0000-0000-000000000002"
                ? "00000000-0000-0000-0000-000000000008"
                : "00000000-0000-0000-0000-000000000009",
          },
        } as never),
      );
    jest
      .spyOn(redis, "set")
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(null);
    jest.spyOn(redis, "eval").mockResolvedValue(1);
    jest.spyOn(prisma.driverAssignment, "findFirst").mockResolvedValue(null);
    jest.spyOn(prisma, "$transaction").mockResolvedValue({
      assignmentId: "assignment-id",
      bookingId: "00000000-0000-0000-0000-000000000001",
      tripId: "trip-id",
      vehicleId: "00000000-0000-0000-0000-000000000008",
      driverId: "00000000-0000-0000-0000-000000000002",
      dispatchCycleId: "cycle-id",
      attemptNumber: 1,
    });
    jest
      .spyOn(DispatchLockService.prototype as never, "afterAcceptance" as never)
      .mockResolvedValue(undefined as never);
    const service = new DispatchService();

    const outcomes = await Promise.allSettled([
      service.accept(
        "00000000-0000-0000-0000-000000000006",
        "00000000-0000-0000-0000-000000000004",
      ),
      service.accept(
        "00000000-0000-0000-0000-000000000007",
        "00000000-0000-0000-0000-000000000005",
      ),
    ]);

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect((rejected?.reason as Error).message).toBe("OFFER_TAKEN");
  });
});
