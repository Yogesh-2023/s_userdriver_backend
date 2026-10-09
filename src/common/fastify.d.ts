import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
  }

  interface FastifyRequest {
    authSession: {
      sessionId: string;
      userId: string;
      roles: string[];
      permissions: string[];
      createdAt: string;
      lastActiveAt: string;
      expiresAt: string;
      isRevoked: boolean;
    } | null;
    admin: {
      id: string;
      userId: string;
      title: string | null;
      displayName: string | null;
      phone: string;
      email: string | null;
      status: string;
      roles: string[];
      permissions: string[];
    } | null;
  }
}
