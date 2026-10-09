import { prisma } from "../src/database/prisma";
import { envelope } from "../src/realtime/socket-emitter.service";
import {
  canJoinAdminRoom,
  canJoinOperationalRoom,
} from "../src/realtime/socket-room.service";

describe("realtime envelope and room authorization", () => {
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => prisma.$disconnect());

  it("creates a versioned envelope without transport or session internals", () => {
    const result = envelope(
      "booking:driver-assigned",
      { bookingId: "booking-id", safe: true },
      { requestId: "request-id" },
    );
    expect(result).toMatchObject({
      event: "booking:driver-assigned",
      version: 1,
      data: { bookingId: "booking-id", safe: true },
      meta: {
        requestId: "request-id",
        bookingId: "booking-id",
        tripId: null,
        dispatchCycleId: null,
        sequence: null,
      },
    });
    expect(result.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(JSON.stringify(result)).not.toContain("sessionId");
    expect(JSON.stringify(result)).not.toContain("cookie");
  });

  it("requires the exact admin room permission", () => {
    expect(
      canJoinAdminRoom("admin:tracking", {
        roles: ["ADMIN"],
        permissions: ["trips.monitor"],
      }),
    ).toBe(true);
    expect(
      canJoinAdminRoom("admin:tracking", {
        roles: ["ADMIN"],
        permissions: ["dashboard.read"],
      }),
    ).toBe(false);
    expect(
      canJoinAdminRoom("admin:not-real", {
        roles: ["SUPER_ADMIN"],
        permissions: [],
      }),
    ).toBe(false);
  });

  it("allows only a booking owner or assigned driver", async () => {
    jest.spyOn(prisma.booking, "findUnique").mockResolvedValue({
      customer: { userId: "customer-user" },
      dispatchOffers: [{ driver: { userId: "driver-user" } }],
    } as never);
    const base = {
      sessionId: "session",
      roles: ["CUSTOMER"],
      permissions: [],
    };
    await expect(
      canJoinOperationalRoom("booking:booking-id", {
        ...base,
        userId: "customer-user",
      }),
    ).resolves.toBe(true);
    await expect(
      canJoinOperationalRoom("booking:booking-id", {
        ...base,
        userId: "unrelated-user",
      }),
    ).resolves.toBe(false);
  });

  it("does not grant an ordinary admin a trip room without monitor permission", async () => {
    const base = {
      sessionId: "session",
      userId: "admin-user",
      roles: ["ADMIN"],
    };
    await expect(
      canJoinOperationalRoom("trip:trip-id", {
        ...base,
        permissions: ["dashboard.read"],
      }),
    ).resolves.toBe(false);
    await expect(
      canJoinOperationalRoom("trip:trip-id", {
        ...base,
        permissions: ["trips.monitor"],
      }),
    ).resolves.toBe(true);
  });
});
