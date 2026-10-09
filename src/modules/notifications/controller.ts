import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { NotificationsService } from "./service";
import { sendPush } from "../../integrations/fcm";

const service = new NotificationsService();

export const notificationsController: FastifyPluginAsync = async (app) => {
  app.post("/devices", { preHandler: [requireSession] }, async (request) => {
    const input = parse(
      z.object({
        token: z.string().min(20).max(4096),
        platform: z.preprocess(
          (val) => (typeof val === "string" ? val.toUpperCase() : val),
          z.enum(["ANDROID", "IOS", "WEB"]),
        ),
      }),
      request.body,
    );
    return success(
      await service.registerDevice(request.authSession!.userId, input),
      "Device registered",
    );
  });

  app.post("/test-fcm", async (request) => {
    const input = parse(
      z.object({
        token: z.string(),
        title: z.string().optional().default("FCM Test"),
        body: z.string().optional().default("FCM notification is working"),
        data: z.record(z.string(), z.string()).optional(),
      }),
      request.body,
    );
    const res = await sendPush({
      token: input.token,
      title: input.title,
      body: input.body,
      data: input.data ?? {
        type: "TEST_NOTIFICATION",
        route: "/notifications",
      },
    });
    return success(res, "FCM test notification sent successfully");
  });

  app.get("/", { preHandler: [requireSession] }, async (request) => {
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
    return success(result.items, "Notifications retrieved", result.meta);
  });
  app.get(
    "/unread-count",
    { preHandler: [requireSession] },
    async (request) => {
      return success(
        await service.unreadCount(request.authSession!.userId),
        "Unread notification count retrieved",
      );
    },
  );
  app.post("/:id/read", { preHandler: [requireSession] }, async (request) => {
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    await service.markRead(id, request.authSession!.userId);
    return success(null, "Notification marked read");
  });
  app.patch("/read-all", { preHandler: [requireSession] }, async (request) => {
    await service.markAllRead(request.authSession!.userId);
    return success(null, "All notifications marked read");
  });
};
