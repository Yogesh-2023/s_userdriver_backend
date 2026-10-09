import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env";
import { errors } from "./errors";
import { sessionCookieOptions } from "./session-cookie";
import { SessionsService } from "../modules/sessions/service";

const sessions = new SessionsService();

export const loadSession = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const signed = request.cookies[env.COOKIE_NAME];
  if (!signed) {
    request.authSession = null;
    return;
  }
  const unsigned = request.unsignCookie(signed);
  request.authSession =
    unsigned.valid && unsigned.value
      ? await sessions.validate(unsigned.value)
      : null;
  if (
    request.authSession &&
    ["GET", "HEAD"].includes(request.method) &&
    sessions.shouldRotate(request.authSession)
  ) {
    const rotated = await sessions.rotate(unsigned.value!, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });
    reply.setCookie(env.COOKIE_NAME, rotated.cookieValue, {
      ...sessionCookieOptions(),
    });
    request.authSession = rotated.session;
  }
};

export const requireSession = async (request: FastifyRequest) => {
  if (!request.authSession) throw errors.unauthorized();
};

export const requireRoles =
  (...roles: string[]) =>
  async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.authSession) throw errors.unauthorized();
    if (
      !roles.some(
        (role) =>
          request.authSession!.roles.includes(role) ||
          (role === "ADMIN" &&
            request.authSession!.roles.includes("SUPER_ADMIN")),
      )
    ) {
      throw errors.forbidden("Required role is missing");
    }
  };
