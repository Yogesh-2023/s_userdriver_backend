import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import {
  requireAdminPermission,
  requireAdminSession,
} from "../admin/admin.middleware";
import { AuditLogsService } from "./service";

const service = new AuditLogsService();

export const auditLogsController: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      preHandler: [
        requireAdminSession,
        requireAdminPermission("audit_logs.read"),
      ],
    },
    async (request) => {
      const query = parse(
        z.object({
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          actorUserId: z.uuid().optional(),
          entityType: z.string().max(80).optional(),
          action: z.string().max(100).optional(),
        }),
        request.query,
      );
      const [items, total] = await service.list(query);
      return success(items, "Audit logs retrieved", {
        page: query.page,
        limit: query.limit,
        total,
      });
    },
  );
};
