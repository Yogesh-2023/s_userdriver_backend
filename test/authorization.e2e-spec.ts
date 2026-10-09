import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { prisma } from "../src/database/prisma";
import { closeQueues } from "../src/infrastructure/queues";
import { redis } from "../src/infrastructure/redis";
import { SessionsService } from "../src/modules/sessions/service";
import { hashPassword } from "../src/common/password";

describe("Authorization and Data Protection (E2E)", () => {
  let app: FastifyInstance;
  const sessions = new SessionsService();

  let customer1Id: string;
  let customer1Cookie: string;

  let customer2Id: string;
  let customer2Cookie: string;

  let adminId: string;
  let adminCookie: string;

  let bookingId: string;

  beforeAll(async () => {
    app = await buildApp();

    // 1. Setup Roles
    const customerRole = await prisma.role.upsert({
      where: { name: "CUSTOMER" },
      update: {},
      create: { name: "CUSTOMER", description: "Customer role" },
    });

    const adminRole = await prisma.role.upsert({
      where: { name: "ADMIN" },
      update: {},
      create: { name: "ADMIN", description: "Admin role" },
    });

    // 2. Create Customer 1
    const user1 = await prisma.user.upsert({
      where: { phone: "+918888888881" },
      update: {},
      create: {
        phone: "+918888888881",
        email: "c1@test.com",
        status: "ACTIVE",
        customerProfile: { create: { referralCode: "REF1" } },
        roles: { create: { roleId: customerRole.id } },
      },
      include: { customerProfile: true },
    });
    customer1Id = user1.customerProfile!.id;
    const session1 = await sessions.create(user1.id, {
      ipAddress: "127.0.0.1",
    });
    customer1Cookie = `fleet_session=${app.signCookie(session1.cookieValue)}`;

    // 3. Create Customer 2
    const user2 = await prisma.user.upsert({
      where: { phone: "+918888888882" },
      update: {},
      create: {
        phone: "+918888888882",
        email: "c2@test.com",
        status: "ACTIVE",
        customerProfile: { create: { referralCode: "REF2" } },
        roles: { create: { roleId: customerRole.id } },
      },
      include: { customerProfile: true },
    });
    customer2Id = user2.customerProfile!.id;
    const session2 = await sessions.create(user2.id, {
      ipAddress: "127.0.0.1",
    });
    customer2Cookie = `fleet_session=${app.signCookie(session2.cookieValue)}`;

    // 4. Create Admin (without refund permissions)
    const adminUser = await prisma.user.upsert({
      where: { phone: "+918888888883" },
      update: {},
      create: {
        phone: "+918888888883",
        email: "admin@test.com",
        status: "ACTIVE",
        adminProfile: {
          create: {
            credential: {
              create: {
                passwordHash: await hashPassword("password123"),
              },
            },
          },
        },
        roles: { create: { roleId: adminRole.id } },
      },
    });
    adminId = adminUser.id;
    const adminSession = await sessions.create(adminUser.id, {
      ipAddress: "127.0.0.1",
    });
    adminCookie = `fleet_session=${app.signCookie(adminSession.cookieValue)}`;

    // 5. Create a booking for Customer 1
    const category = await prisma.vehicleCategory.upsert({
      where: { slug: "test-category" },
      update: {},
      create: {
        name: "SEDAN" as any,
        slug: "test-category",
        displayOrder: 1,
        minPassengers: 1,
        maxPassengers: 4,
        allowedFuelTypes: ["PETROL"],
      },
    });

    const booking = await prisma.booking.create({
      data: {
        customerId: customer1Id,
        vehicleCategoryId: category.id,
        rideType: "CITY",
        pickupAddress: "Pickup",
        pickupLatitude: 12.9716,
        pickupLongitude: 77.5946,
        dropAddress: "Drop",
        dropLatitude: 12.9716,
        dropLongitude: 77.5946,
        status: "PENDING",
        distanceMeters: 5000,
        durationSeconds: 900,
        currency: "INR",
        estimatedFare: 150,
        idempotencyKey: randomUUID(),
      },
    });
    bookingId = booking.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await closeQueues();
    redis.disconnect();
    await prisma.$disconnect();
  });

  describe("IDOR Prevention: Resource Ownership", () => {
    it("Customer 1 can access their own booking", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/bookings/${bookingId}`,
        headers: { cookie: customer1Cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.id).toBe(bookingId);
    });

    it("Customer 2 CANNOT access Customer 1's booking", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/bookings/${bookingId}`,
        headers: { cookie: customer2Cookie },
      });
      // The application checks ownership and throws 403 or 404
      expect([403, 404]).toContain(response.statusCode);
    });
  });

  describe("Role-Based Access Control (Least Privilege)", () => {
    it("Admin without 'refunds.manage' permission cannot process refund", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refunds/${randomUUID()}/process`,
        headers: { cookie: adminCookie },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("FORBIDDEN");
    });

    it("Admin without 'fares.update' permission cannot update fare", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/fares/${randomUUID()}`,
        headers: { cookie: adminCookie },
        payload: { baseFare: 100 },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("FORBIDDEN");
    });
  });

  describe("API Response Sanitization", () => {
    it("Admin login response should not include passwordHash", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        payload: {
          email: "admin@test.com",
          password: "password123",
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data).toBeDefined();
      expect(data.admin).toBeDefined();

      // Ensure passwordHash is completely stripped
      expect(JSON.stringify(data)).not.toContain("passwordHash");
      expect(data.admin.credential).toBeUndefined();
    });
  });
});
