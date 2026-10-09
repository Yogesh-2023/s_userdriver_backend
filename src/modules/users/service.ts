import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";

export class UsersService {
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        displayName: true,
        status: true,
        phoneVerifiedAt: true,
        createdAt: true,
        customerProfile: true,
        driverProfile: true,
        adminProfile: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) throw errors.notFound("User not found");
    return user;
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string; email?: string | null },
  ) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: input,
        select: {
          id: true,
          phone: true,
          displayName: true,
          email: true,
          updatedAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "PROFILE_UPDATED",
          entityType: "User",
          entityId: userId,
        },
      });
      return user;
    });
  }
}
