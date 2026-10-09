import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const indiaPolygon = {
    type: "Polygon",
    coordinates: [
      [
        [68.1114, 6.5546],
        [97.3956, 6.5546],
        [97.3956, 35.6745],
        [68.1114, 35.6745],
        [68.1114, 6.5546],
      ],
    ],
  };

  const area = await prisma.serviceArea.upsert({
    where: { name: "All Over India" },
    update: {
      isActive: true,
      boundaryPolygon: indiaPolygon,
    },
    create: {
      name: "All Over India",
      city: "Pan India",
      state: "Pan India",
      country: "India",
      timezone: "Asia/Kolkata",
      centerLatitude: 20.5937,
      centerLongitude: 78.9629,
      boundaryPolygon: indiaPolygon,
      isActive: true,
    },
  });

  console.log(
    `Successfully created/updated "All Over India" Service Area with ID: ${area.id}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
