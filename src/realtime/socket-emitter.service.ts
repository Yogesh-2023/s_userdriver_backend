import { randomUUID } from "node:crypto";

export type RealtimeEventMeta = {
  requestId?: string | null;
  bookingId?: string | null;
  tripId?: string | null;
  dispatchCycleId?: string | null;
  sequence?: number | null;
};

export type RealtimeEnvelope<T> = {
  eventId: string;
  event: string;
  version: 1;
  occurredAt: string;
  data: T;
  meta: Required<RealtimeEventMeta>;
};

const idFromData = (data: unknown, key: string) => {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

export const envelope = <T>(
  event: string,
  data: T,
  meta: RealtimeEventMeta = {},
): RealtimeEnvelope<T> => ({
  eventId: randomUUID(),
  event,
  version: 1,
  occurredAt: new Date().toISOString(),
  data,
  meta: {
    requestId: meta.requestId ?? null,
    bookingId: meta.bookingId ?? idFromData(data, "bookingId"),
    tripId: meta.tripId ?? idFromData(data, "tripId"),
    dispatchCycleId:
      meta.dispatchCycleId ?? idFromData(data, "dispatchCycleId"),
    sequence: meta.sequence ?? null,
  },
});
