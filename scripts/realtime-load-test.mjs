import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { io } from "socket.io-client";

const baseUrl = process.env.LOAD_BASE_URL ?? "http://127.0.0.1:3000";
const clients = Number(process.env.LOAD_SOCKET_COUNT ?? 1_000);
const manifestPath = process.env.LOAD_SESSION_MANIFEST;
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 60);

if (!manifestPath) {
  throw new Error(
    "LOAD_SESSION_MANIFEST is required. See docs/realtime/end-to-end-testing.md.",
  );
}

const credentials = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(credentials) || credentials.length === 0) {
  throw new Error("The load session manifest must be a non-empty JSON array.");
}

const percentile = (values, value) => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * value))];
};

const metrics = {
  requestedSockets: clients,
  connectedSockets: 0,
  connectionFailures: 0,
  readyLatencyMs: [],
  locationAckLatencyMs: [],
  offersReceived: 0,
  duplicateAssignments: 0,
  errors: 0,
};
const sockets = [];

await Promise.all(
  Array.from({ length: clients }, async (_, index) => {
    const credential = credentials[index % credentials.length];
    const startedAt = performance.now();
    const socket = io(baseUrl, {
      path: "/socket.io",
      transports: ["websocket"],
      extraHeaders: { cookie: credential.cookie },
      reconnection: false,
      timeout: 10_000,
    });
    sockets.push({ socket, credential });
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      socket.once("socket:ready", () => {
        metrics.connectedSockets += 1;
        metrics.readyLatencyMs.push(performance.now() - startedAt);
        finish();
      });
      socket.once("connect_error", () => {
        metrics.connectionFailures += 1;
        finish();
      });
      setTimeout(() => {
        if (!settled) metrics.connectionFailures += 1;
        finish();
      }, 12_000).unref();
      socket.on("dispatch:offer", () => {
        metrics.offersReceived += 1;
      });
      let assignmentSeen = false;
      socket.on("booking:driver-assigned", () => {
        if (assignmentSeen) metrics.duplicateAssignments += 1;
        assignmentSeen = true;
      });
      socket.on("socket:error", () => {
        metrics.errors += 1;
      });
    });
  }),
);

const driverSockets = sockets.filter(({ credential }) => credential.role === "DRIVER");
const updateTimer = setInterval(() => {
  for (const [index, { socket, credential }] of driverSockets.entries()) {
    const startedAt = performance.now();
    socket.emit(
      "driver:location:update",
      {
        latitude: Number(credential.latitude ?? 19.076) + index * 0.000001,
        longitude: Number(credential.longitude ?? 72.8777),
        accuracy: 10,
        speed: 5,
        heading: 90,
        timestamp: new Date().toISOString(),
        sequence: Date.now(),
        tripId: credential.tripId,
      },
      (response) => {
        if (response?.success) {
          metrics.locationAckLatencyMs.push(performance.now() - startedAt);
        } else {
          metrics.errors += 1;
        }
      },
    );
  }
}, 2_000);

await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1_000));
clearInterval(updateTimer);
for (const { socket } of sockets) socket.disconnect();

const result = {
  environment: {
    baseUrl,
    node: process.version,
    durationSeconds,
    credentialCount: credentials.length,
  },
  ...metrics,
  connectionSuccessRate:
    clients > 0 ? metrics.connectedSockets / clients : 0,
  readyLatencyMs: {
    p50: percentile(metrics.readyLatencyMs, 0.5),
    p95: percentile(metrics.readyLatencyMs, 0.95),
    p99: percentile(metrics.readyLatencyMs, 0.99),
  },
  locationAckLatencyMs: {
    p50: percentile(metrics.locationAckLatencyMs, 0.5),
    p95: percentile(metrics.locationAckLatencyMs, 0.95),
    p99: percentile(metrics.locationAckLatencyMs, 0.99),
  },
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (metrics.connectionFailures || metrics.duplicateAssignments) process.exitCode = 1;
