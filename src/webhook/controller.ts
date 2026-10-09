import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { errors } from "../common/errors";
import { success } from "../common/response";
import { parse } from "../common/validation";
import { PaymentsService } from "../modules/payments/service";

const payments = new PaymentsService();

export const webhookController: FastifyPluginAsync = async (app) => {
  app.post(
    "/razorpay",
    {
      config: {
        rawBody: true,
        rateLimit: { max: 300, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const signature = request.headers["x-razorpay-signature"];
      if (!request.rawBody || typeof signature !== "string") {
        throw errors.badRequest("Raw body and webhook signature are required");
      }
      const payload = parse(z.record(z.string(), z.unknown()), request.body);
      const rawBody = Buffer.isBuffer(request.rawBody)
        ? request.rawBody
        : Buffer.from(request.rawBody);
      const eventId = request.headers["x-razorpay-event-id"];
      await payments.webhook(
        rawBody,
        signature,
        payload,
        typeof eventId === "string" ? eventId : undefined,
      );
      return success(null, "Webhook accepted");
    },
  );
};
