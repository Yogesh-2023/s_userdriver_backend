import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import {
  requireAdminPermission,
  requireAdminSession,
} from "../admin/admin.middleware";
import { WalletsService } from "./service";

const service = new WalletsService();

export const walletsController: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [requireSession] }, async (request) => {
    const query = parse(
      z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      request.query,
    );
    const result = await service.get(
      request.authSession!.userId,
      query.page,
      query.limit,
    );
    return success(result, "Wallet retrieved", result.meta);
  });
  app.post(
    "/admin/adjust",
    {
      preHandler: [
        requireAdminSession,
        requireAdminPermission("wallets.adjust"),
      ],
    },
    async (request) => {
      const input = parse(
        z.object({
          userId: z.uuid(),
          amount: z.number().positive(),
          type: z.enum(["CREDIT", "DEBIT"]),
          description: z.string().min(3).max(250),
        }),
        request.body,
      );
      return success(
        await service.adjust(
          input.userId,
          input.amount,
          input.type,
          String(request.headers["x-idempotency-key"] ?? ""),
          input.description,
          request.admin!.userId,
        ),
        "Wallet adjusted",
      );
    },
  );
};
