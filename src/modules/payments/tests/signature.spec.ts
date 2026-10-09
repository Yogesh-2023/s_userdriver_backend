import { createHmac } from "node:crypto";

describe("Razorpay signature validation", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.RAZORPAY_KEY_SECRET = "payment-test-secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-test-secret";
  });

  it("accepts exact payment and raw webhook signatures", async () => {
    const { razorpay } = await import("../../../integrations/razorpay");
    const checkout = createHmac("sha256", "payment-test-secret")
      .update("order_1|payment_1")
      .digest("hex");
    const body = Buffer.from('{"event":"payment.captured"}');
    const webhook = createHmac("sha256", "webhook-test-secret")
      .update(body)
      .digest("hex");
    expect(razorpay.verifyPayment("order_1", "payment_1", checkout)).toBe(true);
    expect(razorpay.verifyWebhook(body, webhook)).toBe(true);
    expect(razorpay.verifyPayment("order_1", "tampered", checkout)).toBe(false);
  });
});
