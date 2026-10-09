import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";
import rawBody from "fastify-raw-body";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { env } from "./config/env";
import { registerCors } from "./config/cors";
import { prisma } from "./database/prisma";
import { redis } from "./infrastructure/redis";
import { AppError } from "./common/errors";
import { loadSession } from "./common/auth";
import { success } from "./common/response";
import { setupSocket } from "./realtime/socket";
import { authController } from "./modules/auth/controller";
import { sessionsController } from "./modules/sessions/controller";
import { usersController } from "./modules/users/controller";
import { customerController } from "./modules/customer/customer.routes";
import { driverController } from "./modules/driver/driver.routes";
import { vehiclesController } from "./modules/vehicles/controller";
import { bookingsController } from "./modules/bookings/controller";
import { dispatchController } from "./modules/dispatch/controller";
import { tripsController } from "./modules/trips/controller";
import { paymentsController } from "./modules/payments/controller";
import { walletsController } from "./modules/wallets/controller";
import { notificationsController } from "./modules/notifications/controller";
import { safetyController } from "./modules/safety/controller";
import { pricingController } from "./modules/pricing/controller";
import { ratingsController } from "./modules/ratings/controller";
import { supportController } from "./modules/support/controller";
import { adminRoutes } from "./modules/admin/admin.routes";
import { auditLogsController } from "./modules/audit-logs/controller";
import { webhookController } from "./webhook/controller";
import { locationRoutes } from "./modules/locations/locations.routes";

export const buildApp = async () => {
  const app = Fastify({
    trustProxy: true,
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.headers.x-csrf-token",
          "req.body.otp",
          "req.body.password",
          "req.body.currentPassword",
          "req.body.newPassword",
          "req.body.signature",
          "req.body.aadhaarNumber",
          "req.body.panNumber",
          "req.body.accountNumber",
          "req.body.ifscCode",
          "req.body.documentUrl",
          "res.headers.set-cookie",
        ],
        censor: "[REDACTED]",
      },
    },
    genReqId: (request) =>
      String(request.headers["x-request-id"] ?? crypto.randomUUID()),
  });
  app.decorate("prisma", prisma);
  app.decorate("redis", redis);
  app.decorateRequest("authSession", null);
  app.decorateRequest("admin", null);

  await app.register(cookie, { secret: env.COOKIE_SECRET, hook: "onRequest" });
  await registerCors(app);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    ...(env.NODE_ENV === "test" ? {} : { redis }),
    keyGenerator: (request) => request.authSession?.userId ?? request.ip,
  });
  await app.register(multipart, {
    attachFieldsToBody: "keyValues",
    onFile: async (part: any) => {
      const buffer = await part.toBuffer();
      part.value = {
        buffer,
        filename: part.filename,
        mimetype: part.mimetype,
      };
    },
    limits: {
      fields: 100,
      files: 30,
      fileSize: 5 * 1024 * 1024,
      parts: 150,
    },
  });
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });

  const uploadsRoot = path.join(__dirname, "..", "uploads");
  await fs.promises.mkdir(uploadsRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: "/uploads/",
    decorateReply: false,
  });

  app.addHook("onRequest", loadSession);

  app.get("/health/live", async () =>
    success({ status: "ok", timestamp: new Date().toISOString() }),
  );
  app.get("/health/ready", async () => {
    await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    return success({ status: "ready", timestamp: new Date().toISOString() });
  });

  app.setErrorHandler((error: any, request, reply) => {
    if (error.isAppError) {
      return reply.code(error.statusCode).send({
        success: false,
        message: error.message,
        error: {
          code: error.code,
          details: error.details,
          requestId: request.id,
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        success: false,
        message: "Request validation failed",
        error: {
          code: "BAD_REQUEST",
          details: error.flatten(),
          requestId: request.id,
        },
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return reply.code(409).send({
        success: false,
        message: "A record with this value already exists",
        error: { code: "CONFLICT", requestId: request.id },
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return reply.code(409).send({
        success: false,
        message: "Concurrent update detected; retry the request",
        error: { code: "CONFLICT", requestId: request.id },
      });
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        success: false,
        message: error.message || "Bad Request",
        error: { code: "BAD_REQUEST", requestId: request.id },
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      success: false,
      message: "An unexpected error occurred",
      error: { code: "INTERNAL_ERROR", requestId: request.id },
    });
  });
  // Local file serving — registered always since S3 is disabled and files are stored in .uploads/
  {
    const fs = require("fs");
    const path = require("path");
    const { pipeline } = require("stream/promises");

    // PUT: allow uploading files (write)
    app.put("/images/*", async (request, reply) => {
      const filePath = path.join(
        process.cwd(),
        ".uploads",
        (request.params as any)["*"],
      );
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await pipeline(request.raw, fs.createWriteStream(filePath));
      return reply.code(200).send({ success: true });
    });

    // GET: serve uploaded images/documents from .uploads/
    app.get("/images/*", async (request, reply) => {
      const filePath = path.join(
        process.cwd(),
        ".uploads",
        (request.params as any)["*"],
      );
      if (!fs.existsSync(filePath)) {
        return reply
          .code(404)
          .send({ success: false, message: "File not found" });
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".csv"
              ? "text/csv; charset=utf-8"
              : ext === ".pdf"
                ? "application/pdf"
                : ext === ".txt"
                  ? "text/plain; charset=utf-8"
                  : "image/jpeg";
      reply.header("Content-Type", mime);
      // Allow images to be cached for 1 hour
      reply.header("Cache-Control", "public, max-age=3600");
      return reply.send(fs.createReadStream(filePath));
    });
  }

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      success: false,
      message: "Route not found",
      error: { code: "NOT_FOUND", requestId: request.id },
    }),
  );

  const prefix = env.API_PREFIX;
  await app.register(authController, { prefix: `${prefix}/auth` });
  await app.register(sessionsController, { prefix: `${prefix}/sessions` });
  await app.register(usersController, { prefix: `${prefix}/users` });
  await app.register(customerController, { prefix: `${prefix}/customer` });
  await app.register(customerController, { prefix: `${prefix}/customers` });
  await app.register(driverController, { prefix: `${prefix}/driver` });
  // Keep the documented plural driver API as a compatibility alias. Both
  // prefixes register the same plugin and therefore share the same services,
  // authorization rules, validation, and response contracts.
  await app.register(driverController, { prefix: `${prefix}/drivers` });
  await app.register(vehiclesController, { prefix: `${prefix}/vehicles` });
  await app.register(bookingsController, { prefix: `${prefix}/bookings` });
  await app.register(dispatchController, { prefix: `${prefix}/dispatch` });
  await app.register(tripsController, { prefix: `${prefix}/trips` });
  await app.register(paymentsController, { prefix: `${prefix}/payments` });
  await app.register(walletsController, { prefix: `${prefix}/wallets` });
  await app.register(notificationsController, {
    prefix: `${prefix}/notifications`,
  });
  await app.register(safetyController, { prefix: `${prefix}/safety` });
  await app.register(pricingController, { prefix: `${prefix}/pricing` });
  await app.register(ratingsController, { prefix: `${prefix}/ratings` });
  await app.register(supportController, { prefix: `${prefix}/support` });
  await app.register(adminRoutes, { prefix: `${prefix}/admin` });
  await app.register(auditLogsController, {
    prefix: `${prefix}/audit-logs`,
  });
  await app.register(webhookController, { prefix: `${prefix}/webhooks` });
  await app.register(locationRoutes, { prefix: `${prefix}/locations` });

  setupSocket(app);
  return app;
};
