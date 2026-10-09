import type { FastifyInstance } from "fastify";
import type { Server as SocketServer } from "socket.io";
import { io as createClient, type Socket } from "socket.io-client";
import { buildApp } from "../src/app";
import { prisma } from "../src/database/prisma";
import { closeQueues } from "../src/infrastructure/queues";
import { getRealtimeServer } from "../src/infrastructure/realtime";
import { redis } from "../src/infrastructure/redis";
import { envelope } from "../src/realtime/socket-emitter.service";

type Login = { cookie: string; userId: string };

const nextPhone = (() => {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `+9177${String(Date.now() + sequence).slice(-8)}`;
  };
})();

const login = async (
  app: FastifyInstance,
  role: "CUSTOMER" | "DRIVER",
): Promise<Login> => {
  const phone = nextPhone();
  const request = await app.inject({
    method: "POST",
    url: "/api/v1/auth/otp/request",
    payload: { phone, role },
  });
  expect(request.statusCode).toBe(202);

  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/auth/otp/verify",
    payload: { phone, role, otp: "1234" },
  });
  expect(verify.statusCode).toBe(200);
  const cookieHeader = verify.headers["set-cookie"];
  const cookie = (
    Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader
  )?.split(";")[0];
  const body = verify.json<{ data: { user: { id: string } } }>();
  if (!cookie)
    throw new Error("Authentication did not return a session cookie");
  return { cookie, userId: body.data.user.id };
};

const connect = async (baseUrl: string, cookie: string): Promise<Socket> => {
  const socket = createClient(baseUrl, {
    path: "/socket.io",
    transports: ["websocket"],
    extraHeaders: { cookie },
    autoConnect: false,
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for socket:ready")),
      8_000,
    );
    socket.once("connect_error", reject);
    socket.once("socket:ready", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.connect();
  });
  return socket;
};

const receiveOnce = <T>(socket: Socket, event: string) =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      5_000,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

describe("Redis adapter multi-instance routing", () => {
  let appA: FastifyInstance;
  let appB: FastifyInstance;
  let ioA: SocketServer;
  let ioB: SocketServer;
  let customerSocket: Socket;
  let driverSocket: Socket;
  let customer: Login;
  let driver: Login;
  let driverId: string;

  beforeAll(async () => {
    await redis.flushdb();

    appA = await buildApp();
    const urlA = await appA.listen({ host: "127.0.0.1", port: 0 });
    const firstServer = getRealtimeServer();
    if (!firstServer) throw new Error("First Socket.IO server was not created");
    ioA = firstServer;

    appB = await buildApp();
    const urlB = await appB.listen({ host: "127.0.0.1", port: 0 });
    const secondServer = getRealtimeServer();
    if (!secondServer)
      throw new Error("Second Socket.IO server was not created");
    ioB = secondServer;

    customer = await login(appA, "CUSTOMER");
    driver = await login(appB, "DRIVER");
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId: driver.userId },
    });
    driverId = profile.id;

    customerSocket = await connect(urlA, customer.cookie);
    driverSocket = await connect(urlB, driver.cookie);
  }, 30_000);

  afterAll(async () => {
    customerSocket?.disconnect();
    driverSocket?.disconnect();
    await Promise.allSettled([appA?.close(), appB?.close()]);
    await closeQueues();
    await redis.quit();
    await prisma.$disconnect();
  });

  it("routes a driver event from instance A to a socket on instance B", async () => {
    const received = receiveOnce<{
      event: string;
      version: number;
      data: { marker: string };
    }>(driverSocket, "dispatch:offer");

    ioA
      .to(`driver:${driverId}`)
      .emit(
        "dispatch:offer",
        envelope("dispatch:offer", { marker: "from-instance-a" }),
      );

    await expect(received).resolves.toMatchObject({
      event: "dispatch:offer",
      version: 1,
      data: { marker: "from-instance-a" },
    });
  });

  it("routes a customer event from instance B to a socket on instance A", async () => {
    const received = receiveOnce<{
      event: string;
      version: number;
      data: { marker: string };
    }>(customerSocket, "booking:status-updated");

    ioB
      .to(`user:${customer.userId}`)
      .emit(
        "booking:status-updated",
        envelope("booking:status-updated", { marker: "from-instance-b" }),
      );

    await expect(received).resolves.toMatchObject({
      event: "booking:status-updated",
      version: 1,
      data: { marker: "from-instance-b" },
    });
  });
});
