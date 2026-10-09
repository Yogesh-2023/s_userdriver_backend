import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Socket } from "socket.io";
import { env } from "../config/env";
import { SessionsService } from "../modules/sessions/service";
import { prisma } from "../database/prisma";

const sessions = new SessionsService();

export interface SocketAuth {
  sessionId: string;
  userId: string;
  roles: string[];
  permissions: string[];
  customerId?: string;
  driverId?: string;
  adminId?: string;
}

export const socketAuthMiddleware =
  (app: FastifyInstance) =>
  async (socket: Socket, next: (err?: Error) => void) => {
    try {
      let rawToken: string | undefined;

      // 1. Extract from Cookie header
      const cookieHeader = (socket.handshake.headers.cookie ||
        socket.handshake.headers.Cookie ||
        "") as string;
      if (cookieHeader) {
        const parts = cookieHeader.split(";");
        for (const part of parts) {
          const separator = part.indexOf("=");
          if (separator >= 0) {
            const name = part.slice(0, separator).trim();
            const val = part.slice(separator + 1).trim();
            if (
              name === env.COOKIE_NAME ||
              name === "fleet_session" ||
              name === "session" ||
              name === "better-auth.session_token"
            ) {
              rawToken = val;
              break;
            }
          }
        }
      }

      // 2. Extract from Authorization header
      if (!rawToken) {
        const authHeader = (socket.handshake.headers.authorization ||
          socket.handshake.headers.Authorization ||
          "") as string;
        if (authHeader) {
          rawToken = authHeader.replace(/^Bearer\s+/i, "").trim();
        }
      }

      // 3. Extract from Auth payload
      if (!rawToken && socket.handshake.auth) {
        const authObj = socket.handshake.auth as Record<string, any>;
        rawToken =
          authObj.token ||
          authObj.cookie ||
          authObj.sessionToken ||
          authObj.session;
      }

      // 4. Extract from Query params
      if (!rawToken && socket.handshake.query) {
        const queryObj = socket.handshake.query as Record<string, any>;
        rawToken = queryObj.token || queryObj.sessionToken || queryObj.session;
      }

      if (!rawToken) return next(new Error("SOCKET_UNAUTHENTICATED"));

      const decoded = decodeURIComponent(rawToken);
      let session: any = null;

      // Try unsigning if signed cookie
      const unsigned = app.unsignCookie(decoded);
      if (unsigned.valid && unsigned.value) {
        session = await sessions.validate(unsigned.value);
      }

      // If not valid signed cookie, try raw token directly
      if (!session) {
        const cleanId =
          decoded.replace(/^s%3A|^s:/, "").split(".")[0] || decoded;
        session = await sessions.validate(cleanId);
      }

      // Final fallback to raw string
      if (!session && decoded !== rawToken) {
        session = await sessions.validate(rawToken);
      }

      if (!session) return next(new Error("SOCKET_SESSION_EXPIRED"));

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          status: true,
          customerProfile: { select: { id: true } },
          driverProfile: {
            select: { id: true, verificationStatus: true },
          },
          adminProfile: { select: { id: true } },
          roles: {
            select: {
              role: {
                select: {
                  name: true,
                  permissions: {
                    select: { permission: { select: { key: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!user || user.status !== "ACTIVE") {
        return next(new Error("SOCKET_FORBIDDEN"));
      }
      const roles = user.roles.map(({ role }) => role.name);
      const permissions = [
        ...new Set(
          user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ];
      const auth: SocketAuth = {
        sessionId: session.sessionId,
        userId: session.userId,
        roles,
        permissions,
        customerId: user.customerProfile?.id,
        driverId: user.driverProfile?.id,
        adminId: user.adminProfile?.id,
      };

      if (
        auth.roles.includes("DRIVER") &&
        user.driverProfile?.verificationStatus === "SUSPENDED"
      ) {
        return next(new Error("SOCKET_FORBIDDEN"));
      }

      const ipHash = createHash("sha256")
        .update(socket.handshake.address)
        .digest("hex");
      const connectionKey = `socket:connect:${ipHash}:${Math.floor(Date.now() / 60_000)}`;
      const connectionCount = await app.redis.incr(connectionKey);
      if (connectionCount === 1) await app.redis.expire(connectionKey, 61);
      if (connectionCount > 60) return next(new Error("SOCKET_RATE_LIMITED"));

      socket.data.auth = auth;
      next();
    } catch {
      next(new Error("SOCKET_UNAUTHENTICATED"));
    }
  };
