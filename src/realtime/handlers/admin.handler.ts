import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "../../database/prisma";
import type { SocketAuth } from "../socket-auth.middleware";
import { safeSocketHandler } from "../socket-error-handler";
import { enforceSocketRateLimit } from "../socket-rate-limit.middleware";
import { SocketStateSyncService } from "../socket-state-sync.service";

const stateSync = new SocketStateSyncService();

export const registerAdminHandler = (_io: Server, socket: Socket) => {
  const auth = socket.data.auth as SocketAuth;
  if (!auth.adminId) return;

  socket.on(
    "state:sync:request",
    safeSocketHandler(socket, async (_payload: unknown, acknowledge) => {
      await enforceSocketRateLimit(auth.adminId!, "state:sync", 10, 60);
      acknowledge?.({
        success: true,
        data: await stateSync.synchronize(socket),
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
      if (!auth.permissions?.includes("safety.manage")) {
        return acknowledge?.({
          success: false,
          error: { code: "FORBIDDEN" },
        });
      }
      await enforceSocketRateLimit(auth.adminId!, "sos:join", 30, 60);
      const sos = await prisma.sosRequest.findUnique({
        where: { id: parsed.data.sosId },
        select: { id: true },
      });
      if (!sos) {
        return acknowledge?.({
          success: false,
          error: { code: "SOS_NOT_FOUND" },
        });
      }
      await socket.join(`sos:${parsed.data.sosId}`);
      await socket.join(`emergency-sos:${parsed.data.sosId}`);
      acknowledge?.({ success: true });
    }),
  );
};
