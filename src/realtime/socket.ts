import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "../config/env";
import { getAllowedCorsOrigins } from "../config/cors";
import { redis } from "../infrastructure/redis";
import { setRealtimeServer } from "../infrastructure/realtime";
import { socketAuthMiddleware } from "./socket-auth.middleware";
import { joinPersonalRooms } from "./socket-room.service";
import { registerDriverHandler } from "./handlers/driver.handler";
import { registerCustomerHandler } from "./handlers/customer.handler";
import { registerAdminHandler } from "./handlers/admin.handler";
import { envelope } from "./socket-emitter.service";
import { SocketPresenceService } from "./socket-presence.service";
import { SocketStateSyncService } from "./socket-state-sync.service";

export const setupSocket = (app: FastifyInstance) => {
  const io = new Server(app.server, {
    path: "/socket.io",
    transports: ["polling", "websocket"],
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    cors: {
      origin: getAllowedCorsOrigins(env.CORS_ORIGINS),
      credentials: true,
    },
  });

  // Redis Adapter for Multi-Node Scaling
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  setRealtimeServer(io);

  app.addHook("onClose", async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.all([pubClient.quit(), subClient.quit()]);
    setRealtimeServer(null);
  });

  // Authentication Middleware
  io.use(socketAuthMiddleware(app));

  io.on("connection", async (socket) => {
    const presence = new SocketPresenceService();
    const stateSync = new SocketStateSyncService();
    try {
      await joinPersonalRooms(socket);
      await presence.connected(socket);
      const auth = socket.data.auth;
      socket.emit(
        "socket:ready",
        envelope("socket:ready", {
          roles: auth.roles,
          permissions: auth.permissions,
        }),
      );
      socket.emit(
        "state:sync",
        envelope("state:sync", await stateSync.synchronize(socket)),
      );
      registerDriverHandler(io, socket);
      registerCustomerHandler(io, socket);
      registerAdminHandler(io, socket);
      socket.on("disconnect", () => {
        void presence.disconnected(socket);
      });
    } catch (error) {
      app.log.error(
        { err: error, socketId: socket.id },
        "Realtime connection initialization failed",
      );
      socket.emit(
        "socket:error",
        envelope("socket:error", { code: "INTERNAL_ERROR" }),
      );
      socket.disconnect(true);
    }
  });

  return io;
};
