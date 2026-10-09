import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/password';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@sawariya.com';
  const newPassword = 'Admin@123';
  const user = await prisma.user.findUnique({
    where: { email },
    include: { adminProfile: true }
  });

  if (!user || !user.adminProfile) {
    console.log('Admin not found!');
    return;
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.adminCredential.update({
    where: { adminId: user.adminProfile.id },
    data: { passwordHash }
  });

  console.log(`Password reset successfully for ${email}`);
  console.log(`New password: ${newPassword}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
