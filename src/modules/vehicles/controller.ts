import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import {
  requireAdminPermission,
  requireAdminSession,
} from "../admin/admin.middleware";
import { AdminVehicleService } from "../admin/services/admin-vehicle.service";
import { VehiclesService } from "./service";

const service = new VehiclesService();
const adminService = new AdminVehicleService();

export const vehiclesController: FastifyPluginAsync = async (app) => {
  app.get("/options", { preHandler: [requireSession] }, async () =>
    success(await service.getOptions()),
  );
  app.get("/categories", { preHandler: [requireSession] }, async () =>
    success(await service.listCategories()),
  );
  app.post(
    "/",
    {
      preHandler: [
        requireAdminSession,
        requireAdminPermission("vehicles.create"),
      ],
    },
    async (request, reply) => {
      const input = parse(
        z.object({
          categoryId: z.uuid(),
          registrationNo: z.string().min(4).max(30),
          make: z.string().min(2).max(80),
          model: z.string().min(1).max(80),
          color: z.string().max(40).optional(),
          year: z.number().int().min(1990).max(2100).optional(),
        }),
        request.body,
      );
      return reply.code(201).send(
        success(
          await adminService.create(input, {
            adminId: request.admin!.id,
            userId: request.admin!.userId,
            role: request.admin!.roles.includes("SUPER_ADMIN")
              ? "SUPER_ADMIN"
              : "ADMIN",
            requestId: request.id,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          }),
          "Vehicle created",
        ),
      );
    },
  );
  app.patch(
    "/:id/status",
    {
      preHandler: [
        requireAdminSession,
        requireAdminPermission("vehicles.update"),
      ],
    },
    async (request) => {
      const { id } = parse(z.object({ id: z.uuid() }), request.params);
      const input = parse(
        z.object({
          status: z.enum([
            "PENDING",
            "ACTIVE",
            "INACTIVE",
            "MAINTENANCE",
            "SUSPENDED",
          ]),
          isAvailable: z.boolean().default(false),
          reason: z.string().trim().min(5).max(500).optional(),
        }),
        request.body,
      );
      return success(
        await adminService.updateStatus(
          id,
          {
            status: input.status,
            reason: input.reason ?? "Legacy admin vehicle API update",
          },
          {
            adminId: request.admin!.id,
            userId: request.admin!.userId,
            role: request.admin!.roles.includes("SUPER_ADMIN")
              ? "SUPER_ADMIN"
              : "ADMIN",
            requestId: request.id,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          },
        ),
        "Vehicle status updated",
      );
    },
  );
};
