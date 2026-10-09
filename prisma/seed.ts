import { PrismaClient, RideType, type Prisma } from "@prisma/client";
import { hashPassword } from "../src/common/password";
import { ADMIN_PERMISSIONS } from "../src/modules/admin/admin.constants";

const prisma = new PrismaClient();

const rolePermissions: Record<string, string[]> = {
  CUSTOMER: [
    "booking:create",
    "booking:read-own",
    "booking:cancel-own",
    "payment:create",
    "rating:create",
    "sos:create",
  ],
  DRIVER: [
    "dispatch:respond",
    "trip:update-assigned",
    "tracking:publish-own",
    "rating:create",
    "sos:create",
  ],
  ADMIN: [...ADMIN_PERMISSIONS],
  SUPER_ADMIN: [...ADMIN_PERMISSIONS],
};



async function seedAccessControl(): Promise<void> {
  for (const [roleName, permissionKeys] of Object.entries(rolePermissions)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, isSystem: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const key of permissionKeys) {
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}

async function main(): Promise<void> {
  await seedAccessControl();
  const adminPhone = process.env.SEED_ADMIN_PHONE;
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminPasswordMinLength = 8;
  if (adminPhone || adminEmail || adminPassword) {
    if (!adminPhone || !adminEmail || !adminPassword) {
      throw new Error(
        "SEED_ADMIN_PHONE, SEED_ADMIN_EMAIL, and SEED_ADMIN_PASSWORD must all be provided",
      );
    }
    if (
      adminPassword.length < adminPasswordMinLength ||
      adminPassword.length > 128
    ) {
      throw new Error(
        `SEED_ADMIN_PASSWORD must be between ${adminPasswordMinLength} and 128 characters`,
      );
    }
    const roleName = process.env.SEED_ADMIN_ROLE ?? "SUPER_ADMIN";
    if (!["ADMIN", "SUPER_ADMIN"].includes(roleName)) {
      throw new Error("SEED_ADMIN_ROLE must be ADMIN or SUPER_ADMIN");
    }
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: roleName },
    });
    const adminRoles = await prisma.role.findMany({
      where: { name: { in: ["ADMIN", "SUPER_ADMIN"] } },
      select: { id: true },
    });
    const admin = await prisma.user.upsert({
      where: { phone: adminPhone },
      update: { email: adminEmail, phoneVerifiedAt: new Date() },
      create: {
        phone: adminPhone,
        email: adminEmail,
        phoneVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.deleteMany({
      where: {
        userId: admin.id,
        roleId: { in: adminRoles.map(({ id }) => id) },
      },
    });
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: role.id },
    });
    const profile = await prisma.adminProfile.upsert({
      where: { userId: admin.id },
      update: {},
      create: { userId: admin.id, title: "Platform Administrator" },
    });
    const passwordHash = await hashPassword(adminPassword);
    await prisma.adminCredential.upsert({
      where: { adminId: profile.id },
      update: { passwordHash },
      create: { adminId: profile.id, passwordHash },
    });
  }
  await prisma.systemSetting.upsert({
    where: { key: "platform.currency" },
    update: {},
    create: {
      key: "platform.currency",
      group: "general",
      value: "INR" as Prisma.InputJsonValue,
      valueType: "STRING",
      description: "Default platform currency",
      isPublic: true,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    process.exitCode = 1;
    await prisma.$disconnect();
    throw error;
  });
