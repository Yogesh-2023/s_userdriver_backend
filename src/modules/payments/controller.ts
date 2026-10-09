import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { PaymentsService } from "./service";

const service = new PaymentsService();

export const paymentsController: FastifyPluginAsync = async (app) => {
  app.post("/", { preHandler: [requireSession] }, async (request, reply) => {
    const input = parse(
      z.object({
        bookingId: z.uuid(),
        method: z.enum([
          "CASH",
          "UPI",
          "CREDIT_CARD",
          "DEBIT_CARD",
          "NET_BANKING",
          "WALLET",
        ]),
      }),
      request.body,
    );
    return reply
      .code(201)
      .send(
        success(
          await service.create(
            request.authSession!.userId,
            request.authSession!.roles,
            String(request.headers["x-idempotency-key"] ?? ""),
            input,
          ),
          "Payment created",
        ),
      );
  });

  app.post("/verify", { preHandler: [requireSession] }, async (request) => {
    const input = parse(
      z.object({
        paymentId: z.uuid(),
        providerPaymentId: z.string().min(3).max(200),
        signature: z.string().min(16).max(200),
      }),
      request.body,
    );
    return success(
      await service.verify(
        request.authSession!.userId,
        request.authSession!.roles,
        input,
      ),
      "Payment verified",
    );
  });
};
