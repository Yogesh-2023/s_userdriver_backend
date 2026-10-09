import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { errors } from "../../common/errors";
import { sessionCookieOptions } from "../../common/session-cookie";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { requireSession } from "../../common/auth";
import { AuthService } from "./service";
import { SessionsService } from "../sessions/service";

const service = new AuthService();
const sessions = new SessionsService();
const identity = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  role: z.enum(["CUSTOMER", "DRIVER"]).default("CUSTOMER"),
});

const setCookie = (reply: FastifyReply, cookieValue: string) => {
  reply.setCookie(env.COOKIE_NAME, cookieValue, sessionCookieOptions());
};

const context = (request: FastifyRequest) => ({
  ipAddress: request.ip,
  userAgent: request.headers["user-agent"],
});

export const authController: FastifyPluginAsync = async (app) => {
  app.post(
    "/otp/request",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = parse(identity, request.body);
      const result = await service.requestOtp(input);
      return reply.code(202).send(success(result, "OTP request accepted"));
    },
  );

  app.post(
    "/otp/verify",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = parse(
        identity.extend({
          otp: z.string().regex(/^\d{4}$/),
          deviceInfo: z.record(z.string(), z.unknown()).optional(),
        }),
        request.body,
      );
      const result = await service.verifyOtp(input, context(request));
      setCookie(reply, result.cookieValue);
      return success({ user: result.user }, "Authentication successful");
    },
  );

  app.post(
    "/rotate",
    { preHandler: [requireSession] },
    async (request, reply) => {
      const signed = request.cookies[env.COOKIE_NAME]!;
      const cookieValue = request.unsignCookie(signed).value;
      if (!cookieValue) throw errors.unauthorized("Session cookie is invalid");
      const result = await sessions.rotate(cookieValue, context(request));
      setCookie(reply, result.cookieValue);
      return success({}, "Session rotated successfully");
    },
  );

  app.post(
    "/logout",
    { preHandler: [requireSession] },
    async (request, reply) => {
      await sessions.revoke(
        request.authSession!.sessionId,
        request.authSession!.userId,
      );
      reply.clearCookie(env.COOKIE_NAME, { path: "/" });
      return success(null, "Logged out successfully");
    },
  );
};
