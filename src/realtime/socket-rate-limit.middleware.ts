import { errors } from "../common/errors";
import { redis } from "../infrastructure/redis";
import { redisKeys } from "./socket.constants";

export const enforceSocketRateLimit = async (
  identity: string,
  event: string,
  limit: number,
  windowSeconds: number,
) => {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
  const key = redisKeys.rateLimit(identity, event, bucket);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds + 1);
  if (count > limit) throw errors.rateLimited("SOCKET_RATE_LIMITED");
};
