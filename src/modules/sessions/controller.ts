import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { SessionsService } from "./service";

const service = new SessionsService();

export const sessionsController: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [requireSession] }, async (request) =>
    success(await service.list(request.authSession!.userId)),
  );

  app.post("/revoke", { preHandler: [requireSession] }, async (request) => {
    const { sessionId } = parse(
      z.object({ sessionId: z.uuid() }),
      request.body,
    );
    await service.revokeForUser(sessionId, request.authSession!.userId);
    return success(null, "Session revoked");
  });
};
