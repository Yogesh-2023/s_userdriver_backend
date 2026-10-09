import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const activeBookings = await prisma.booking.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: { vehicleCategory: true }
  });
  console.log(JSON.stringify(activeBookings.map(b => ({ id: b.id, category: b.vehicleCategory.name, status: b.status })), null, 2));

  const driver = await prisma.user.findFirst({
    where: { phone: { contains: '8855226699' } },
    include: {
      driverProfile: {
        include: {
          vehicleAssignments: { include: { vehicle: { include: { category: true } } } },
          vehicles: { include: { category: true } }
        }
      }
    }
  });
  if (driver) {
    console.log("DRIVER CATEGORY:", driver.driverProfile.vehicles[0]?.category?.name);
  }
}
check().catch(console.error).finally(() => prisma.$disconnect());
