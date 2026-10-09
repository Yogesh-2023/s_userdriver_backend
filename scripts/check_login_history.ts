import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const history = await prisma.loginHistory.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  console.dir(history, { depth: null });
}

main().catch(console.error).finally(() => prisma.$disconnect());
