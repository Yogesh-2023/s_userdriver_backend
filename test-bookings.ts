import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const bookings = await prisma.booking.findMany({
    take: 1,
    include: {
      assignedDriver: { include: { user: true } },
      assignedVehicle: true,
      vehicleCategory: true,
      payments: true,
      fareBreakdowns: true,
      trip: { include: { fareBreakdown: true } }
    }
  });
  console.dir(bookings, { depth: null });
}

main().catch(console.error).finally(() => prisma.$disconnect());
