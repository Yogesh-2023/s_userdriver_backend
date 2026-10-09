import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import { errors } from "../common/errors";

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const request = async (
  path: string,
  init: RequestInit,
): Promise<Record<string, unknown>> => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw errors.unavailable("Razorpay is not configured");
  }
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(
        `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
      ).toString("base64")}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw errors.unavailable("Payment provider request failed");
  return (await response.json()) as Record<string, unknown>;
};

export const razorpay = {
  name: "RAZORPAY",
  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }) {
    return request("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      }),
    });
  },
  async getOrdersByReceipt(receipt: string) {
    return request(`/orders?receipt=${encodeURIComponent(receipt)}&count=100`, {
      method: "GET",
    });
  },
  async getOrderPayments(orderId: string) {
    return request(`/orders/${encodeURIComponent(orderId)}/payments`, {
      method: "GET",
    });
  },
  async createRefund(input: {
    paymentId: string;
    amountMinor: number;
    receipt: string;
    notes: Record<string, string>;
  }) {
    return request(`/payments/${encodeURIComponent(input.paymentId)}/refunds`, {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountMinor,
        receipt: input.receipt,
        notes: input.notes,
      }),
    });
  },
  verifyPayment(orderId: string, paymentId: string, signature: string) {
    if (!env.RAZORPAY_KEY_SECRET) {
      throw errors.unavailable("Payment verification is not configured");
    }
    return safeEqual(
      createHmac("sha256", env.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest("hex"),
      signature,
    );
  },
  verifyWebhook(rawBody: Buffer, signature: string) {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw errors.unavailable("Webhook verification is not configured");
    }
    return safeEqual(
      createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex"),
      signature,
    );
  },
};
