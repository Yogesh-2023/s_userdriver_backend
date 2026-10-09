import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class AdminDispatchService {
  private defaultDispatchRules() {
    return [
      {
        id: "standard",
        name: "Standard Dispatch Rule",
        searchRadiusKm: 5,
        maxDriversToPing: 3,
        pingTimeoutSeconds: 30,
        priorityCriteria: "DISTANCE",
        isActive: true,
      },
    ];
  }

  private defaultCancellationRules() {
    return [
      {
        id: "customer-standard",
        userType: "CUSTOMER",
        freeCancellationMinutes: 5,
        cancellationFee: 0,
        description: "Customer free cancellation window",
        isActive: true,
      },
      {
        id: "driver-standard",
        userType: "DRIVER",
        freeCancellationMinutes: 0,
        cancellationFee: 0,
        description: "Driver cancellation review policy",
        isActive: true,
      },
    ];
  }

  private async getJsonSetting<T>(key: string, fallback: T): Promise<T> {
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    return (setting?.value as T | undefined) ?? fallback;
  }

  private async setJsonSetting<T>(
    key: string,
    group: string,
    value: T,
    adminId: string,
  ) {
    return prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as any, updatedByAdminId: adminId },
      create: {
        key,
        group,
        value: value as any,
        valueType: "JSON",
        updatedByAdminId: adminId,
      },
    });
  }

  async getSettings() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "dispatch_settings" },
    });
    if (!setting) {
      return {
        radiusMeters: 5000,
        maxAttempts: 3,
        timeoutSeconds: 30,
      };
    }
    return setting.value;
  }

  async updateSettings(data: any, adminId: string) {
    const previous = await this.getSettings();
    const setting = await prisma.systemSetting.upsert({
      where: { key: "dispatch_settings" },
      update: {
        value: data,
        updatedByAdminId: adminId,
      },
      create: {
        key: "dispatch_settings",
        group: "dispatch",
        value: data,
        valueType: "JSON",
        updatedByAdminId: adminId,
      },
    });

    await prisma.systemSettingHistory.create({
      data: {
        settingId: setting.id,
        adminId,
        previous: previous as any,
        next: data,
        reason: "Admin updated dispatch settings",
      },
    });

    return setting.value;
  }

  async overrideZoneSettings(zoneId: string, overrides: any) {
    // This could update a ServiceZone specific dispatch configuration
    throw errors.badRequest("Zone override not fully implemented");
  }

  async listRules(page: number, limit: number) {
    const rules = await this.getJsonSetting(
      "dispatch_rules",
      this.defaultDispatchRules(),
    );
    return {
      items: rules.slice((page - 1) * limit, page * limit),
      total: rules.length,
    };
  }

  async getRule(ruleId: string) {
    const rules = await this.getJsonSetting(
      "dispatch_rules",
      this.defaultDispatchRules(),
    );
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) throw errors.notFound("Dispatch rule not found");
    return rule;
  }

  async createRule(data: any, adminId: string) {
    const rules = await this.getJsonSetting(
      "dispatch_rules",
      this.defaultDispatchRules(),
    );
    const rule = { id: randomUUID(), isActive: true, ...data };
    await this.setJsonSetting(
      "dispatch_rules",
      "dispatch",
      [...rules, rule],
      adminId,
    );
    return rule;
  }

  async updateRule(ruleId: string, data: any, adminId: string) {
    const rules = await this.getJsonSetting(
      "dispatch_rules",
      this.defaultDispatchRules(),
    );
    const index = rules.findIndex((item) => item.id === ruleId);
    if (index < 0) throw errors.notFound("Dispatch rule not found");
    const next = rules.map((item) =>
      item.id === ruleId ? { ...item, ...data, id: ruleId } : item,
    );
    await this.setJsonSetting("dispatch_rules", "dispatch", next, adminId);
    return next[index];
  }

  async deleteRule(ruleId: string, adminId: string) {
    const rules = await this.getJsonSetting(
      "dispatch_rules",
      this.defaultDispatchRules(),
    );
    const next = rules.filter((item) => item.id !== ruleId);
    if (next.length === rules.length)
      throw errors.notFound("Dispatch rule not found");
    await this.setJsonSetting("dispatch_rules", "dispatch", next, adminId);
    return { id: ruleId, deleted: true };
  }

  async listCancellationRules() {
    return this.getJsonSetting(
      "cancellation_rules",
      this.defaultCancellationRules(),
    );
  }

  async getCancellationRule(ruleId: string) {
    const rules = await this.listCancellationRules();
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) throw errors.notFound("Cancellation rule not found");
    return rule;
  }

  async createCancellationRule(data: any, adminId: string) {
    const rules = await this.listCancellationRules();
    const rule = { id: randomUUID(), isActive: true, ...data };
    await this.setJsonSetting(
      "cancellation_rules",
      "dispatch",
      [...rules, rule],
      adminId,
    );
    return rule;
  }

  async updateCancellationRule(ruleId: string, data: any, adminId: string) {
    const rules = await this.listCancellationRules();
    const index = rules.findIndex((item) => item.id === ruleId);
    if (index < 0) throw errors.notFound("Cancellation rule not found");
    const next = rules.map((item) =>
      item.id === ruleId ? { ...item, ...data, id: ruleId } : item,
    );
    await this.setJsonSetting("cancellation_rules", "dispatch", next, adminId);
    return next[index];
  }

  async deleteCancellationRule(ruleId: string, adminId: string) {
    const rules = await this.listCancellationRules();
    const next = rules.filter((item) => item.id !== ruleId);
    if (next.length === rules.length)
      throw errors.notFound("Cancellation rule not found");
    await this.setJsonSetting("cancellation_rules", "dispatch", next, adminId);
    return { id: ruleId, deleted: true };
  }

  async getLogs(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const [items, total] = await prisma.$transaction([
      prisma.dispatchOffer.findMany({
        include: {
          driver: {
            include: {
              user: {
                select: { id: true, displayName: true, phone: true },
              },
            },
          },
          booking: {
            select: { id: true, status: true, customerId: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.dispatchOffer.count(),
    ]);

    return { items, total };
  }
}
