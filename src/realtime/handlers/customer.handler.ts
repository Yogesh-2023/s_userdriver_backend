import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "../../database/prisma";
import { redis } from "../../infrastructure/redis";
import { BookingsService } from "../../modules/bookings/service";
import { RideChatService } from "../../modules/bookings/ride-chat.service";
import { CustomerSupportService } from "../../modules/customer/services/customer-support.service";
import { SafetyService } from "../../modules/safety/service";
import type { SocketAuth } from "../socket-auth.middleware";
import { safeSocketHandler } from "../socket-error-handler";
import { enforceSocketRateLimit } from "../socket-rate-limit.middleware";
import { SocketStateSyncService } from "../socket-state-sync.service";

const bookings = new BookingsService();
const safety = new SafetyService();
const stateSync = new SocketStateSyncService();
const chat = new RideChatService();
const support = new CustomerSupportService();

export const registerCustomerHandler = (_io: Server, socket: Socket) => {
  const auth = socket.data.auth as SocketAuth;
  if (!auth.customerId) return;

  socket.on(
    "state:sync:request",
    safeSocketHandler(socket, async (_payload: unknown, acknowledge) => {
      await enforceSocketRateLimit(auth.customerId!, "state:sync", 10, 60);
      acknowledge?.({
        success: true,
        data: await stateSync.synchronize(socket),
      });
    }),
  );

  socket.on(
    "booking:cancel",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const parsed = z
        .object({
          bookingId: z.string().uuid(),
          reasonCode: z.string().trim().min(2).max(50),
          reason: z.string().trim().max(500).optional(),
        })
        .safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      await enforceSocketRateLimit(auth.customerId!, "booking:cancel", 5, 60);
      const result = await bookings.cancel(
        parsed.data.bookingId,
        auth.userId,
        auth.roles,
        {
          reasonCode: parsed.data.reasonCode,
          reason: parsed.data.reason,
        },
      );
      acknowledge?.({ success: true, data: result });
    }),
  );

  socket.on(
    "sos:create",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const parsed = z
        .object({
          bookingId: z.string().uuid(),
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          message: z.string().trim().max(500).optional(),
        })
        .safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      await enforceSocketRateLimit(auth.customerId!, "sos:create", 3, 300);
      const sos = await safety.createSos(auth.userId, parsed.data);
      acknowledge?.({ success: true, data: { sosId: sos.id } });
    }),
  );

  socket.on(
    "booking:track",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const parsed = z
        .object({ bookingId: z.string().uuid() })
        .safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      await enforceSocketRateLimit(auth.customerId!, "booking:track", 10, 60);

      const booking = await prisma.booking.findFirst({
        where: { id: parsed.data.bookingId, customerId: auth.customerId! },
        select: {
          id: true,
          status: true,
          assignedDriverId: true,
          vehicleCategoryId: true,
          pickupLatitude: true,
          pickupLongitude: true,
          trip: { select: { id: true } },
        },
      });
      if (!booking) {
        return acknowledge?.({
          success: false,
          error: { code: "BOOKING_NOT_FOUND" },
        });
      }

      await socket.join(`booking:${parsed.data.bookingId}`);
      await socket.join(`booking:${parsed.data.bookingId}:track`);
      if (booking.trip) await socket.join(`trip:${booking.trip.id}`);

      let currentLocation = null;
      if (booking.assignedDriverId) {
        const raw = await redis.get(
          `location:driver:${booking.assignedDriverId}`,
        );
        if (raw) currentLocation = JSON.parse(raw);
      } else if (
        booking.status === "SEARCHING_DRIVER" &&
        booking.vehicleCategoryId
      ) {
        // Register the booking in the geo-index for nearby unassigned drivers to broadcast to it
        await redis.geoadd(
          `category:${booking.vehicleCategoryId}:searching_bookings`,
          Number(booking.pickupLongitude),
          Number(booking.pickupLatitude),
          booking.id,
        );
        // Set expiry for this key so it cleans itself up if not untracked properly
        await redis.expire(
          `category:${booking.vehicleCategoryId}:searching_bookings`,
          3600,
        );
      }

      acknowledge?.({
        success: true,
        data: {
          bookingId: booking.id,
          status: booking.status,
          tripId: booking.trip?.id ?? null,
          currentLocation,
        },
      });
    }),
  );

  socket.on(
    "booking:untrack",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const parsed = z
        .object({ bookingId: z.string().uuid() })
        .safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      await socket.leave(`booking:${parsed.data.bookingId}:track`);
      const booking = await prisma.booking.findUnique({
        where: { id: parsed.data.bookingId },
        select: { vehicleCategoryId: true },
      });
      if (booking?.vehicleCategoryId) {
        await redis.zrem(
          `category:${booking.vehicleCategoryId}:searching_bookings`,
          parsed.data.bookingId,
        );
      }
      acknowledge?.({ success: true });
    }),
  );

  socket.on(
    "chat:send",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const parsed = z
        .object({
          bookingId: z.string().uuid(),
          message: z.string().trim().min(1).max(500),
          clientMessageId: z.string().trim().max(80).optional(),
        })
        .safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      await enforceSocketRateLimit(auth.customerId!, "chat:send", 30, 60);
      const data = await chat.send({
        userId: auth.userId,
        bookingId: parsed.data.bookingId,
        message: parsed.data.message,
        senderType: "CUSTOMER",
        customerId: auth.customerId,
        clientMessageId: parsed.data.clientMessageId,
      });
      acknowledge?.({ success: true, data });
    }),
  );

  socket.on(
    "chat:join",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const parsed = z
        .object({ bookingId: z.string().uuid() })
        .safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      const booking = await prisma.booking.findFirst({
        where: { id: parsed.data.bookingId, customerId: auth.customerId! },
      });
      if (!booking) {
        return acknowledge?.({
          success: false,
          error: { code: "BOOKING_NOT_FOUND" },
        });
      }
      await socket.join(`booking:${parsed.data.bookingId}:chat`);
      await socket.join(`booking:${parsed.data.bookingId}`);
      acknowledge?.({
        success: true,
        data: { messages: await chat.history(parsed.data.bookingId) },
      });
    }),
  );

  socket.on(
    "support:join",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const parsed = z
        .object({ ticketId: z.string().uuid() })
        .safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      await enforceSocketRateLimit(auth.customerId!, "support:join", 20, 60);
      const ticket = await prisma.supportTicket.findFirst({
        where: { id: parsed.data.ticketId, createdByUserId: auth.userId },
        select: { id: true },
      });
      if (!ticket) {
        return acknowledge?.({
          success: false,
          error: { code: "TICKET_NOT_FOUND" },
        });
      }
      await socket.join(`ticket:${ticket.id}`);
      acknowledge?.({
        success: true,
        data: { messages: await support.getMessages(auth.userId, ticket.id) },
      });
    }),
  );

  socket.on(
    "sos:join",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const parsed = z.object({ sosId: z.string().uuid() }).safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      await enforceSocketRateLimit(auth.customerId!, "sos:join", 20, 60);
      await safety.requireOwnedSos(auth.userId, parsed.data.sosId);
      await socket.join(`sos:${parsed.data.sosId}`);
      acknowledge?.({
        success: true,
        data: {
          sosId: parsed.data.sosId,
          messages: await safety.getMessages(auth.userId, parsed.data.sosId),
        },
      });
    }),
  );
};
