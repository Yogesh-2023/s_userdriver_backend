import { prisma } from "../../database/prisma";

export class AuditLogsService {
  list(input: {
    page: number;
    limit: number;
    actorUserId?: string;
    entityType?: string;
    action?: string;
  }) {
    const where = {
      actorUserId: input.actorUserId,
      entityType: input.entityType,
      action: input.action,
    };
    return prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);
  }
}
