import type { Server } from "socket.io";
import { redis } from "./redis";
import { prisma } from "../database/prisma";
import {
  envelope,
  type RealtimeEventMeta,
} from "../realtime/socket-emitter.service";
import { REALTIME_TTL, redisKeys } from "../realtime/socket.constants";

let io: Server | null = null;

export const setRealtimeServer = (server: Server | null) => {
  io = server;
};

export const getRealtimeServer = () => io;

const nextSequence = async (meta?: RealtimeEventMeta) => {
  if (meta?.sequence != null) return meta.sequence;
  const bookingId = meta?.bookingId;
  const tripId = meta?.tripId;
  if (!bookingId && !tripId) return null;
  const scope = bookingId
    ? redisKeys.eventSequence("booking", bookingId)
    : redisKeys.eventSequence("trip", tripId!);
  const sequence = await redis.incr(scope);
  if (sequence === 1) {
    await redis.expire(scope, REALTIME_TTL.TRIP_SECONDS);
  }
  return sequence;
};

const emitPrepared = (
  room: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  io?.to(room).emit(event, envelope(event, data, meta));
};

const emitRoom = (
  room: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  void (async () => {
    const sequence = await nextSequence(meta);
    emitPrepared(room, event, data, { ...meta, sequence });
  })();
};

export const emitBooking = (
  bookingId: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  void (async () => {
    const next = { ...meta, bookingId };
    const sequence = await nextSequence(next);
    const prepared = { ...next, sequence };
    emitPrepared(`booking:${bookingId}`, event, data, prepared);
    emitPrepared(`booking:${bookingId}:track`, event, data, prepared);

    const aliases: Record<string, string[]> = {
      "booking:driver-assigned": [
        "booking:updated",
        "booking.updated",
        "driver:assigned",
        "driver.assigned",
        "ride:accepted",
        "ride.accepted",
        "TRIP_ACCEPTED",
        "DRIVER_FOUND",
        "goods.driver.assigned",
        "goods.booking.accepted",
        "booking:accepted",
      ],
      "driver:heading-to-pickup": [
        "booking:updated",
        "booking.updated",
        "driver:arriving",
        "driver.arriving",
      ],
      "driver:arrived": [
        "booking:updated",
        "booking.updated",
        "driver_arrived",
        "driver.arrived",
        "DRIVER_ARRIVED",
        "goods.driver.arrived",
      ],
      "trip:started": [
        "booking:updated",
        "booking.updated",
        "trip.started",
        "TRIP_STARTED",
        "goods.trip.started",
        "goods:booking:start",
      ],
      "trip:completed": [
        "booking:updated",
        "booking.updated",
        "trip.completed",
        "TRIP_COMPLETED",
        "goods.trip.completed",
        "goods:booking:complete",
      ],
      "booking:cancelled": [
        "booking:updated",
        "booking.updated",
        "TRIP_CANCELLED",
        "TRIP_CANCELLED_BY_USER",
        "goods.booking.cancelled",
      ],
      "dispatch:no-driver-found": [
        "booking:no-driver-found",
        "booking.no-driver-found",
        "no_driver_found",
        "goods.booking.no-driver-found",
      ],
    };

    if (aliases[event]) {
      for (const alias of aliases[event]) {
        emitPrepared(`booking:${bookingId}`, alias, data, prepared);
        emitPrepared(`booking:${bookingId}:track`, alias, data, prepared);
      }
    }

    try {
      const b = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { customer: { select: { id: true, userId: true } } },
      });
      if (b?.customer) {
        emitPrepared(`user:${b.customer.userId}`, event, data, prepared);
        emitPrepared(`customer:${b.customer.id}`, event, data, prepared);
        if (aliases[event]) {
          for (const alias of aliases[event]) {
            emitPrepared(`user:${b.customer.userId}`, alias, data, prepared);
            emitPrepared(`customer:${b.customer.id}`, alias, data, prepared);
          }
        }
      }
    } catch (_) {}
  })();
};

const emitTrip = (
  tripId: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom(`trip:${tripId}`, event, data, { ...meta, tripId });
};

export const emitDriver = (
  driverId: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom(`driver:${driverId}`, event, data, meta);
  void (async () => {
    try {
      const dp = await prisma.driverProfile.findUnique({
        where: { id: driverId },
        select: { userId: true },
      });
      if (dp?.userId) {
        emitRoom(`user:${dp.userId}`, event, data, meta);
      }
    } catch (_) {}
  })();
};

const emitCustomer = (
  customerId: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom(`customer:${customerId}`, event, data, meta);
};

export const emitUser = (
  userId: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom(`user:${userId}`, event, data, meta);
};

export const emitSos = (
  sosId: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom(`sos:${sosId}`, event, data, meta);
  emitRoom(`emergency-sos:${sosId}`, event, data, meta);
};

export const emitTicket = (
  ticketId: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom(`ticket:${ticketId}`, event, data, meta);
};

export const emitAdmins = (
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom("admin:tracking", event, data, meta);
};

export const emitAdminRoom = (
  room: "dashboard" | "tracking" | "support" | "safety",
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom(`admin:${room}`, event, data, meta);
};

const emitAdmin = (
  adminId: string,
  event: string,
  data: unknown,
  meta?: RealtimeEventMeta,
) => {
  emitRoom(`admin:${adminId}`, event, data, meta);
};

export const emitRideLocation = (input: {
  bookingId: string;
  tripId?: string | null;
  data: unknown;
}) => {
  const event = "trip:location-updated";
  void (async () => {
    const meta = {
      bookingId: input.bookingId,
      tripId: input.tripId ?? null,
    };
    const sequence = await nextSequence(meta);
    const prepared = { ...meta, sequence };
    emitPrepared(`booking:${input.bookingId}`, event, input.data, prepared);
    emitPrepared(
      `booking:${input.bookingId}:track`,
      event,
      input.data,
      prepared,
    );

    const locationAliases = [
      "driver_location_update",
      "DRIVER_LOCATION",
      "goods.location.updated",
      "admin:driver:location-updated",
    ];
    for (const alias of locationAliases) {
      emitPrepared(`booking:${input.bookingId}`, alias, input.data, prepared);
      emitPrepared(
        `booking:${input.bookingId}:track`,
        alias,
        input.data,
        prepared,
      );
    }

    if (input.tripId) {
      emitPrepared(`trip:${input.tripId}`, event, input.data, prepared);
      for (const alias of locationAliases) {
        emitPrepared(`trip:${input.tripId}`, alias, input.data, prepared);
      }
    }
  })();
};

export const emitNearbyDriverLocation = (
  bookingIds: string[],
  data: unknown,
) => {
  const event = "driver_location_update";
  for (const bookingId of bookingIds) {
    // Send envelope with bookingId meta so it matches the expected structure
    emitPrepared(`booking:${bookingId}:track`, event, data, { bookingId });
  }
};

export const disconnectSession = (sessionId: string) => {
  if (!io) return;
  const room = redisKeys.sessionRoom(sessionId);
  emitRoom(room, "socket:session-revoked", {
    code: "SOCKET_SESSION_EXPIRED",
  });
  io.in(room).disconnectSockets(true);
};
