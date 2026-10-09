import type { FastifyRequest } from "fastify";
import { hashPassword, verifyPassword } from "../../../common/password";
import { canJoinAdminRoom } from "../../../realtime/socket-room.service";
import {
  requireAdminPermission,
  requireCustomerStatusPermission,
  requireSuperAdmin,
} from "../admin.middleware";
import {
  adminLogin,
  bookingList,
  driverList,
  fareBody,
  notificationAudience,
} from "../admin.validation";

const requestWithAdmin = (roles: string[], permissions: string[]) =>
  ({
    admin: {
      id: "9e729248-a24a-4450-955b-c9415403eed6",
      userId: "40f2e9e7-d4b9-47e9-9ca4-54aa35f3d3d7",
      roles,
      permissions,
    },
  }) as unknown as FastifyRequest;

describe("admin authorization", () => {
  it("rejects a missing permission", async () => {
    await expect(
      requireAdminPermission("customers.read")(requestWithAdmin(["ADMIN"], [])),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an explicitly granted permission", async () => {
    await expect(
      requireAdminPermission("customers.read")(
        requestWithAdmin(["ADMIN"], ["customers.read"]),
      ),
    ).resolves.toBeUndefined();
  });

  it("allows super-admin to bypass individual permissions", async () => {
    const request = requestWithAdmin(["SUPER_ADMIN"], []);
    await expect(
      requireAdminPermission("config.update")(request),
    ).resolves.toBeUndefined();
    await expect(requireSuperAdmin(request)).resolves.toBeUndefined();
  });

  it("requires the stronger soft-delete permission", async () => {
    const request = requestWithAdmin(["ADMIN"], ["customers.block"]);
    request.body = { status: "DELETED" };
    await expect(
      requireCustomerStatusPermission(request),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    request.body = { status: "BLOCKED" };
    await expect(
      requireCustomerStatusPermission(request),
    ).resolves.toBeUndefined();
  });

  it("denies arbitrary and unauthorized Socket.IO admin rooms", () => {
    expect(
      canJoinAdminRoom("admin:tracking", {
        roles: ["ADMIN"],
        permissions: ["dashboard.read"],
      }),
    ).toBe(false);
    expect(
      canJoinAdminRoom("admin:tracking", {
        roles: ["ADMIN"],
        permissions: ["trips.monitor"],
      }),
    ).toBe(true);
    expect(
      canJoinAdminRoom("admin:anything", {
        roles: ["SUPER_ADMIN"],
        permissions: [],
      }),
    ).toBe(false);
  });
});

describe("admin input allowlists", () => {
  it("requires a valid email and a password of at least eight characters", () => {
    expect(
      adminLogin.safeParse({
        email: "ADMIN@EXAMPLE.COM",
        password: "Secure-Password-123!",
      }).success,
    ).toBe(true);
    expect(
      adminLogin.safeParse({
        email: "not-an-email",
        password: "Secure-Password-123!",
      }).success,
    ).toBe(false);
    expect(
      adminLogin.safeParse({
        email: "admin@example.com",
        password: "short",
      }).success,
    ).toBe(false);
  });

  it("rejects inverted date and rating ranges", () => {
    expect(
      bookingList.safeParse({
        from: "2026-08-02T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(driverList.safeParse({ minRating: 4, maxRating: 2 }).success).toBe(
      false,
    );
  });

  it("rejects overlapping fare dates and invalid monetary values", () => {
    expect(
      fareBody.safeParse({
        vehicleCategoryId: "8593ba67-c1f5-4a85-b762-03170dad9331",
        rideType: "CITY",
        baseFare: -1,
        minimumFare: 10,
        perKilometer: 5,
        perMinute: 1,
        effectiveFrom: "2026-08-02T00:00:00.000Z",
        effectiveTo: "2026-08-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts only supported server-side notification audiences", () => {
    expect(
      notificationAudience.safeParse({
        type: "SQL_FILTER",
        where: "status = 'ACTIVE'",
      }).success,
    ).toBe(false);
    expect(
      notificationAudience.safeParse({
        type: "USER_STATUS",
        status: "ACTIVE",
        role: "DRIVER",
      }).success,
    ).toBe(true);
  });
});

describe("admin password storage", () => {
  it("stores only a salted scrypt hash and rejects a different password", async () => {
    const password = "Secure-Admin-Password-123!";
    const encoded = await hashPassword(password);
    expect(encoded).toMatch(/^scrypt\$/);
    expect(encoded).not.toContain(password);
    await expect(verifyPassword(password, encoded)).resolves.toBe(true);
    await expect(
      verifyPassword("Different-Admin-Password-123!", encoded),
    ).resolves.toBe(false);
  });
});
