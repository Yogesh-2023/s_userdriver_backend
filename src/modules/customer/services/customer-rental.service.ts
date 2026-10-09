import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class CustomerRentalService {
  async getPackages(categoryId?: string) {
    return prisma.rentalPackage.findMany({
      where: {
        isActive: true,
        ...(categoryId ? { vehicleCategoryId: categoryId } : {}),
      },
      orderBy: { hours: "asc" },
      include: {
        vehicleCategory: {
          select: { name: true, imageUrl: true },
        },
      },
    });
  }

  async getOutstationPricing(categoryId?: string) {
    return prisma.outstationPricing.findMany({
      where: {
        isActive: true,
        ...(categoryId ? { vehicleCategoryId: categoryId } : {}),
      },
      include: {
        vehicleCategory: {
          select: { name: true, imageUrl: true },
        },
      },
    });
  }
}

export const customerRentalService = new CustomerRentalService();
