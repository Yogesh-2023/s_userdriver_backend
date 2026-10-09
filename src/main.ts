import { buildApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./database/prisma";
import { closeQueues } from "./infrastructure/queues";
import { redis } from "./infrastructure/redis";
import { ensureSupportCategories } from "./modules/support/seed-categories";
import { closeWorkers, startWorkers } from "./jobs/workers";

const main = async () => {
  const app = await buildApp();
  await prisma.$connect();
  if (redis.status === "wait") await redis.connect();
  await ensureSupportCategories().catch((error) =>
    app.log.error({ err: error }, "Support category bootstrap failed"),
  );
  await startWorkers();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Graceful shutdown started");
    await app.close();
    await closeWorkers();
    await closeQueues();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  await app.listen({ port: env.PORT, host: env.HOST });
};

void main();
