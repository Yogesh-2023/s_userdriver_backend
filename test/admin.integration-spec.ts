import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { hashPassword } from "../src/common/password";
import { prisma } from "../src/database/prisma";
import { closeQueues, queues } from "../src/infrastructure/queues";
import { redis } from "../src/infrastructure/redis";

type Login = {
  cookie: string;
  csrfToken: string;
  admin: { id: string; userId: string; roles: string[] };
};

type UserLogin = {
  cookie: string;
  csrfToken: string;
  user: { id: string };
};

describe("admin management integration", () => {
  const adminPassword = "Integration-Admin-Password-123!";
  let app: FastifyInstance;
  let phoneSequence = 0;
  let fareCategoryId: string | undefined;

  const nextPhone = () => {
    phoneSequence += 1;
    return `+9188${String(Date.now() + phoneSequence).slice(-8)}`;
  };

  const provisionAdmin = async (
    status: "ACTIVE" | "SUSPENDED" | "BLOCKED" = "ACTIVE",
    roleName = "SUPER_ADMIN",
  ) => {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, isSystem: true },
    });
    const phone = nextPhone();
    const email = `admin-${Date.now()}-${phoneSequence}@example.test`;
    const passwordHash = await hashPassword(adminPassword);
    const user = await prisma.user.create({
      data: {
        phone,
        email,
        phoneVerifiedAt: new Date(),
        status,
        displayName: "Integration Admin",
        roles: { create: { roleId: role.id } },
        adminProfile: {
          create: {
            title: "Test Administrator",
            credential: { create: { passwordHash } },
          },
        },
      },
      include: { adminProfile: true },
    });
    return { email, phone, user };
  };

  const cookieFrom = (response: {
    headers: Record<string, string | string[] | number | undefined>;
  }) => {
    const header = response.headers["set-cookie"];
    const value = Array.isArray(header)
      ? header[0]
      : typeof header === "string"
        ? header
        : "";
    if (!value) throw new Error("Session cookie was not set");
    return value.split(";")[0]!;
  };

  const login = async (
    email: string,
    currentCookie?: string,
    password = adminPassword,
  ): Promise<Login> => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: {
        email,
        password,
        deviceInfo: { platform: "integration-test" },
      },
      headers: currentCookie ? { cookie: currentCookie } : undefined,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: {
        csrfToken: string;
        admin: Login["admin"];
      };
    }>();
    return {
      cookie: cookieFrom(response),
      csrfToken: body.data.csrfToken,
      admin: body.data.admin,
    };
  };

  const loginCustomer = async (): Promise<UserLogin> => {
    const phone = nextPhone();
    const requested = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp/request",
      payload: { phone, role: "CUSTOMER" },
    });
    expect(requested.statusCode).toBe(202);
    const verified = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp/verify",
      payload: {
        phone,
        role: "CUSTOMER",
        otp: "1234",
        deviceInfo: { platform: "integration-test" },
      },
    });
    expect(verified.statusCode).toBe(200);
    const body = verified.json<{
      data: { csrfToken: string; user: UserLogin["user"] };
    }>();
    return {
      cookie: cookieFrom(verified),
      csrfToken: body.data.csrfToken,
      user: body.data.user,
    };
  };

  beforeAll(async () => {
    await redis.flushdb();
    app = await buildApp();
  });

  afterAll(async () => {
    if (fareCategoryId) {
      await prisma.pricingRule.deleteMany({
        where: { vehicleCategoryId: fareCategoryId },
      });
      await prisma.vehicleCategory.deleteMany({
        where: { id: fareCategoryId },
      });
    }
    await app.close();
    await closeQueues();
    await redis.quit();
    await prisma.$disconnect();
  });

  it("logs in an active admin by email and password and sets only an HttpOnly cookie", async () => {
    const { email, phone } = await provisionAdmin();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: {
        email,
        password: adminPassword,
        deviceInfo: { platform: "android" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toEqual(
      expect.stringContaining("HttpOnly"),
    );
    expect(response.headers["set-cookie"]).toEqual(
      expect.stringContaining("SameSite=Strict"),
    );
    expect(response.json()).not.toHaveProperty("data.sessionId");

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/me",
      headers: { cookie: cookieFrom(response) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      success: true,
      data: { phone, status: "ACTIVE" },
    });
  });

  it("rejects an invalid password and records the failed login", async () => {
    const { email } = await provisionAdmin();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email, password: "Wrong-Admin-Password-123!" },
    });
    expect(response.statusCode).toBe(401);
    expect(
      await prisma.loginHistory.count({
        where: {
          identifier: email,
          successful: false,
          failureCode: "INVALID_CREDENTIALS",
        },
      }),
    ).toBe(1);
  });

  it("rejects inactive admins and non-admin users without disclosing account type", async () => {
    const inactive = await provisionAdmin("SUSPENDED");
    const inactiveResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email: inactive.email, password: adminPassword },
    });
    expect(inactiveResponse.statusCode).toBe(401);

    const customerRole = await prisma.role.upsert({
      where: { name: "CUSTOMER" },
      update: {},
      create: { name: "CUSTOMER", isSystem: true },
    });
    const phone = nextPhone();
    const email = `customer-${Date.now()}-${phoneSequence}@example.test`;
    const customer = await prisma.user.create({
      data: {
        phone,
        email,
        roles: { create: { roleId: customerRole.id } },
        customerProfile: {
          create: { referralCode: `IT${Date.now().toString(36)}` },
        },
      },
    });
    const nonAdminResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email: customer.email, password: adminPassword },
    });
    expect(nonAdminResponse.statusCode).toBe(401);
  });

  it("creates password credentials and revokes the target session on password reset", async () => {
    await prisma.role.upsert({
      where: { name: "ADMIN" },
      update: {},
      create: { name: "ADMIN", isSystem: true },
    });
    const { email: ownerEmail } = await provisionAdmin();
    const owner = await login(ownerEmail);
    const targetEmail = `managed-${Date.now()}-${phoneSequence}@example.test`;
    const targetPassword = "Managed-Admin-Password-123!";
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/admins",
      headers: {
        cookie: owner.cookie,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        phone: nextPhone(),
        email: targetEmail,
        password: targetPassword,
        displayName: "Managed Admin",
        role: "ADMIN",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(JSON.stringify(created.json())).not.toContain("password");
    expect(JSON.stringify(created.json())).not.toContain("scrypt$");
    const targetAdminId = created.json().data.adminProfile.id as string;

    const target = await login(targetEmail, undefined, targetPassword);
    const newPassword = "Managed-Admin-New-Password-456!";
    const reset = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/admins/${targetAdminId}/password`,
      headers: {
        cookie: owner.cookie,
        "x-csrf-token": owner.csrfToken,
      },
      payload: {
        password: newPassword,
        reason: "Integration credential rotation",
      },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({
      data: { adminId: targetAdminId, revokedSessions: 1 },
    });

    const revoked = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/me",
      headers: { cookie: target.cookie },
    });
    expect(revoked.statusCode).toBe(401);
    const oldPassword = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email: targetEmail, password: targetPassword },
    });
    expect(oldPassword.statusCode).toBe(401);
    await login(targetEmail, undefined, newPassword);
  });

  it("enforces CSRF and revokes the current session on logout", async () => {
    const { email } = await provisionAdmin();
    const session = await login(email);
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/logout",
      headers: { cookie: session.cookie },
    });
    expect(rejected.statusCode).toBe(403);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/logout",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
    });
    expect(logout.statusCode).toBe(200);
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/me",
      headers: { cookie: session.cookie },
    });
    expect(me.statusCode).toBe(401);
  });

  it("allows only the newest admin login to remain active", async () => {
    const { email, user } = await provisionAdmin();
    const first = await login(email);
    const second = await login(email);

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/me",
      headers: { cookie: first.cookie },
    });
    const newSession = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/me",
      headers: { cookie: second.cookie },
    });
    expect(oldSession.statusCode).toBe(401);
    expect(newSession.statusCode).toBe(200);
    expect(
      await prisma.session.count({
        where: { userId: user.id, isRevoked: false },
      }),
    ).toBe(1);
  });

  it("logout-all revokes the single active admin session", async () => {
    const { email } = await provisionAdmin();
    const session = await login(email);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/logout-all",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { revokedSessions: 1 },
    });
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/me",
      headers: { cookie: session.cookie },
    });
    expect(me.statusCode).toBe(401);
  });

  it("returns revocation handles without exposing raw authentication IDs", async () => {
    const { email, user } = await provisionAdmin();
    const session = await login(email);
    const raw = await prisma.session.findFirstOrThrow({
      where: { userId: user.id, isRevoked: false },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/sessions",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).not.toContain(raw.id);
    expect(response.json()).toMatchObject({
      data: [{ sessionId: raw.managementId }],
    });
  });

  it("validates, persists, audits, and caches allowlisted configuration", async () => {
    const { email } = await provisionAdmin();
    const session = await login(email);
    const update = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/config/dispatch.search_radius_km",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
      payload: { value: 18, reason: "Integration validation update" },
    });
    expect(update.statusCode).toBe(200);
    const get = await app.inject({
      method: "GET",
      url: "/api/v1/admin/config/dispatch.search_radius_km",
      headers: { cookie: session.cookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ data: { value: 18 } });
    expect(await redis.get("config:dispatch.search_radius_km")).toBeTruthy();
    expect(
      await prisma.systemSettingHistory.count({
        where: { setting: { key: "dispatch.search_radius_km" } },
      }),
    ).toBeGreaterThan(0);

    const secret = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/config/razorpay.secret",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
      payload: { value: "never-store-this", reason: "Must be rejected" },
    });
    expect(secret.statusCode).toBe(400);
  });

  it("creates idempotent notification campaigns and queued report exports", async () => {
    const { email, user } = await provisionAdmin();
    const session = await login(email);
    const idempotencyKey = `integration-campaign-${Date.now()}`;
    const payload = {
      audience: { type: "SELECTED_USERS", userIds: [user.id] },
      channels: ["IN_APP"],
      title: "Service update",
      body: "Your service is ready.",
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notifications/send",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
        "x-idempotency-key": idempotencyKey,
      },
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notifications/send",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
        "x-idempotency-key": idempotencyKey,
      },
      payload,
    });
    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json().data.id).toBe(first.json().data.id);
    expect(
      await queues.notifications.getJob(
        `notification-campaign-${first.json().data.id}`,
      ),
    ).not.toBeNull();

    const exported = await app.inject({
      method: "POST",
      url: "/api/v1/admin/reports/export",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
      payload: { type: "customers", format: "CSV", groupBy: "daily" },
    });
    expect(exported.statusCode).toBe(202);
    expect(exported.json()).toMatchObject({ data: { status: "QUEUED" } });
    expect(
      await queues.reports.getJob(`report-export-${exported.json().data.id}`),
    ).not.toBeNull();
  });

  it("prevents fare overlap, versions changes, and previews with production pricing", async () => {
    const { email } = await provisionAdmin();
    const session = await login(email);
    const categorySuffix = Date.now();
    const category = await prisma.vehicleCategory.create({
      data: {
        slug: `integration-fare-category-${categorySuffix}`,
        name: "BIKE" as any,
        minPassengers: 1,
        maxPassengers: 4,
      },
    });
    fareCategoryId = category.id;
    const scopeKey = `INTEGRATION_${Date.now()}`;
    const effectiveFrom = new Date(Date.now() - 60_000).toISOString();
    const farePayload = {
      vehicleCategoryId: category.id,
      rideType: "CITY",
      scopeKey,
      baseFare: 50,
      minimumFare: 10,
      perKilometer: 10,
      perMinute: 2,
      waitingPerMinute: 1,
      cancellationFee: 25,
      driverAllowance: 0,
      platformCommission: 15,
      taxPercentage: 0,
      nightCharge: 0,
      effectiveFrom,
      isActive: true,
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/fares",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
      payload: farePayload,
    });
    expect(created.statusCode).toBe(201);
    const fareId = created.json().data.id as string;

    const overlap = await app.inject({
      method: "POST",
      url: "/api/v1/admin/fares",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
      payload: farePayload,
    });
    expect(overlap.statusCode).toBe(409);

    const versioned = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/fares/${fareId}`,
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        baseFare: 60,
        effectiveFrom: new Date(Date.now() + 1_000).toISOString(),
      },
    });
    expect(versioned.statusCode).toBe(200);
    expect(versioned.json()).toMatchObject({
      data: { version: 2, supersedesId: fareId },
    });

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/admin/fares/history?vehicleCategoryId=${category.id}&scopeKey=${scopeKey}`,
      headers: { cookie: session.cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().data).toHaveLength(2);

    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/admin/fares/calculate-preview",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        vehicleCategoryId: category.id,
        rideType: "CITY",
        distanceMeters: 1_000,
        durationSeconds: 60,
        waitingMinutes: 0,
        tollCharge: 0,
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      data: { total: 62, currency: "INR" },
    });
  });

  it("returns real aggregate dashboard data from PostgreSQL", async () => {
    const { email } = await provisionAdmin();
    const session = await login(email);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/reports/dashboard",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        timezone: "UTC",
        revenueDefinitions: expect.any(Object),
      },
    });
    expect(response.json().data.totalCustomers).toBeGreaterThanOrEqual(1);
  });

  it("keeps support internal notes private and records replies, assignment, and escalation", async () => {
    const { email } = await provisionAdmin();
    const admin = await login(email);
    const customer = await loginCustomer();
    const categoryResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/support/categories",
      headers: {
        cookie: admin.cookie,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        code: `IT_SUPPORT_${Date.now()}`,
        name: "Integration Support",
      },
    });
    expect(categoryResponse.statusCode).toBe(201);
    const categoryId = categoryResponse.json().data.id as string;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/support/tickets",
      headers: {
        cookie: customer.cookie,
        "x-csrf-token": customer.csrfToken,
      },
      payload: {
        categoryId,
        subject: "A real support request",
        message: "Please review this issue.",
      },
    });
    expect(created.statusCode).toBe(201);
    const ticketId = created.json().data.id as string;

    const assigned = await app.inject({
      method: "POST",
      url: `/api/v1/admin/support/tickets/${ticketId}/assign`,
      headers: {
        cookie: admin.cookie,
        "x-csrf-token": admin.csrfToken,
      },
      payload: {
        adminId: admin.admin.id,
        reason: "Owned by integration administrator",
      },
    });
    expect(assigned.statusCode).toBe(200);

    const internal = await app.inject({
      method: "POST",
      url: `/api/v1/admin/support/tickets/${ticketId}/internal-note`,
      headers: {
        cookie: admin.cookie,
        "x-csrf-token": admin.csrfToken,
      },
      payload: { note: "Private investigation details." },
    });
    expect(internal.statusCode).toBe(200);

    const publicReply = await app.inject({
      method: "POST",
      url: `/api/v1/admin/support/tickets/${ticketId}/reply`,
      headers: {
        cookie: admin.cookie,
        "x-csrf-token": admin.csrfToken,
      },
      payload: { message: "We are reviewing your request." },
    });
    expect(publicReply.statusCode).toBe(200);

    const customerView = await app.inject({
      method: "GET",
      url: `/api/v1/support/tickets/${ticketId}`,
      headers: { cookie: customer.cookie },
    });
    expect(customerView.statusCode).toBe(200);
    const visibleMessages = customerView.json().data.messages as Array<{
      message: string;
    }>;
    expect(visibleMessages.map(({ message }) => message)).toContain(
      "We are reviewing your request.",
    );
    expect(visibleMessages.map(({ message }) => message)).not.toContain(
      "Private investigation details.",
    );

    const escalated = await app.inject({
      method: "POST",
      url: `/api/v1/admin/support/tickets/${ticketId}/escalate`,
      headers: {
        cookie: admin.cookie,
        "x-csrf-token": admin.csrfToken,
      },
      payload: { reason: "Requires senior operational review" },
    });
    expect(escalated.statusCode).toBe(200);
    expect(escalated.json()).toMatchObject({
      data: { status: "ESCALATED" },
    });
    expect(
      await prisma.supportStatusHistory.count({ where: { ticketId } }),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.supportAssignmentHistory.count({ where: { ticketId } }),
    ).toBe(1);
  });
});
