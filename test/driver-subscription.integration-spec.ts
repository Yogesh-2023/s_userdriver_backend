import { consumeSubscriptionTrip } from "../src/modules/driver/services/subscription-state";
import { DriverAvailabilityService } from "../src/modules/driver/services/driver-availability.service";
import { createHmac, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { buildApp } from "../src/app";
import { prisma } from "../src/database/prisma";
import { env } from "../src/config/env";
import { razorpay } from "../src/integrations/razorpay";
import { SessionsService } from "../src/modules/sessions/service";
import { DriverSubscriptionService } from "../src/modules/driver/services/driver-subscription.service";
import { PaymentsService } from "../src/modules/payments/service";
import { closeQueues } from "../src/infrastructure/queues";
import { redis } from "../src/infrastructure/redis";

// Opt in with an isolated, schema-initialized DB. No table-wide cleanup is used.
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("Driver subscription checkout integration", () => {
  let app: FastifyInstance;
  let cookie: string;
  let driverId: string;
  let userId: string;
  let planId: string;
  let orders = new Map<string, Record<string, unknown>>();
  let captures = new Map<string, Record<string, unknown>[]>();
  const api = new DriverSubscriptionService();
  const payments = new PaymentsService();
  const sessions = new SessionsService();
  const sessionIds: string[] = [];
  let createOrder: jest.SpyInstance;

  async function purchase(key = randomUUID(), selectedPlanId = planId) {
    return app.inject({
      method: "POST",
      url: "/api/v1/driver/subscriptions/purchase",
      headers: { cookie, "x-idempotency-key": key },
      payload: { planId: selectedPlanId },
    });
  }
  function capturedPayment(data: any, changes: Record<string, unknown> = {}) {
    const captured = {
      id: `pay_${randomUUID()}`,
      order_id: data.checkout.orderId,
      amount: data.checkout.amountMinor,
      currency: "INR",
      status: "captured",
      ...changes,
    };
    captures.set(data.checkout.orderId, [captured]);
    return captured;
  }
  async function verify(
    data: any,
    captured: Record<string, unknown>,
    selectedCookie = cookie,
  ) {
    const signature = createHmac("sha256", env.RAZORPAY_KEY_SECRET!)
      .update(`${data.checkout.orderId}|${String(captured.id)}`)
      .digest("hex");
    return app.inject({
      method: "POST",
      url: "/api/v1/payments/verify",
      headers: { cookie: selectedCookie },
      payload: {
        paymentId: data.paymentId,
        providerPaymentId: captured.id,
        signature,
      },
    });
  }
  async function webhook(
    data: any,
    captured: Record<string, unknown>,
    eventId = randomUUID(),
  ) {
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: captured } },
    });
    const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET!)
      .update(body)
      .digest("hex");
    return app.inject({
      method: "POST",
      url: "/api/v1/webhooks/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": eventId,
      },
      payload: body,
    });
  }

  beforeAll(async () => {
    if (!env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)
      throw new Error("Set test Razorpay secrets; gateway calls are mocked");
    await prisma.role.upsert({
      where: { name: "DRIVER" },
      create: { name: "DRIVER" },
      update: {},
    });
    app = await buildApp();
    await app.ready();
  }, 30000);
  beforeEach(async () => {
    orders = new Map();
    captures = new Map();
    const suffix = randomUUID();
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: "DRIVER" },
    });
    const user = await prisma.user.create({
      data: {
        phone: `t${suffix.replace(/-/g, "").slice(0, 18)}`,
        status: "ACTIVE",
        roles: { create: { roleId: role.id } },
        driverProfile: { create: {} },
      },
      include: { driverProfile: true },
    });
    userId = user.id;
    driverId = user.driverProfile!.id;
    const session = await sessions.create(userId, {});
    sessionIds.push(session.session.sessionId);
    cookie = `${env.COOKIE_NAME}=${encodeURIComponent(app.signCookie(session.cookieValue))}`;
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: `Test ${suffix}`,
        price: "499",
        durationType: "MONTHLY",
        durationValue: 30,
        tripType: "LIMITED",
        numberOfTrips: 10,
        gstOrTax: "18",
      },
    });
    planId = plan.id;
    createOrder = jest
      .spyOn(razorpay, "createOrder")
      .mockImplementation(async (input) => {
        const order = {
          id: `order_${randomUUID()}`,
          amount: input.amountMinor,
          currency: input.currency,
          receipt: input.receipt,
          status: "created",
        };
        orders.set(order.id, order);
        return order;
      });
    jest
      .spyOn(razorpay, "getOrderPayments")
      .mockImplementation(async (id) => ({ items: captures.get(id) ?? [] }));
    jest
      .spyOn(razorpay, "getOrdersByReceipt")
      .mockImplementation(async (receipt) => ({
        items: [...orders.values()].filter((o) => o.receipt === receipt),
      }));
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    for (const id of sessionIds) await sessions.revoke(id, userId);
    if (app) await app.close();
    await closeQueues();
    await redis.quit();
    await prisma.$disconnect();
  }, 30000);

  it("requires a driver cookie, validates IDs and hides other drivers' purchases", async () => {
    expect(
      (await app.inject({ url: "/api/v1/driver/subscriptions/plans" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: "/api/v1/driver/subscriptions/plans/not-a-uuid",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400);
    const data = (await purchase()).json().data;
    await expect(
      api.getSubscription(randomUUID(), data.subscription.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    const stranger = await prisma.user.create({
      data: { phone: `o${randomUUID().replace(/-/g, "").slice(0, 18)}` },
    });
    const otherSession = await sessions.create(stranger.id, {});
    sessionIds.push(otherSession.session.sessionId);
    const otherCookie = `${env.COOKIE_NAME}=${encodeURIComponent(app.signCookie(otherSession.cookieValue))}`;
    expect(
      (
        await app.inject({
          url: "/api/v1/driver/subscriptions/plans",
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await verify(data, capturedPayment(data), otherCookie)).statusCode,
    ).toBe(403);
  });

  it("creates one real order for concurrent same-key purchases and exposes no secrets", async () => {
    const key = randomUUID();
    const responses = await Promise.all([purchase(key), purchase(key)]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(createOrder).toHaveBeenCalledTimes(1);
    const replay = (await purchase(key)).json().data;
    expect(responses[0].json().data.subscription.id).toBe(
      replay.subscription.id,
    );
    expect(await prisma.driverSubscription.count({ where: { driverId } })).toBe(
      1,
    );
    expect(replay.subscription).toMatchObject({
      status: "PENDING_PAYMENT",
      startDate: null,
      expiryDate: null,
      remainingTrips: 10,
    });
    expect(replay.checkout).toMatchObject({
      amountMinor: 49900,
      currency: "INR",
      keyId: env.RAZORPAY_KEY_ID,
    });
    expect(replay.payment).not.toHaveProperty("idempotencyKey");
    expect(replay.payment).not.toHaveProperty("metadata");
    expect(JSON.stringify(replay)).not.toContain(env.RAZORPAY_KEY_SECRET!);
  });

  it("blocks a different pending purchase and conflicting reuse of a key", async () => {
    const key = randomUUID();
    expect((await purchase(key)).statusCode).toBe(200);
    expect((await purchase()).statusCode).toBe(409);
    expect((await purchase(key, randomUUID())).statusCode).toBe(409);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("rejects missing idempotency and inactive plans before creating payment", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/driver/subscriptions/purchase",
          headers: { cookie },
          payload: { planId },
        })
      ).statusCode,
    ).toBe(400);
    await prisma.subscriptionPlan.update({
      where: { id: planId },
      data: { isActive: false },
    });
    expect((await purchase()).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/v1/driver/subscriptions/plans/${planId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("verifies captured money, activates using purchase snapshot, and permits manual renewal only after expiry", async () => {
    const data = (await purchase()).json().data;
    await prisma.subscriptionPlan.update({
      where: { id: planId },
      data: { durationValue: 1, price: 999 },
    });
    const captured = capturedPayment(data);
    const responses = await Promise.all([
      verify(data, captured),
      webhook(data, captured),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    const active = await api.getActiveSubscription(driverId);
    expect(active?.status).toBe("ACTIVE");
    expect(active!.expiryDate!.getTime() - active!.startDate!.getTime()).toBe(
      30 * 86400000,
    );
    expect(active!.priceAtPurchase.toString()).toBe("499");
    expect(
      await prisma.paymentTransaction.count({
        where: { paymentId: data.paymentId, type: "CAPTURED" },
      }),
    ).toBe(1);
    expect((await purchase()).statusCode).toBe(409);
    await prisma.driverSubscription.update({
      where: { id: active!.id },
      data: { expiryDate: new Date(Date.now() - 1000) },
    });
    expect(await api.getActiveSubscription(driverId)).toBeNull();
    expect((await api.getSubscription(driverId, active!.id)).status).toBe(
      "EXPIRED",
    );
    expect((await purchase()).statusCode).toBe(200);
  });

  it("does not activate on a bad signature, authorized-only payment, or wrong amount/currency", async () => {
    const data = (await purchase()).json().data;
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/payments/verify",
      headers: { cookie },
      payload: {
        paymentId: data.paymentId,
        providerPaymentId: "pay_fake",
        signature: "a".repeat(64),
      },
    });
    expect(bad.statusCode).toBe(401);
    expect(
      (await verify(data, capturedPayment(data, { status: "authorized" })))
        .statusCode,
    ).toBe(409);
    expect(
      (await verify(data, capturedPayment(data, { amount: 1 }))).statusCode,
    ).toBe(409);
    expect(
      (await verify(data, capturedPayment(data, { currency: "USD" })))
        .statusCode,
    ).toBe(409);
    expect(await api.getActiveSubscription(driverId)).toBeNull();
    expect(
      (await api.getSubscription(driverId, data.subscription.id)).payment
        ?.status,
    ).toBe("PENDING");
  });

  it("accepts real webhook event headers and duplicate deliveries without extending expiry", async () => {
    const data = (await purchase()).json().data;
    const captured = capturedPayment(data);
    const eventId = randomUUID();
    expect((await webhook(data, captured, eventId)).statusCode).toBe(200);
    const before = await api.getActiveSubscription(driverId);
    expect((await webhook(data, captured, eventId)).statusCode).toBe(200);
    expect((await webhook(data, captured)).statusCode).toBe(200);
    expect((await api.getActiveSubscription(driverId))!.expiryDate).toEqual(
      before!.expiryDate,
    );
  });

  it("rejects webhook amount mismatch and invalid signatures without activation", async () => {
    const data = (await purchase()).json().data;
    expect(
      (await webhook(data, capturedPayment(data, { amount: 12 }))).statusCode,
    ).toBe(200);
    expect(await api.getActiveSubscription(driverId)).toBeNull();
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": "bad",
        "x-razorpay-event-id": randomUUID(),
      },
      payload: { event: "payment.captured" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("recovers a missed callback via status reconciliation and keeps history owner scoped", async () => {
    const data = (await purchase()).json().data;
    capturedPayment(data);
    const result = await app.inject({
      url: `/api/v1/driver/subscriptions/${data.subscription.id}/payment?reconcile=true`,
      headers: { cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().data.subscription.status).toBe("ACTIVE");
    expect(result.json().data.checkout).toBeNull();
    const history = await app.inject({
      url: "/api/v1/driver/subscriptions/history?status=ACTIVE&page=1&limit=1",
      headers: { cookie },
    });
    expect(history.json().data.meta.total).toBe(1);
    expect(history.json().data.items[0].id).toBe(data.subscription.id);
    expect(
      (
        await app.inject({
          url: "/api/v1/driver/subscriptions/history?limit=101",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects reconciliation of an amount mismatch", async () => {
    const data = (await purchase()).json().data;
    capturedPayment(data, { amount: 1 });
    await expect(payments.reconcile(data.paymentId)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await api.getActiveSubscription(driverId)).toBeNull();
  });

  it("recovers an order after a timeout without issuing a second order", async () => {
    const recoveredOrderId = `order_${randomUUID()}`;
    createOrder.mockImplementationOnce(async (input: any) => {
      orders.set(recoveredOrderId, {
        id: recoveredOrderId,
        receipt: input.receipt,
        amount: input.amountMinor,
        currency: "INR",
      });
      throw new Error("lost response");
    });
    const key = randomUUID();
    expect((await purchase(key)).statusCode).toBe(503);
    const replay = (await purchase(key)).json().data;
    expect(replay.checkout).toBeNull();
    await prisma.payment.update({
      where: { id: replay.paymentId },
      data: { createdAt: new Date(Date.now() - 180000) },
    });
    const recovered = await api.paymentStatus(
      driverId,
      replay.subscription.id,
      true,
    );
    expect(recovered.checkout?.orderId).toBe(recoveredOrderId);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("marks a stale creation without a provider order failed and allows a new attempt", async () => {
    createOrder.mockRejectedValueOnce(new Error("provider unavailable"));
    const key = randomUUID();
    expect((await purchase(key)).statusCode).toBe(503);
    const replay = (await purchase(key)).json().data;
    await prisma.payment.update({
      where: { id: replay.paymentId },
      data: { createdAt: new Date(Date.now() - 180000) },
    });
    expect(
      (await api.paymentStatus(driverId, replay.subscription.id, true))
        .subscription.status,
    ).toBe("FAILED");
    expect((await purchase(key)).json().data.subscription.status).toBe(
      "FAILED",
    );
    expect((await purchase()).statusCode).toBe(200);
  });

  it("activates zero-price plans without a gateway and expires exhausted allowances", async () => {
    await prisma.subscriptionPlan.update({
      where: { id: planId },
      data: { price: new Prisma.Decimal(0) },
    });
    const response = await purchase();
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.subscription.status).toBe("ACTIVE");
    expect(data.payment.provider).toBe("FREE");
    expect(data.checkout).toBeNull();
    expect(createOrder).not.toHaveBeenCalled();
    await prisma.driverSubscription.update({
      where: { id: data.subscription.id },
      data: { remainingTrips: 0 },
    });
    expect(await api.getActiveSubscription(driverId)).toBeNull();
    expect(
      (await api.getSubscription(driverId, data.subscription.id)).status,
    ).toBe("EXPIRED");
  });
  it("rolls back capture if activation conflicts with an existing membership", async () => {
    const data = (await purchase()).json().data;
    await prisma.driverSubscription.create({
      data: {
        driverId,
        planId,
        status: "ACTIVE",
        startDate: new Date(),
        expiryDate: new Date(Date.now() + 86400000),
        priceAtPurchase: 499,
        taxAtPurchase: 0,
      },
    });
    expect((await verify(data, capturedPayment(data))).statusCode).toBe(409);
    const pending = await api.getSubscription(driverId, data.subscription.id);
    expect(pending.status).toBe("PENDING_PAYMENT");
    expect(pending.payment?.status).toBe("PENDING");
    expect(
      await prisma.paymentTransaction.count({
        where: { paymentId: data.paymentId, type: "CAPTURED" },
      }),
    ).toBe(0);
  });

  it("accounts against trip-start membership and rolls back allowance with failed completion", async () => {
    const now = new Date();
    const old = await prisma.driverSubscription.create({
      data: {
        driverId,
        planId,
        status: "EXPIRED",
        startDate: new Date(now.getTime() - 86400000),
        expiryDate: new Date(now.getTime() - 1000),
        remainingTrips: 1,
        priceAtPurchase: 499,
        taxAtPurchase: 0,
      },
    });
    const current = await prisma.driverSubscription.create({
      data: {
        driverId,
        planId,
        status: "ACTIVE",
        startDate: now,
        expiryDate: new Date(now.getTime() + 86400000),
        remainingTrips: 10,
        priceAtPurchase: 499,
        taxAtPurchase: 0,
      },
    });
    const tripStart = new Date(now.getTime() - 3600000);
    await expect(
      prisma.$transaction(async (tx) => {
        await consumeSubscriptionTrip(tx, driverId, tripStart);
        throw new Error("completion failed");
      }),
    ).rejects.toThrow("completion failed");
    expect((await api.getSubscription(driverId, old.id)).remainingTrips).toBe(
      1,
    );
    await prisma.$transaction((tx) =>
      consumeSubscriptionTrip(tx, driverId, tripStart),
    );
    expect((await api.getSubscription(driverId, old.id)).remainingTrips).toBe(
      0,
    );
    expect(
      (await api.getSubscription(driverId, current.id)).remainingTrips,
    ).toBe(10);
  });

  it("expires the last trip allowance and blocks going online without membership", async () => {
    await expect(
      new DriverAvailabilityService().goOnline(driverId),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "DRIVER_SUBSCRIPTION_REQUIRED",
    });
    const start = new Date(Date.now() - 1000);
    const record = await prisma.driverSubscription.create({
      data: {
        driverId,
        planId,
        status: "ACTIVE",
        startDate: start,
        expiryDate: new Date(Date.now() + 86400000),
        remainingTrips: 1,
        priceAtPurchase: 499,
        taxAtPurchase: 0,
      },
    });
    await prisma.$transaction((tx) =>
      consumeSubscriptionTrip(tx, driverId, new Date()),
    );
    expect(await api.getSubscription(driverId, record.id)).toMatchObject({
      status: "EXPIRED",
      remainingTrips: 0,
    });
  });
});
