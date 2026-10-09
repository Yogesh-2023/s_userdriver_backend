import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { prisma } from "../src/database/prisma";
import { closeQueues } from "../src/infrastructure/queues";
import { redis } from "../src/infrastructure/redis";

describe("application transport", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    await closeQueues();
    redis.disconnect();
    await prisma.$disconnect();
  });

  it("serves liveness with security headers and a request id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-request-id": "e2e-health-check" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.json()).toMatchObject({
      success: true,
      data: { status: "ok" },
    });
  });

  it("returns a safe 404 envelope", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/does-not-exist",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
