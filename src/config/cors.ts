import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { env } from "./env";

const CORS_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

const CORS_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
  "Origin",
  "X-Requested-With",
  "x-csrf-token",
  "x-idempotency-key",
  "x-request-id",
] as const;

const CORS_EXPOSED_HEADERS = ["x-csrf-token", "x-request-id"] as const;

const parseCorsOrigins = (origins: string) =>
  origins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

export const getAllowedCorsOrigins = (corsOrigins: string) =>
  Array.from(new Set(parseCorsOrigins(corsOrigins)));

export const registerCors = async (app: FastifyInstance) => {
  await app.register(cors, {
    origin: getAllowedCorsOrigins(env.CORS_ORIGINS),
    credentials: true,
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
  });
};
