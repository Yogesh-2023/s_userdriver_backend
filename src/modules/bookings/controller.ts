import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRoles, requireSession } from "../../common/auth";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { BookingsService } from "./service";

const service = new BookingsService();
const location = z.object({
  address: z.string().trim().min(3).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const bookingsController: FastifyPluginAsync = async (app) => {
  app.post(
    "/",
    {
      preHandler: [requireSession, requireRoles("CUSTOMER")],
    },
    async (request, reply) => {
      const input = parse(
        z
          .object({
            vehicleCategoryId: z.uuid(),
            type: z.enum(["IMMEDIATE", "SCHEDULED"]).default("IMMEDIATE"),
            rideType: z.enum(["CITY", "RENTAL", "OUTSTATION"]).default("CITY"),
            tripType: z.enum(["ONE_WAY", "RETURN"]).default("ONE_WAY"),
            pickup: location,
            drop: location,
            scheduledAt: z.iso.datetime().optional(),
            returnDateTime: z.iso.datetime().optional(),
            couponCode: z.string().max(40).optional(),
            customerNote: z.string().max(500).optional(),
            paymentMethod: z.enum([
              "CASH",
              "UPI",
              "CREDIT_CARD",
              "DEBIT_CARD",
              "NET_BANKING",
              "WALLET",
            ]),
          })
          .refine(
            (value) => value.type !== "SCHEDULED" || Boolean(value.scheduledAt),
            { message: "scheduledAt is required for scheduled rides" },
          )
          .refine(
            (value) => value.tripType !== "RETURN" || Boolean(value.returnDateTime),
            { message: "returnDateTime is required for return trips" },
          ),
        request.body,
      );
      const booking = await service.create(
        request.authSession!.userId,
        String(request.headers["x-idempotency-key"] ?? ""),
        input,
      );
      return reply.code(201).send(success(booking, "Booking created"));
    },
  );

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
      request.authSession!.roles,
      query.page,
      query.limit,
    );
    return success(result.items, "Bookings retrieved", result.meta);
  });

  app.get("/:id", { preHandler: [requireSession] }, async (request) => {
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    return success(
      await service.get(
        id,
        request.authSession!.userId,
        request.authSession!.roles,
      ),
    );
  });

  app.post("/:id/cancel", { preHandler: [requireSession] }, async (request) => {
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const input = parse(
      z.object({
        reasonCode: z.string().min(2).max(50),
        reason: z.string().max(500).optional(),
      }),
      request.body,
    );
    return success(
      await service.cancel(
        id,
        request.authSession!.userId,
        request.authSession!.roles,
        input,
      ),
      "Booking cancelled",
    );
  });

  for (const path of ["schedule", "reschedule"]) {
    app.patch(`/:id/${path}`, { preHandler: [requireSession] }, async (request) => {
      const { id } = parse(z.object({ id: z.uuid() }), request.params);
      const input = parse(
        z.object({
          scheduledAt: z.iso.datetime(),
        }),
        request.body,
      );
      return success(
        await service.reschedule(id, request.authSession!.userId, input.scheduledAt),
        "Ride scheduled time updated successfully",
      );
    });
  }

  app.post(
    "/:id/driver-cancel",
    { preHandler: [requireSession, requireRoles("DRIVER")] },
    async (request) => {
      const { id } = parse(z.object({ id: z.uuid() }), request.params);
      const input = parse(
        z.object({
          reasonCode: z.string().min(2).max(50),
          reason: z.string().max(500).optional(),
        }),
        request.body,
      );
      return success(
        await service.driverCancel(id, request.authSession!.userId, input),
        "Ride cancelled successfully",
      );
    },
  );
};
