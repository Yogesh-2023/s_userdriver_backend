import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { PricingService } from "./service";

const service = new PricingService();

export const pricingController: FastifyPluginAsync = async (app) => {
  app.post("/estimate", { preHandler: [requireSession] }, async (request) => {
    const input = parse(
      z.object({
        vehicleCategoryId: z.uuid(),
        rideType: z.enum(["CITY", "RENTAL", "OUTSTATION"]).default("CITY"),
        distanceMeters: z.number().int().positive(),
        durationSeconds: z.number().int().positive(),
        waitingMinutes: z.number().nonnegative().default(0),
        tollCharge: z.number().nonnegative().default(0),
        couponCode: z.string().max(40).optional(),
      }),
      request.body,
    );
    return success(
      await service.estimateForUser(request.authSession!.userId, input),
      "Fare estimated",
    );
  });
};
