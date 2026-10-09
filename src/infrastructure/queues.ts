import { Queue } from "bullmq";
import { env } from "../config/env";

export const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };

export const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 1_000 },
  removeOnComplete: true, // Delete immediately after success (prevents Redis bloat)
  removeOnFail: { count: 50, age: 24 * 3600 }, // Keep max 50 failed jobs for debugging
};

export const queues = {
  dispatch: new Queue("dispatch", { connection, defaultJobOptions }),
  notifications: new Queue("notifications", {
    connection,
    defaultJobOptions,
  }),
  scheduledRides: new Queue("scheduled-rides", {
    connection,
    defaultJobOptions,
  }),
  payments: new Queue("payments", { connection, defaultJobOptions }),
  reports: new Queue("reports", { connection, defaultJobOptions }),
  maintenance: new Queue("maintenance", {
    connection,
    defaultJobOptions,
  }),
};

export const closeQueues = async () => {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
};
