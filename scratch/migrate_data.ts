import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const categories = await prisma.vehicleCategory.findMany();

  const targetMapping = {
    sedan: "SEDAN",
    suv: "SUV",
    "muv / xl": "SAWARIYAA_XL",
  };

  const targetIds: Record<string, string> = {};
  for (const cat of categories) {
    if (Object.values(targetMapping).includes(cat.name)) {
      targetIds[cat.name] = cat.id;
    }
  }

  const mergeMapping = {
    hatchback: "SEDAN",
    electric: "SEDAN",
    rental: "SEDAN",
    parcel: "BIKE",
    intercity: "SEDAN",
  };

  for (const [oldName, targetName] of Object.entries(mergeMapping)) {
    const cat = categories.find((c) => c.name.toLowerCase() === oldName);
    if (cat) {
      const targetId = targetIds[targetName];
      console.log(`Merging ${cat.name} into ${targetName} (${targetId})`);

      // Update Vehicles
      await prisma.vehicle.updateMany({
        where: { categoryId: cat.id },
        data: { categoryId: targetId },
      });

      // Update Bookings
      await prisma.booking.updateMany({
        where: { vehicleCategoryId: cat.id },
        data: { vehicleCategoryId: targetId },
      });

      // Delete Pricing Rules to avoid unique constraint
      await prisma.pricingRule.deleteMany({
        where: { vehicleCategoryId: cat.id },
      });

      // Delete Surge Pricing Rules
      await prisma.surgePricingRule.deleteMany({
        where: { vehicleCategoryId: cat.id },
      });

      // We should probably delete the old category now
      await prisma.vehicleCategory.delete({
        where: { id: cat.id },
      });
      console.log(`Deleted category ${cat.name}`);
    }
  }

  // Delete any other stray categories not in the 5
  const currentCategories = await prisma.vehicleCategory.findMany();
  const allowedNames = Object.values(targetMapping);
  for (const cat of currentCategories) {
    if (!allowedNames.includes(cat.name)) {
      console.log(`Deleting stray category ${cat.name}`);
      // fallback merge to SEDAN
      await prisma.vehicle.updateMany({
        where: { categoryId: cat.id },
        data: { categoryId: targetIds["SEDAN"] },
      });
      await prisma.booking.updateMany({
        where: { vehicleCategoryId: cat.id },
        data: { vehicleCategoryId: targetIds["SEDAN"] },
      });
      await prisma.pricingRule.deleteMany({
        where: { vehicleCategoryId: cat.id },
      });
      await prisma.surgePricingRule.deleteMany({
        where: { vehicleCategoryId: cat.id },
      });
      await prisma.vehicleCategory.delete({
        where: { id: cat.id },
      });
    }
  }

  console.log("Migration complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
