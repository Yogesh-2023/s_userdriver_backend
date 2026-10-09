import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { hashPassword } from "../src/common/password";
import { prisma } from "../src/database/prisma";
import { closeQueues } from "../src/infrastructure/queues";
import { redis } from "../src/infrastructure/redis";

type Login = { cookie: string; csrfToken: string; admin: any };
type DriverLogin = { cookie: string; csrfToken: string; user: any };

describe("Vehicle Category Integration", () => {
  let app: FastifyInstance;
  const adminPassword = "Integration-Admin-Password-123!";
  let phoneSequence = 0;

  const nextPhone = () => {
    phoneSequence += 1;
    return `+9188${String(Date.now() + phoneSequence).slice(-8)}`;
  };

  const provisionAdmin = async (): Promise<Login> => {
    const role = await prisma.role.upsert({
      where: { name: "SUPER_ADMIN" },
      update: {},
      create: { name: "SUPER_ADMIN", isSystem: true },
    });
    const phone = nextPhone();
    const email = `admin-${Date.now()}-${phoneSequence}@example.test`;
    const user = await prisma.user.create({
      data: {
        phone,
        email,
        phoneVerifiedAt: new Date(),
        status: "ACTIVE",
        displayName: "Integration Admin",
        roles: { create: { roleId: role.id } },
        adminProfile: {
          create: {
            title: "Test Admin",
            credential: {
              create: { passwordHash: await hashPassword(adminPassword) },
            },
          },
        },
      },
      include: { adminProfile: true, roles: { include: { role: true } } },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: {
        email,
        password: adminPassword,
        deviceInfo: { platform: "integration-test" },
      },
    });
    const body = res.json<{ data: { csrfToken: string } }>();
    const header = res.headers["set-cookie"];
    const value = Array.isArray(header)
      ? header[0]
      : typeof header === "string"
        ? header
        : "";
    return {
      cookie: value?.split(";")[0] as string,
      csrfToken: body.data.csrfToken,
      admin: user,
    };
  };

  const provisionDriver = async (): Promise<DriverLogin> => {
    const role = await prisma.role.upsert({
      where: { name: "DRIVER" },
      update: {},
      create: { name: "DRIVER", isSystem: true },
    });
    const phone = nextPhone();
    const user = await prisma.user.create({
      data: {
        phone,
        status: "ACTIVE",
        phoneVerifiedAt: new Date(),
        roles: { create: { roleId: role.id } },
        driverProfile: {
          create: {
            licenseNumber: `DL-${Date.now()}-${phoneSequence}`,
            verificationStatus: "VERIFIED",
          },
        },
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp/request",
      payload: { phone, role: "DRIVER" },
    });
    const verified = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp/verify",
      payload: {
        phone,
        role: "DRIVER",
        otp: "1234",
        deviceInfo: { platform: "integration-test" },
      },
    });
    const body = verified.json<{ data: { csrfToken: string } }>();
    const header = verified.headers["set-cookie"];
    const value = Array.isArray(header)
      ? header[0]
      : typeof header === "string"
        ? header
        : "";
    return {
      cookie: value?.split(";")[0] as string,
      csrfToken: body.data.csrfToken,
      user,
    };
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await prisma.driverVehicleAssignment.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.pricingRule.deleteMany();
    await prisma.surgePricingRule.deleteMany();
    await prisma.vehicleCategory.deleteMany();
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
    await closeQueues();
  });

  let superAdmin: Login;
  let activeCategoryId: string;

  it("Admin creates a vehicle category", async () => {
    superAdmin = await provisionAdmin();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/vehicle-categories",
      headers: {
        cookie: superAdmin.cookie,
        "x-csrf-token": superAdmin.csrfToken,
      },
      payload: {
        name: "Sedan Category",
        description: "Test",
        capacity: 4,
        minSeatingCapacity: 4,
        maxSeatingCapacity: 5,
        allowedFuelTypes: ["PETROL", "CNG"],
        isActive: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    activeCategoryId = body.data.id;
  });

  let driver: DriverLogin;

  it("Driver lists vehicle categories", async () => {
    driver = await provisionDriver();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/drivers/vehicle-categories",
      headers: {
        cookie: driver.cookie,
        "x-csrf-token": driver.csrfToken,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].id).toBe(activeCategoryId);
  });

  it("Driver creates a vehicle with an invalid category (capacity mismatch)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/drivers/vehicles",
      headers: {
        cookie: driver.cookie,
        "x-csrf-token": driver.csrfToken,
      },
      payload: {
        brand: "Toyota",
        model: "Camry",
        manufacturingYear: 2022,
        color: "White",
        registrationNumber: `PLATE-${Date.now()}`,
        fuelType: "PETROL",
        seatingCapacity: 2, // Fails because min is 4
        categoryId: activeCategoryId,
      },
    });
    expect(res.statusCode).toBe(400); // Bad Request from validation
  });

  it("Driver creates a vehicle successfully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/drivers/vehicles",
      headers: {
        cookie: driver.cookie,
        "x-csrf-token": driver.csrfToken,
      },
      payload: {
        brand: "Toyota",
        model: "Camry",
        manufacturingYear: 2022,
        color: "White",
        registrationNumber: `PLATE-${Date.now()}`,
        fuelType: "PETROL",
        seatingCapacity: 4,
        categoryId: activeCategoryId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.categoryId).toBe(activeCategoryId);
  });
});
