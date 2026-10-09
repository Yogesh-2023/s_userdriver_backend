import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRoles, requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { DispatchService } from "./service";

const service = new DispatchService();
const guards = [requireSession, requireRoles("DRIVER")];
const acceptSchema = z
  .object({
    offerId: z.uuid().optional(),
    assignmentId: z.uuid().optional(),
  })
  .refine((value) => value.offerId ?? value.assignmentId, {
    message: "offerId is required",
  });

export const dispatchController: FastifyPluginAsync = async (app) => {
  app.post("/accept", { preHandler: guards }, async (request) => {
    const input = parse(acceptSchema, request.body);
    const offerId = input.offerId ?? input.assignmentId!;
    return success(
      await service.accept(offerId, request.authSession!.userId),
      "Ride request accepted",
    );
  });
  app.post("/reject", { preHandler: guards }, async (request) => {
    const input = parse(acceptSchema, request.body);
    const offerId = input.offerId ?? input.assignmentId!;
    await service.reject(offerId, request.authSession!.userId);
    return success(null, "Ride request rejected");
  });
};
