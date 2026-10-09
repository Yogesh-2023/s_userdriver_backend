import { FastifyRequest } from "fastify";
import { z } from "zod";
import { success } from "../../common/response";
import { parse } from "../../common/validation";
import { DriverSubscriptionService } from "./services/driver-subscription.service";
import { errors } from "../../common/errors";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../database/prisma";

const subscriptionService = new DriverSubscriptionService();
const idParams = z.object({ id: z.string().uuid() });
const historyQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(SubscriptionStatus).optional(),
});
async function driverId(request: FastifyRequest) {
  const driver = await prisma.driverProfile.findUnique({
    where: { userId: request.authSession!.userId },
    select: { id: true },
  });
  if (!driver) throw errors.notFound("Driver profile not found");
  return driver.id;
}

export const driverSubscriptionController = {
  async getPlans(_request: FastifyRequest) {
    const plans = await subscriptionService.getActivePlans();
    return success(plans, "Active subscription plans retrieved");
  },

  async getPlan(request: FastifyRequest) {
    const { id } = parse(idParams, request.params);
    return success(
      await subscriptionService.getPlan(id),
      "Subscription plan retrieved",
    );
  },

  async history(request: FastifyRequest) {
    const query = parse(historyQuery, request.query);
    return success(
      await subscriptionService.history(await driverId(request), query),
      "Subscription history retrieved",
    );
  },

  async details(request: FastifyRequest) {
    const { id } = parse(idParams, request.params);
    return success(
      await subscriptionService.getSubscription(await driverId(request), id),
      "Subscription retrieved",
    );
  },

  async paymentStatus(request: FastifyRequest) {
    const { id } = parse(idParams, request.params);
    const { reconcile } = parse(
      z.object({ reconcile: z.enum(["true", "false"]).default("false") }),
      request.query,
    );
    return success(
      await subscriptionService.paymentStatus(
        await driverId(request),
        id,
        reconcile === "true",
      ),
      "Subscription payment status retrieved",
    );
  },

  async getActiveSubscription(request: FastifyRequest) {
    // We need driverId, let's get it from user
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
    });

    if (!driver) {
      return success(null, "No active subscription found");
    }

    const subscription = await subscriptionService.getActiveSubscription(
      driver.id,
    );
    return success(subscription, "Active subscription retrieved");
  },

  async purchasePlan(request: FastifyRequest) {
    const input = parse(
      z.object({
        planId: z.string().uuid(),
      }),
      request.body,
    );

    const driver = await prisma.driverProfile.findUnique({
      where: { userId: request.authSession!.userId },
    });

    if (!driver) {
      throw errors.notFound("Driver profile not found");
    }

    const result = await subscriptionService.purchasePlan(
      driver.id,
      input.planId,
      String(request.headers["x-idempotency-key"] ?? "").trim(),
    );
    return success(result, "Subscription purchase retrieved");
  },
};
