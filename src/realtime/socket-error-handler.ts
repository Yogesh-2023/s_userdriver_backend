import type { Socket } from "socket.io";
import { AppError } from "../common/errors";
import { envelope } from "./socket-emitter.service";

type Acknowledge = ((response: unknown) => void) | undefined;

const stableCode = (error: unknown) => {
  if (error instanceof AppError) {
    if (/^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
    return error.code;
  }
  return "INTERNAL_ERROR";
};

export const acknowledgeError = (acknowledge: Acknowledge, error: unknown) => {
  const code = stableCode(error);
  acknowledge?.({ success: false, error: { code } });
  return code;
};

export const safeSocketHandler =
  <T>(
    socket: Socket,
    handler: (payload: T, acknowledge: Acknowledge) => Promise<unknown>,
  ) =>
  async (payload: T, acknowledge: Acknowledge) => {
    try {
      return await handler(payload, acknowledge);
    } catch (error) {
      const code = acknowledgeError(acknowledge, error);
      socket.emit(
        "socket:error",
        envelope("socket:error", {
          code,
        }),
      );
      return undefined;
    }
  };
