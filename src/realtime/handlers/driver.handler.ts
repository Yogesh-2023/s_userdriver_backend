import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { env } from "../../config/env";
import {
  emitAdminRoom,
  emitDriver,
  emitRideLocation,
  emitNearbyDriverLocation,
} from "../../infrastructure/realtime";
import { queues } from "../../infrastructure/queues";
import { redis } from "../../infrastructure/redis";
import { prisma } from "../../database/prisma";
import { DispatchService } from "../../modules/dispatch/service";
import { DriverAvailabilityService } from "../../modules/driver/services/driver-availability.service";
import { DriverLocationService } from "../../modules/driver/services/driver-location.service";
import { RideChatService } from "../../modules/bookings/ride-chat.service";
import { SafetyService } from "../../modules/safety/service";
import { TripsService } from "../../modules/trips/service";
import type { SocketAuth } from "../socket-auth.middleware";
import { REALTIME_TTL, redisKeys } from "../socket.constants";
import { safeSocketHandler } from "../socket-error-handler";
import { enforceSocketRateLimit } from "../socket-rate-limit.middleware";
import { SocketStateSyncService } from "../socket-state-sync.service";

const dispatch = new DispatchService();
const availability = new DriverAvailabilityService();
const locations = new DriverLocationService();
const trips = new TripsService();
const chat = new RideChatService();
const safety = new SafetyService();
const stateSync = new SocketStateSyncService();

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(90).optional(),
  accuracy: z.number().min(0).max(2_000).optional(),
  timestamp: z.coerce.date().default(() => new Date()),
  sequence: z.number().int().nonnegative().optional(),
  tripId: z.string().uuid().optional(),
});

export const registerDriverHandler = (_io: Server, socket: Socket) => {
  const auth = socket.data.auth as SocketAuth;
  if (!auth.driverId) return;

  console.log(
    `[YOGESH][SOCKET][DRIVER] Registered driver socket connection (Driver ID: ${auth.driverId}, User ID: ${auth.userId}, Socket ID: ${socket.id})`,
  );

  const online = safeSocketHandler(
    socket,
    async (payload: unknown, acknowledge) => {
      console.log(
        `[YOGESH][DRIVER][STATUS] Driver ${auth.driverId} going ONLINE via socket (Socket ID: ${socket.id})`,
      );
      await enforceSocketRateLimit(auth.driverId!, "driver:online", 5, 60);
      const parsed = locationSchema.safeParse(payload);
      const locationData = parsed.success
        ? parsed.data
        : {
            latitude: 0,
            longitude: 0,
            timestamp: new Date(),
            sequence: 1,
          };
      const state = await availability.goOnline(auth.driverId!);
      try {
        await locations.updateLocationByDriverId(auth.driverId!, locationData);
      } catch (err) {
        console.log(
          `[YOGESH][DRIVER][STATUS] Location update during online warning: ${err}`,
        );
      }
      await socket.join(`driver:${auth.driverId}`);
      if (state.categoryId) {
        await socket.join(`category:${state.categoryId}:drivers`);
      }
      console.log(
        `[YOGESH][DRIVER][STATUS] Driver ${auth.driverId} marked ONLINE_AVAILABLE (Category: ${state.categoryId}, Vehicle: ${state.vehicleId}, Joined Rooms: driver:${auth.driverId})`,
      );
      emitDriver(auth.driverId!, "driver:availability-updated", {
        availability: "ONLINE_AVAILABLE",
        categoryId: state.categoryId,
        vehicleId: state.vehicleId,
      });
      emitAdminRoom("tracking", "admin:driver:availability-updated", {
        driverId: auth.driverId,
        availability: "ONLINE_AVAILABLE",
        categoryId: state.categoryId,
      });
      acknowledge?.({
        success: true,
        data: { availability: "ONLINE_AVAILABLE" },
      });
    },
  );
  socket.on("driver:online", online);
  socket.on("driver:go-online", online);

  const offline = safeSocketHandler(
    socket,
    async (_payload: unknown, acknowledge) => {
      await enforceSocketRateLimit(auth.driverId!, "driver:offline", 5, 60);
      await availability.goOffline(auth.driverId!, "DRIVER_MANUAL_OFFLINE");
      emitDriver(auth.driverId!, "driver:availability-updated", {
        availability: "OFFLINE",
      });
      emitAdminRoom("tracking", "admin:driver:availability-updated", {
        driverId: auth.driverId,
        availability: "OFFLINE",
      });
      acknowledge?.({ success: true, data: { availability: "OFFLINE" } });
    },
  );
  socket.on("driver:offline", offline);
  socket.on("driver:go-offline", offline);

  socket.on(
    "driver:location:update",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      await enforceSocketRateLimit(
        auth.driverId!,
        "driver:location:update",
        env.SOCKET_LOCATION_RATE_LIMIT_PER_SECOND,
        1,
      );
      const parsed = locationSchema.safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      const update = await locations.updateLocationByDriverId(
        auth.driverId!,
        parsed.data,
      );
      const ride = update.ride;
      if (ride) {
        emitRideLocation({
          bookingId: ride.bookingId,
          tripId: ride.id,
          data: {
            bookingId: ride.bookingId,
            tripId: ride.id,
            location: {
              latitude: update.latitude,
              longitude: update.longitude,
              heading: update.heading,
              speed: update.speed,
              accuracy: update.accuracy,
              recordedAt: update.receivedAt,
              sequence: update.sequence,
            },
            eta: (update as any).eta,
          },
        });
      } else if ((update as any).nearbySearchingBookings?.length) {
        emitNearbyDriverLocation((update as any).nearbySearchingBookings, {
          driverId: auth.driverId,
          latitude: update.latitude,
          longitude: update.longitude,
          heading: update.heading,
          speed: update.speed,
          accuracy: update.accuracy,
        });
      }
      const throttle = await redis.set(
        redisKeys.adminTrackingThrottle(auth.driverId!),
        "1",
        "EX",
        3,
        "NX",
      );
      if (throttle) {
        emitAdminRoom(
          "tracking",
          parsed.data.tripId || ride?.id
            ? "admin:trip:location-updated"
            : "admin:driver:location-updated",
          {
            driverId: auth.driverId,
            tripId: parsed.data.tripId ?? ride?.id ?? null,
            bookingId: ride?.bookingId ?? null,
            latitude: update.latitude,
            longitude: update.longitude,
            heading: update.heading,
            recordedAt: update.receivedAt,
          },
        );
      }
      acknowledge?.({
        success: true,
        data: {
          recordedAt: update.receivedAt,
          sequence: update.sequence,
        },
      });
    }),
  );

  const acceptHandler = safeSocketHandler(
    socket,
    async (payload: unknown, acknowledge) => {
      await enforceSocketRateLimit(auth.driverId!, "dispatch:accept", 10, 60);
      const raw = (
        typeof payload === "object" && payload !== null ? payload : {}
      ) as Record<string, any>;
      const targetId = raw.offerId || raw.bookingId || raw.tripId || raw.id;
      if (!targetId || typeof targetId !== "string") {
        return acknowledge?.({
          success: false,
          error: {
            code: "SOCKET_INVALID_PAYLOAD",
            message: "offerId or bookingId required",
          },
        });
      }
      console.log(`
================================================================================
[DRIVER ACCEPTED RIDE] ✅
--------------------------------------------------------------------------------
Driver ID  : ${auth.driverId} (User ID: ${auth.userId})
Target ID  : ${targetId}
================================================================================
`);
      const assignment = await dispatch.accept(targetId, auth.userId);
      acknowledge?.({ success: true, data: assignment });
    },
  );

  socket.on("dispatch:accept", acceptHandler);
  socket.on("ACCEPT_TRIP", acceptHandler);
  socket.on("goods:booking:accept", acceptHandler);

  const rejectHandler = safeSocketHandler(
    socket,
    async (payload: unknown, acknowledge) => {
      await enforceSocketRateLimit(auth.driverId!, "dispatch:reject", 20, 60);
      const raw = (
        typeof payload === "object" && payload !== null ? payload : {}
      ) as Record<string, any>;
      const targetId = raw.offerId || raw.bookingId || raw.tripId || raw.id;
      if (!targetId || typeof targetId !== "string") {
        return acknowledge?.({
          success: false,
          error: {
            code: "SOCKET_INVALID_PAYLOAD",
            message: "offerId required",
          },
        });
      }
      console.log(`
================================================================================
[DRIVER REJECTED RIDE] ❌
--------------------------------------------------------------------------------
Driver ID  : ${auth.driverId} (User ID: ${auth.userId})
Target ID  : ${targetId}
Reason     : ${raw.reason ?? "None"}
================================================================================
`);
      await dispatch.reject(targetId, auth.userId, raw.reason);
      acknowledge?.({ success: true });
    },
  );

  socket.on("dispatch:reject", rejectHandler);
  socket.on("REJECT_TRIP", rejectHandler);

  socket.on(
    "driver:heading-to-pickup",
    safeSocketHandler(socket, async (payload: unknown, acknowledge) => {
      const raw = (
        typeof payload === "object" && payload !== null ? payload : {}
      ) as Record<string, any>;
      const tripId = raw.tripId || raw.bookingId || raw.id;
      if (!tripId || typeof tripId !== "string") {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      const result = await trips.arriving(tripId, auth.userId);
      acknowledge?.({ success: true, data: result });
    }),
  );

  const arrivedHandler = safeSocketHandler(
    socket,
    async (payload: unknown, acknowledge) => {
      const raw = (
        typeof payload === "object" && payload !== null ? payload : {}
      ) as Record<string, any>;
      const tripId = raw.tripId || raw.bookingId || raw.id;
      if (!tripId || typeof tripId !== "string") {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      const result = await trips.arrived(tripId, auth.userId);
      acknowledge?.({ success: true, data: result });
    },
  );

  socket.on("driver:arrived", arrivedHandler);
  socket.on("DRIVER_ARRIVED", arrivedHandler);
  socket.on("goods:driver:arrived_pickup", arrivedHandler);

  const startHandler = safeSocketHandler(
    socket,
    async (payload: unknown, acknowledge) => {
      const raw = (
        typeof payload === "object" && payload !== null ? payload : {}
      ) as Record<string, any>;
      const tripId = raw.tripId || raw.bookingId || raw.id;
      const otp = raw.otp ? String(raw.otp).trim() : "0000";
      if (!tripId || typeof tripId !== "string") {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      const result = await trips.start(tripId, otp, auth.userId);
      acknowledge?.({ success: true, data: result });
    },
  );

  socket.on("trip:start", startHandler);
  socket.on("START_TRIP", startHandler);
  socket.on("goods:booking:start", startHandler);
  socket.on("goods:pickup:verify", startHandler);

  const completeHandler = safeSocketHandler(
    socket,
    async (payload: unknown, acknowledge) => {
      const raw = (
        typeof payload === "object" && payload !== null ? payload : {}
      ) as Record<string, any>;
      const tripId = raw.tripId || raw.bookingId || raw.id;
      if (!tripId || typeof tripId !== "string") {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      const result = await trips.complete(tripId, auth.userId, {});
      acknowledge?.({ success: true, data: result });
    },
  );

  socket.on("trip:complete", completeHandler);
  socket.on("END_TRIP", completeHandler);
  socket.on("goods:booking:complete", completeHandler);
  socket.on("goods:delivery:verify", completeHandler);

  socket.on(
    "state:sync:request",
    safeSocketHandler(socket, async (_payload: unknown, acknowledge) => {
      await enforceSocketRateLimit(auth.driverId!, "state:sync", 10, 60);
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
          reason: z.string().trim().max(100).optional(),
        })
        .safeParse(payload);
      if (!parsed.success) {
        return acknowledge?.({
          success: false,
          error: { code: "SOCKET_INVALID_PAYLOAD" },
        });
      }
      await enforceSocketRateLimit(auth.driverId!, "booking:cancel", 5, 60);
      const result = await dispatch.driverCancel(
        parsed.data.bookingId,
        auth.userId,
        parsed.data.reason,
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
      await enforceSocketRateLimit(auth.driverId!, "sos:create", 3, 300);
      const sos = await safety.createSos(auth.userId, parsed.data);
      acknowledge?.({ success: true, data: { sosId: sos.id } });
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
      const owned = await prisma.booking.findFirst({
        where: {
          id: parsed.data.bookingId,
          assignedDriverId: auth.driverId!,
        },
        select: { id: true },
      });
      if (!owned) {
        return acknowledge?.({
          success: false,
          error: { code: "BOOKING_NOT_FOUND" },
        });
      }
      await socket.join(`booking:${parsed.data.bookingId}:chat`);
      await socket.join(`booking:${parsed.data.bookingId}`);
      acknowledge?.({ success: true });
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
      await enforceSocketRateLimit(auth.driverId!, "support:join", 20, 60);
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
      acknowledge?.({ success: true });
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
      await enforceSocketRateLimit(auth.driverId!, "sos:join", 20, 60);
      await safety.requireOwnedSos(auth.userId, parsed.data.sosId);
      await socket.join(`sos:${parsed.data.sosId}`);
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
      await enforceSocketRateLimit(auth.driverId!, "chat:send", 30, 60);
      const data = await chat.send({
        userId: auth.userId,
        bookingId: parsed.data.bookingId,
        message: parsed.data.message,
        senderType: "DRIVER",
        driverId: auth.driverId,
        clientMessageId: parsed.data.clientMessageId,
      });
      acknowledge?.({ success: true, data });
    }),
  );

  socket.on(
    "driver:heartbeat",
    safeSocketHandler(socket, async (_payload: unknown, acknowledge) => {
      await enforceSocketRateLimit(auth.driverId!, "driver:heartbeat", 30, 60);
      await redis.set(
        redisKeys.driverPresence(auth.driverId!),
        new Date().toISOString(),
        "EX",
        REALTIME_TTL.PRESENCE_SECONDS,
      );
      acknowledge?.({ success: true });
    }),
  );

  socket.on("disconnect", () => {
    void scheduleDisconnectCheck(auth.driverId!);
  });
};

const scheduleDisconnectCheck = async (driverId: string) => {
  const jobId = `driver-presence-${driverId}`;
  const existing = await queues.maintenance.getJob(jobId);
  await existing?.remove();
  await queues.maintenance.add(
    "driver-presence-stale-check",
    { driverId },
    {
      jobId,
      delay: env.DRIVER_DISCONNECT_GRACE_SECONDS * 1_000,
      removeOnComplete: true,
    },
  );
};
