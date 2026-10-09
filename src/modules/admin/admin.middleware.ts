import type { FastifyRequest } from "fastify";
import { errors } from "../../common/errors";
import { requireSession } from "../../common/auth";
import { AdminAuthService } from "./services/admin-auth.service";

const auth = new AdminAuthService();

export const requireAdminSession = async (request: FastifyRequest) => {
  await requireSession(request);
  request.admin = await auth.resolvePrincipal(
    request.authSession!.userId,
    request.authSession!.sessionId,
  );
};

export const requireAdminPermission =
  (permission: string) => async (request: FastifyRequest) => {
    if (!request.admin) throw errors.unauthorized("Admin session required");
    if (
      !request.admin.roles.includes("SUPER_ADMIN") &&
      !request.admin.permissions.includes(permission)
    ) {
      throw errors.forbidden("Required admin permission is missing");
    }
  };

export const requireSuperAdmin = async (request: FastifyRequest) => {
  if (!request.admin) throw errors.unauthorized("Admin session required");
  if (!request.admin.roles.includes("SUPER_ADMIN")) {
    throw errors.forbidden("Super-admin access required");
  }
};

export const requireCustomerStatusPermission = async (
  request: FastifyRequest,
) => {
  const status =
    typeof request.body === "object" && request.body !== null
      ? (request.body as { status?: unknown }).status
      : undefined;
  await requireAdminPermission(
    status === "DELETED" ? "customers.delete" : "customers.block",
  )(request);
};
