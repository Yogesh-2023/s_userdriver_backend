import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const admins = await prisma.user.findMany({
    where: {
      roles: {
        some: {
          role: {
            name: { in: ['ADMIN', 'SUPER_ADMIN'] }
          }
        }
      }
    },
    include: {
      adminProfile: {
        include: {
          credential: true
        }
      },
      roles: {
        include: { role: true }
      }
    }
  });

  console.dir(admins, { depth: null });
}

main().catch(console.error).finally(() => prisma.$disconnect());
