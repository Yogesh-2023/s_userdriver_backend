import type { Socket } from "socket.io";
import { redis } from "../infrastructure/redis";
import { getRealtimeServer } from "../infrastructure/realtime";
import type { SocketAuth } from "./socket-auth.middleware";
import { REALTIME_TTL, redisKeys } from "./socket.constants";

const decrement = async (key: string) =>
  redis.eval(
    "local n=tonumber(redis.call('get',KEYS[1]) or '0'); if n<=1 then return redis.call('del',KEYS[1]) else return redis.call('decr',KEYS[1]) end",
    1,
    key,
  );

export class SocketPresenceService {
  async connected(socket: Socket) {
    const auth = socket.data.auth as SocketAuth;
    const keys = this.connectionKeys(auth);
    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.incr(key);
      pipeline.expire(key, REALTIME_TTL.CONNECTION_SECONDS);
    }
    for (const socketKey of this.socketSetKeys(auth)) {
      pipeline.sadd(socketKey, socket.id);
      pipeline.expire(socketKey, REALTIME_TTL.CONNECTION_SECONDS);
    }
    if (auth.driverId) {
      pipeline.set(
        redisKeys.driverPresence(auth.driverId),
        new Date().toISOString(),
        "EX",
        REALTIME_TTL.PRESENCE_SECONDS,
      );
    }
    await pipeline.exec();
  }

  async disconnected(socket: Socket) {
    const auth = socket.data.auth as SocketAuth;
    await Promise.all([
      ...this.connectionKeys(auth).map(decrement),
      ...this.socketSetKeys(auth).map((key) => redis.srem(key, socket.id)),
    ]);
  }

  async hasDriverConnections(driverId: string) {
    const live = await getRealtimeServer()
      ?.in(`driver:${driverId}`)
      .fetchSockets();
    if (live) return live.length > 0;
    return (
      Number(
        (await redis.scard(redisKeys.profileSockets("driver", driverId))) ?? 0,
      ) > 0
    );
  }

  async refreshDriver(driverId: string) {
    await redis.set(
      redisKeys.driverPresence(driverId),
      new Date().toISOString(),
      "EX",
      REALTIME_TTL.PRESENCE_SECONDS,
    );
  }

  private connectionKeys(auth: SocketAuth) {
    const keys = [redisKeys.sessionConnections(auth.sessionId)];
    if (auth.customerId) {
      keys.push(redisKeys.profileConnections("customer", auth.customerId));
    }
    if (auth.driverId) {
      keys.push(redisKeys.profileConnections("driver", auth.driverId));
    }
    if (auth.adminId) {
      keys.push(redisKeys.profileConnections("admin", auth.adminId));
    }
    return keys;
  }

  private socketSetKeys(auth: SocketAuth) {
    const keys: string[] = [];
    if (auth.customerId) {
      keys.push(redisKeys.profileSockets("customer", auth.customerId));
    }
    if (auth.driverId) {
      keys.push(redisKeys.profileSockets("driver", auth.driverId));
    }
    if (auth.adminId) {
      keys.push(redisKeys.profileSockets("admin", auth.adminId));
    }
    return keys;
  }
}
