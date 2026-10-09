import { FastifyRequest } from "fastify";
import { z } from "zod";
import { success } from "../../common/response";
import { parse } from "../../common/validation";
import { AdminSubscriptionService } from "./services/admin-subscription.service";

const subscriptionService = new AdminSubscriptionService();

const planSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  price: z.number().min(0),
  durationValue: z.number().int().min(1),
  durationType: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  tripType: z.enum(["LIMITED", "UNLIMITED"]),
  numberOfTrips: z.number().int().min(1).optional(),
  gstOrTax: z.number().min(0).optional(),
  isActive: z.boolean().default(true),
});

const updatePlanSchema = planSchema.partial();

export const adminSubscriptionController = {
  async createPlan(request: FastifyRequest) {
    const data = parse(planSchema, request.body);
    const plan = await subscriptionService.createPlan(data);
    return success(plan, "Subscription plan created");
  },

  async updatePlan(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    const data = parse(updatePlanSchema, request.body);
    const plan = await subscriptionService.updatePlan(id, data);
    return success(plan, "Subscription plan updated");
  },

  async getPlans(_request: FastifyRequest) {
    const plans = await subscriptionService.getPlans();
    return success(plans, "Subscription plans retrieved");
  },

  async getPlan(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    const plan = await subscriptionService.getPlan(id);
    return success(plan, "Subscription plan retrieved");
  },

  async deletePlan(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    await subscriptionService.deletePlan(id);
    return success(null, "Subscription plan deleted");
  },

  async getPurchasedSubscriptions(request: FastifyRequest) {
    const querySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      search: z.string().optional(),
      status: z
        .enum(["PENDING_PAYMENT", "ACTIVE", "EXPIRED", "CANCELLED", "FAILED"])
        .optional(),
    });

    const query = parse(querySchema, request.query);
    const result = await subscriptionService.listPurchases(query);
    return success(result, "Purchased subscriptions retrieved");
  },

  async getPurchase(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    const purchase = await subscriptionService.getPurchase(id);
    return success(purchase, "Purchase retrieved");
  },
};
