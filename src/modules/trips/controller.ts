import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRoles, requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { TripsService } from "./service";

const service = new TripsService();
const id = (input: unknown) => parse(z.object({ id: z.uuid() }), input).id;

export const tripsController: FastifyPluginAsync = async (app) => {
  app.post(
    "/:id/otp",
    {
      preHandler: [requireSession, requireRoles("CUSTOMER")],
    },
    async (request) =>
      success(
        await service.requestOtp(
          id(request.params),
          request.authSession!.userId,
        ),
        "Trip OTP sent",
      ),
  );

  for (const [path, action] of [
    ["arriving", service.arriving.bind(service)],
    ["arrived", service.arrived.bind(service)],
  ] as const) {
    app.post(
      `/:id/${path}`,
      {
        preHandler: [requireSession, requireRoles("DRIVER")],
      },
      async (request) =>
        success(
          await action(id(request.params), request.authSession!.userId),
          `Driver marked ${path}`,
        ),
    );
  }

  app.post(
    "/:id/start",
    {
      preHandler: [requireSession, requireRoles("DRIVER")],
    },
    async (request) => {
      const input = parse(
        z.object({ otp: z.string().regex(/^\d{4}$/) }),
        request.body,
      );
      return success(
        await service.start(
          id(request.params),
          input.otp,
          request.authSession!.userId,
        ),
        "Trip started",
      );
    },
  );

  app.post(
    "/:id/complete",
    {
      preHandler: [requireSession, requireRoles("DRIVER")],
    },
    async (request) => {
      return success(
        await service.complete(
          id(request.params),
          request.authSession!.userId,
          {},
        ),
        "Trip completed",
      );
    },
  );
};
