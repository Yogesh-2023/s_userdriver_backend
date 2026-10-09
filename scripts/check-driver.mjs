import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({
    where: { phone: { contains: '8855226699' } },
    include: {
      driverProfile: {
        include: {
          vehicleAssignments: { include: { vehicle: true } },
          currentBookings: true,
          dispatchOffers: true
        }
      }
    }
  });
  console.log(JSON.stringify(users, null, 2));
}
check().catch(console.error).finally(() => prisma.$disconnect());
