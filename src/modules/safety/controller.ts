import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { SafetyService } from "./service";

const service = new SafetyService();

export const safetyController: FastifyPluginAsync = async (app) => {
  app.post("/sos", { preHandler: [requireSession] }, async (request, reply) => {
    const input = parse(
      z.object({
        bookingId: z.uuid(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        message: z.string().max(500).optional(),
      }),
      request.body,
    );
    return reply
      .code(201)
      .send(
        success(
          await service.createSos(request.authSession!.userId, input),
          "SOS created",
        ),
      );
  });
  app.post(
    "/emergency-contacts",
    { preHandler: [requireSession] },
    async (request, reply) => {
      const input = parse(
        z.object({
          name: z.string().min(2).max(100),
          phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
          relationship: z.string().max(50).optional(),
        }),
        request.body,
      );
      return reply
        .code(201)
        .send(
          success(
            await service.createContact(request.authSession!.userId, input),
            "Emergency contact created",
          ),
        );
    },
  );
  app.post(
    "/bookings/:bookingId/share",
    { preHandler: [requireSession] },
    async (request) => {
      const { bookingId } = parse(
        z.object({ bookingId: z.uuid() }),
        request.params,
      );
      const input = parse(
        z.object({
          recipientName: z.string().max(100).optional(),
          recipientPhone: z
            .string()
            .regex(/^\+[1-9]\d{7,14}$/)
            .optional(),
          expiresInMinutes: z.number().int().min(5).max(1440).default(120),
        }),
        request.body,
      );
      return success(
        await service.createTripShare(
          bookingId,
          request.authSession!.userId,
          input,
        ),
        "Trip share created",
      );
    },
  );
};
