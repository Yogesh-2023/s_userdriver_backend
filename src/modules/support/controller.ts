import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { success } from "../../common/response";
import { parse } from "../../common/validation";
import { SupportService } from "./service";

const service = new SupportService();
const attachments = z
  .array(
    z.object({
      key: z.string().trim().min(1).max(500),
      name: z.string().trim().min(1).max(255),
    }),
  )
  .max(10)
  .optional();

export const supportController: FastifyPluginAsync = async (app) => {
  app.post(
    "/tickets",
    { preHandler: [requireSession] },
    async (request, reply) => {
      const input = parse(
        z.object({
          categoryId: z.uuid(),
          subject: z.string().trim().min(3).max(160),
          message: z.string().trim().min(1).max(10_000),
          bookingId: z.uuid().optional(),
          tripId: z.uuid().optional(),
          paymentId: z.uuid().optional(),
          attachments,
        }),
        request.body,
      );
      const ticket = await service.create(request.authSession!.userId, input);
      return reply.code(201).send(success(ticket, "Support ticket created"));
    },
  );

  app.get("/tickets", { preHandler: [requireSession] }, async (request) => {
    const query = parse(
      z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      request.query,
    );
    const result = await service.list(
      request.authSession!.userId,
      query.page,
      query.limit,
    );
    return success(result.items, "Support tickets retrieved", {
      ...query,
      total: result.total,
      totalPages: Math.ceil(result.total / query.limit),
    });
  });

  app.get(
    "/tickets/:ticketId",
    { preHandler: [requireSession] },
    async (request) => {
      const { ticketId } = parse(
        z.object({ ticketId: z.uuid() }),
        request.params,
      );
      return success(
        await service.get(ticketId, request.authSession!.userId),
        "Support ticket retrieved",
      );
    },
  );

  app.post(
    "/tickets/:ticketId/reply",
    { preHandler: [requireSession] },
    async (request, reply) => {
      const { ticketId } = parse(
        z.object({ ticketId: z.uuid() }),
        request.params,
      );
      const input = parse(
        z.object({
          message: z.string().trim().min(1).max(10_000),
          attachments,
        }),
        request.body,
      );
      return reply
        .code(201)
        .send(
          success(
            await service.reply(ticketId, request.authSession!.userId, input),
            "Support reply created",
          ),
        );
    },
  );
};
