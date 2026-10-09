import { createHash } from "node:crypto";
import { Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { env } from "../../../config/env";
import { razorpay } from "../../../integrations/razorpay";
import { PaymentsService } from "../../payments/service";
import {
  activeSubscriptionWhere,
  activatePaidSubscription,
  expireSubscriptions,
  lockSubscriptionDriver,
} from "./subscription-state";

const paymentSelect = {
  id: true,
  subscriptionId: true,
  amount: true,
  amountPaid: true,
  currency: true,
  method: true,
  status: true,
  provider: true,
  providerOrderId: true,
  providerPaymentId: true,
  metadata: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentSelect;
const detailsInclude = {
  plan: true,
  payment: { select: paymentSelect },
} satisfies Prisma.DriverSubscriptionInclude;

const pendingPaymentIsStale = (createdAt: Date) =>
  createdAt.getTime() < Date.now() - 30 * 60 * 1000;

const razorpayKeySnapshot = (metadata: Prisma.JsonValue | null | undefined) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  const value = (metadata as Record<string, unknown>).razorpayKeyId;
  return typeof value === "string" && value.trim() ? value : null;
};

const maskRazorpayKey = (key?: string | null) => {
  if (!key) return "missing";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
};

export class DriverSubscriptionService {
  async getActivePlans() {
    return prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ price: "asc" }, { id: "asc" }],
    });
  }

  async getPlan(planId: string) {
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { id: planId, isActive: true },
    });
    if (!plan) throw errors.notFound("Subscription plan not found or inactive");
    return plan;
  }

  async getActiveSubscription(driverId: string) {
    await expireSubscriptions(prisma, driverId);
    return prisma.driverSubscription.findFirst({
      where: activeSubscriptionWhere(driverId),
      include: { plan: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async getSubscription(driverId: string, subscriptionId: string) {
    await expireSubscriptions(prisma, driverId);
    const subscription = await prisma.driverSubscription.findFirst({
      where: { id: subscriptionId, driverId },
      include: detailsInclude,
    });
    if (!subscription) throw errors.notFound("Driver subscription not found");
    return subscription;
  }

  async history(
    driverId: string,
    input: { page: number; limit: number; status?: SubscriptionStatus },
  ) {
    await expireSubscriptions(prisma, driverId);
    const where = {
      driverId,
      ...(input.status ? { status: input.status } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.driverSubscription.findMany({
        where,
        include: detailsInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.driverSubscription.count({ where }),
    ]);
    return {
      items,
      meta: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  private checkout(
    payment: Awaited<
      ReturnType<DriverSubscriptionService["getSubscription"]>
    >["payment"],
  ) {
    if (
      !payment ||
      payment.provider !== razorpay.name ||
      !payment.providerOrderId ||
      !["CREATED", "PENDING", "AUTHORIZED"].includes(payment.status)
    )
      return null;
    const savedKeyId = razorpayKeySnapshot(payment.metadata);
    if (!savedKeyId || savedKeyId !== env.RAZORPAY_KEY_ID) {
      console.warn(
        [
          "[RAZORPAY][SUBSCRIPTION][CHECKOUT_BLOCKED]",
          `paymentId=${payment.id}`,
          `orderId=${payment.providerOrderId}`,
          `savedKey=${maskRazorpayKey(savedKeyId)}`,
          `currentKey=${maskRazorpayKey(env.RAZORPAY_KEY_ID)}`,
        ].join(" "),
      );
      return null;
    }
    return {
      provider: razorpay.name,
      keyId: env.RAZORPAY_KEY_ID,
      orderId: payment.providerOrderId,
      amountMinor: payment.amount.mul(100).toNumber(),
      currency: payment.currency,
    };
  }

  async paymentStatus(
    driverId: string,
    subscriptionId: string,
    reconcile = false,
  ) {
    let subscription = await this.getSubscription(driverId, subscriptionId);
    if (reconcile && subscription.payment?.provider === razorpay.name) {
      await new PaymentsService().reconcile(subscription.payment.id);
      subscription = await this.getSubscription(driverId, subscriptionId);
    }
    const { payment, ...record } = subscription;
    return {
      subscription: record,
      paymentId: payment?.id ?? null,
      payment,
      checkout: this.checkout(payment),
    };
  }

  async purchasePlan(driverId: string, planId: string, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 100)
      throw errors.badRequest("A valid x-idempotency-key header is required");
    // Scope client keys to the authenticated driver and this operation.
    const key = `subscription:${createHash("sha256").update(`${driverId}:${idempotencyKey}`).digest("hex")}`;
    const reservation = await prisma.$transaction(
      async (tx) => {
        await lockSubscriptionDriver(tx, driverId);
        const driver = await tx.driverProfile.findUnique({
          where: { id: driverId },
          include: { user: { select: { status: true } } },
        });
        if (!driver) throw errors.notFound("Driver not found");
        if (driver.user.status !== "ACTIVE")
          throw errors.forbidden("Driver account is not active");
        const previous = await tx.payment.findUnique({
          where: { idempotencyKey: key },
          include: { driverSubscription: true },
        });
        if (previous?.driverSubscription) {
          if (previous.driverSubscription.planId !== planId)
            throw errors.conflict("Idempotency key was used for another plan");
          return {
            subscriptionId: previous.driverSubscription.id,
            created: false,
            paymentId: previous.id,
            amount: previous.amount,
          };
        }
        await expireSubscriptions(tx, driverId);
        if (
          await tx.driverSubscription.findFirst({
            where: activeSubscriptionWhere(driverId),
          })
        )
          throw errors.conflict("Driver already has an active subscription");
        const pending = await tx.driverSubscription.findFirst({
          where: {
            driverId,
            status: "PENDING_PAYMENT",
            payment: { provider: razorpay.name },
          },
          include: { payment: true },
          orderBy: { createdAt: "desc" },
        });
        if (pending?.payment) {
          const savedKeyId = razorpayKeySnapshot(pending.payment.metadata);
          const keyChanged = savedKeyId !== env.RAZORPAY_KEY_ID;
          const stale = pendingPaymentIsStale(pending.payment.createdAt);
          if (keyChanged || stale) {
            console.warn(
              [
                "[RAZORPAY][SUBSCRIPTION][PENDING_RESET]",
                `driverId=${driverId}`,
                `subscriptionId=${pending.id}`,
                `paymentId=${pending.payment.id}`,
                `orderId=${pending.payment.providerOrderId ?? ""}`,
                `reason=${keyChanged ? "KEY_MISMATCH_OR_LEGACY" : "STALE_PENDING"}`,
                `savedKey=${maskRazorpayKey(savedKeyId)}`,
                `currentKey=${maskRazorpayKey(env.RAZORPAY_KEY_ID)}`,
              ].join(" "),
            );
            await tx.payment.updateMany({
              where: {
                id: pending.payment.id,
                status: { in: ["CREATED", "PENDING", "AUTHORIZED"] },
              },
              data: { status: "FAILED" },
            });
            await tx.driverSubscription.updateMany({
              where: { id: pending.id, status: "PENDING_PAYMENT" },
              data: { status: "FAILED" },
            });
          } else {
            // Resume through history/status, not a different purchase key.
            throw errors.conflict(
              "Driver has a pending subscription; resume its payment first",
            );
          }
        }
        const plan = await tx.subscriptionPlan.findFirst({
          where: { id: planId, isActive: true },
        });
        if (!plan)
          throw errors.notFound("Subscription plan not found or inactive");
        if (
          plan.durationValue < 1 ||
          (plan.tripType === "LIMITED" &&
            (!plan.numberOfTrips || plan.numberOfTrips < 1))
        )
          throw errors.conflict("Subscription plan configuration is invalid");
        const amountMinor = plan.price.mul(100).toNumber();
        if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
          throw errors.conflict("Subscription plan price is invalid");
        if (
          amountMinor > 0 &&
          (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)
        )
          throw errors.unavailable("Razorpay is not configured");
        const subscription = await tx.driverSubscription.create({
          data: {
            driverId,
            planId,
            priceAtPurchase: plan.price,
            taxAtPurchase: plan.gstOrTax,
            remainingTrips:
              plan.tripType === "LIMITED" ? plan.numberOfTrips : null,
            status: "PENDING_PAYMENT",
            startDate: null,
            expiryDate: null,
          },
        });
        const payment = await tx.payment.create({
          data: {
            subscriptionId: subscription.id,
            amount: plan.price,
            currency: "INR",
            method: "UPI",
            provider: amountMinor === 0 ? "FREE" : razorpay.name,
            status: amountMinor === 0 ? "CAPTURED" : "CREATED",
            idempotencyKey: key,
            metadata: {
              durationDays: plan.durationValue,
              ...(amountMinor > 0 && env.RAZORPAY_KEY_ID
                ? { razorpayKeyId: env.RAZORPAY_KEY_ID }
                : {}),
            },
            ...(amountMinor === 0
              ? {
                  paidAt: new Date(),
                  amountPaid: plan.price,
                  transactions: {
                    create: {
                      type: "CAPTURED",
                      amount: plan.price,
                      status: "SUCCESS",
                    },
                  },
                }
              : {}),
          },
        });
        if (amountMinor === 0)
          await activatePaidSubscription(
            tx,
            subscription.id,
            plan.durationValue,
          );
        return {
          subscriptionId: subscription.id,
          created: true,
          paymentId: payment.id,
          amount: payment.amount,
        };
      },
      { maxWait: 5000, timeout: 10000 },
    );

    if (reservation.created && reservation.amount.greaterThan(0)) {
      try {
        console.log(
          [
            "[RAZORPAY][SUBSCRIPTION][ORDER_CREATE]",
            `driverId=${driverId}`,
            `subscriptionId=${reservation.subscriptionId}`,
            `paymentId=${reservation.paymentId}`,
            `amountMinor=${reservation.amount.mul(100).toNumber()}`,
            "currency=INR",
            `key=${maskRazorpayKey(env.RAZORPAY_KEY_ID)}`,
          ].join(" "),
        );
        const order = await razorpay.createOrder({
          amountMinor: reservation.amount.mul(100).toNumber(),
          currency: "INR",
          receipt: reservation.paymentId,
          notes: {
            subscriptionId: reservation.subscriptionId,
            paymentId: reservation.paymentId,
          },
        });
        if (
          typeof order.id !== "string" ||
          !order.id.startsWith("order_") ||
          order.amount !== reservation.amount.mul(100).toNumber() ||
          order.currency !== "INR"
        )
          throw errors.unavailable(
            "Payment provider returned an invalid order",
          );
        const orderId = order.id;
        console.log(
          [
            "[RAZORPAY][SUBSCRIPTION][ORDER_CREATED]",
            `driverId=${driverId}`,
            `subscriptionId=${reservation.subscriptionId}`,
            `paymentId=${reservation.paymentId}`,
            `orderId=${orderId}`,
            `amount=${order.amount}`,
            `currency=${order.currency}`,
          ].join(" "),
        );
        await prisma.$transaction(async (tx) => {
          await lockSubscriptionDriver(tx, driverId);
          const changed = await tx.payment.updateMany({
            where: {
              id: reservation.paymentId,
              status: "CREATED",
              providerOrderId: null,
            },
            data: { providerOrderId: orderId, status: "PENDING" },
          });
          if (changed.count === 1)
            await tx.paymentTransaction.create({
              data: {
                paymentId: reservation.paymentId,
                type: "ORDER_CREATED",
                amount: reservation.amount,
                status: "SUCCESS",
              },
            });
        });
      } catch {
        // A timeout can mean the provider created the order. Leave CREATED so
        // receipt reconciliation can recover it without issuing a second order.
        throw errors.unavailable(
          "Unable to create subscription payment; check purchase history before retrying",
        );
      }
    }
    return this.paymentStatus(driverId, reservation.subscriptionId);
  }
}
