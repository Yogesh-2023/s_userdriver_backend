import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { UsersService } from "./service";

const service = new UsersService();

export const usersController: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: [requireSession] }, async (request) =>
    success(await service.getProfile(request.authSession!.userId)),
  );
  app.patch("/me", { preHandler: [requireSession] }, async (request) => {
    const input = parse(
      z
        .object({
          displayName: z.string().trim().min(2).max(120).optional(),
          email: z.email().max(320).nullable().optional(),
        })
        .refine((value) => Object.keys(value).length > 0),
      request.body,
    );
    return success(
      await service.updateProfile(request.authSession!.userId, input),
      "Profile updated",
    );
  });
};
