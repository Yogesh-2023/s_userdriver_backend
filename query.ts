import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const cats = await prisma.vehicleCategory.findMany();
  console.log(cats);
  
  const drivers = await prisma.driverProfile.findMany({ include: { vehicles: true, vehicleAssignments: { include: { vehicle: true } } } });
  console.log(drivers);
}
main().catch(console.error).finally(() => prisma.$disconnect());
