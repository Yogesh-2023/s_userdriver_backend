import { ConfigValueType, Prisma } from "@prisma/client";
import { z } from "zod";
import { errors } from "../../../common/errors";
import { env } from "../../../config/env";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import type { AdminActionContext } from "../admin.constants";

const definitions = {
  "platform.name": {
    group: "general",
    type: ConfigValueType.STRING,
    schema: z.string().trim().min(1).max(120),
    critical: false,
    defaultValue: "Swaariya Travels",
  },
  "platform.currency": {
    group: "general",
    type: ConfigValueType.STRING,
    schema: z.string().trim().length(3).toUpperCase(),
    critical: false,
    defaultValue: "INR",
  },
  "booking.maximum_radius_km": {
    group: "booking",
    type: ConfigValueType.NUMBER,
    schema: z.number().min(1).max(200),
    critical: false,
    defaultValue: 25,
  },
  "dispatch.search_radius_km": {
    group: "dispatch",
    type: ConfigValueType.NUMBER,
    schema: z.number().min(1).max(100),
    critical: false,
    defaultValue: 5,
  },
  "dispatch.acceptance_timeout_seconds": {
    group: "dispatch",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(5).max(120),
    critical: false,
  },
  "dispatch.maximum_retries": {
    group: "dispatch",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(1).max(20),
    critical: false,
  },
  "booking.scheduled_minimum_lead_minutes": {
    group: "booking",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(5).max(1440),
    critical: false,
  },
  "booking.cancellation_window_minutes": {
    group: "booking",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(0).max(1440),
    critical: false,
  },
  "otp.expiry_seconds": {
    group: "otp",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(60).max(900),
    critical: true,
  },
  "otp.resend_cooldown_seconds": {
    group: "otp",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(30).max(900),
    critical: true,
  },
  "otp.maximum_attempts": {
    group: "otp",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(3).max(10),
    critical: true,
  },
  "sessions.expiry_seconds": {
    group: "sessions",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(3600).max(31_536_000),
    critical: true,
  },
  "pricing.platform_commission_percentage": {
    group: "pricing",
    type: ConfigValueType.NUMBER,
    schema: z.number().min(0).max(100),
    critical: true,
    defaultValue: 10,
  },
  "pricing.default_tax_percentage": {
    group: "pricing",
    type: ConfigValueType.NUMBER,
    schema: z.number().min(0).max(100),
    critical: true,
    defaultValue: 5,
  },
  "support.contact_phone": {
    group: "support",
    type: ConfigValueType.STRING,
    schema: z.string().regex(/^\+[1-9]\d{7,14}$/),
    critical: false,
    defaultValue: "+919999999999",
  },
  "support.contact_email": {
    group: "support",
    type: ConfigValueType.STRING,
    schema: z.email(),
    critical: false,
    defaultValue: "support@swaariya.com",
  },
  "safety.emergency_contact_phone": {
    group: "safety",
    type: ConfigValueType.STRING,
    schema: z.string().regex(/^\+[1-9]\d{7,14}$/),
    critical: true,
  },
  "maintenance.enabled": {
    group: "maintenance",
    type: ConfigValueType.BOOLEAN,
    schema: z.boolean(),
    critical: true,
  },
  "maintenance.message": {
    group: "maintenance",
    type: ConfigValueType.STRING,
    schema: z.string().max(500),
    critical: true,
  },
  "apps.minimum_supported_versions": {
    group: "maintenance",
    type: ConfigValueType.JSON,
    schema: z.record(z.string(), z.string().max(30)),
    critical: true,
  },
  "referral.discount_percentage": {
    group: "marketing",
    type: ConfigValueType.NUMBER,
    schema: z.number().min(0).max(100),
    critical: false,
  },
  "referral.max_discount_cap": {
    group: "marketing",
    type: ConfigValueType.NUMBER,
    schema: z.number().min(0).max(10_000),
    critical: false,
  },
  "rating.attention_threshold": {
    group: "safety",
    type: ConfigValueType.NUMBER,
    schema: z.number().int().min(1).max(5),
    critical: false,
  },
} as const;

const prohibitedKey =
  /(secret|password|token|credential|api[_-]?key|redis|aws|razorpay)/i;

export class AdminConfigService {
  async list(group?: string) {
    const settings = await prisma.systemSetting.findMany({
      where: { group },
      orderBy: [{ group: "asc" }, { key: "asc" }],
    });
    const byKey = new Map(settings.map((setting) => [setting.key, setting]));
    const defaultSettings = Object.entries(definitions)
      .filter(([, definition]) => !group || definition.group === group)
      .filter(([key]) => !byKey.has(key))
      .map(([key, definition]) =>
        this.safe({
          id: null,
          key,
          group: definition.group,
          value: "defaultValue" in definition ? definition.defaultValue : null,
          valueType: definition.type,
          description: null,
          isPublic: false,
          updatedByAdminId: null,
          createdAt: null,
          updatedAt: null,
          isDefault: true,
        }),
      );

    return [
      ...settings.map((setting) => this.safe(setting)),
      ...defaultSettings,
    ].sort((a, b) =>
      `${a.group}.${a.key}`.localeCompare(`${b.group}.${b.key}`),
    );
  }

  async get(key: string) {
    this.assertSafeKey(key);
    const cached = await redis.get(this.cacheKey(key));
    if (cached) return JSON.parse(cached);
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    if (!setting) throw errors.notFound("Platform configuration not found");
    const safe = this.safe(setting);
    await redis.set(
      this.cacheKey(key),
      JSON.stringify(safe),
      "EX",
      env.CONFIG_CACHE_TTL_SECONDS,
    );
    return safe;
  }

  async update(
    key: string,
    value: unknown,
    reason: string,
    actor: AdminActionContext,
    isSuperAdmin: boolean,
  ) {
    this.assertSafeKey(key);
    const definition = definitions[key as keyof typeof definitions];
    if (!definition)
      throw errors.badRequest("Configuration key is not managed");
    if (definition.critical && !isSuperAdmin) {
      throw errors.forbidden("Critical configuration requires super-admin");
    }
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw errors.badRequest(
        "Configuration value is invalid",
        parsed.error.flatten(),
      );
    }
    const next = parsed.data as Prisma.InputJsonValue;
    const setting = await prisma.$transaction(async (tx) => {
      const current = await tx.systemSetting.findUnique({ where: { key } });
      const updated = await tx.systemSetting.upsert({
        where: { key },
        update: {
          value: next,
          group: definition.group,
          valueType: definition.type,
          updatedByAdminId: actor.adminId,
        },
        create: {
          key,
          value: next,
          group: definition.group,
          valueType: definition.type,
          updatedByAdminId: actor.adminId,
        },
      });
      await tx.systemSettingHistory.create({
        data: {
          settingId: updated.id,
          adminId: actor.adminId,
          previous: current?.value ?? Prisma.JsonNull,
          next,
          reason,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "ADMIN_PLATFORM_CONFIG_UPDATED",
          entityType: "SystemSetting",
          entityId: updated.id,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          reason,
          before: current ? { value: current.value } : undefined,
          after: { value: next },
        },
      });
      return updated;
    });
    await redis.del(this.cacheKey(key));
    return this.safe(setting);
  }

  history(page: number, limit: number, key?: string) {
    const where = key ? { setting: { key } } : {};
    return prisma.$transaction([
      prisma.systemSettingHistory.findMany({
        where,
        include: {
          setting: { select: { key: true, group: true, valueType: true } },
          admin: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.systemSettingHistory.count({ where }),
    ]);
  }

  async setMaintenanceMode(
    input: { enabled: boolean; message?: string; reason: string },
    actor: AdminActionContext,
    isSuperAdmin: boolean,
  ) {
    await this.update(
      "maintenance.enabled",
      input.enabled,
      input.reason,
      actor,
      isSuperAdmin,
    );
    if (input.message !== undefined) {
      await this.update(
        "maintenance.message",
        input.message,
        input.reason,
        actor,
        isSuperAdmin,
      );
    }
    return {
      enabled: input.enabled,
      message: input.message,
    };
  }

  private assertSafeKey(key: string) {
    if (prohibitedKey.test(key)) {
      throw errors.badRequest("Secret configuration keys are prohibited");
    }
  }

  private safe<T extends { value: unknown }>(setting: T) {
    return setting;
  }

  private cacheKey(key: string) {
    return `config:${key}`;
  }
}
