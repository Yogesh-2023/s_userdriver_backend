import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { RatingsService } from "./service";

const service = new RatingsService();

export const ratingsController: FastifyPluginAsync = async (app) => {
  app.post(
    "/trips/:tripId",
    { preHandler: [requireSession] },
    async (request, reply) => {
      const { tripId } = parse(z.object({ tripId: z.uuid() }), request.params);
      const input = parse(
        z.object({
          subjectUserId: z.uuid(),
          subjectType: z.enum(["CUSTOMER", "DRIVER"]),
          score: z.number().int().min(1).max(5),
          tags: z.array(z.string().max(40)).max(10).default([]),
          comment: z.string().max(1000).optional(),
        }),
        request.body,
      );
      return reply
        .code(201)
        .send(
          success(
            await service.create(tripId, request.authSession!.userId, input),
            "Rating submitted",
          ),
        );
    },
  );
};
