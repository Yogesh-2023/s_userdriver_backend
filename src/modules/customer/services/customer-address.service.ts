import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { CUSTOMER_LIMITS } from "../customer.constants";

export class CustomerAddressService {
  private async getCustomer(userId: string) {
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw errors.notFound("Customer profile not found");
    return customer;
  }

  async list(userId: string) {
    const customer = await this.getCustomer(userId);
    return prisma.customerAddress.findMany({
      where: { customerId: customer.id, isDeleted: false },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
  }

  async create(userId: string, data: any) {
    const customer = await this.getCustomer(userId);

    return prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId: customer.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      // Check if this is the first address, make it default if so
      const count = await tx.customerAddress.count({
        where: { customerId: customer.id, isDeleted: false },
      });
      const isDefault = count === 0 ? true : data.isDefault;

      return tx.customerAddress.create({
        data: {
          customerId: customer.id,
          ...data,
          isDefault,
        },
      });
    });
  }

  async get(userId: string, addressId: string) {
    const customer = await this.getCustomer(userId);
    const address = await prisma.customerAddress.findUnique({
      where: { id: addressId },
    });
    if (!address || address.isDeleted || address.customerId !== customer.id) {
      throw errors.notFound("Address not found");
    }
    return address;
  }

  async update(userId: string, addressId: string, data: any) {
    const address = await this.get(userId, addressId);

    return prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId: address.customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.update({
        where: { id: addressId },
        data,
      });
    });
  }

  async delete(userId: string, addressId: string) {
    const address = await this.get(userId, addressId);

    await prisma.$transaction(async (tx) => {
      await tx.customerAddress.update({
        where: { id: addressId },
        data: { isDeleted: true, isDefault: false },
      });

      // If we deleted the default address, set another active address as default
      if (address.isDefault) {
        const nextDefault = await tx.customerAddress.findFirst({
          where: { customerId: address.customerId, isDeleted: false },
          orderBy: { createdAt: "desc" },
        });
        if (nextDefault) {
          await tx.customerAddress.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }
    });

    return { success: true };
  }

  async setDefault(userId: string, addressId: string) {
    const address = await this.get(userId, addressId);

    let updatedAddress;
    await prisma.$transaction(async (tx) => {
      await tx.customerAddress.updateMany({
        where: { customerId: address.customerId, isDefault: true },
        data: { isDefault: false },
      });
      updatedAddress = await tx.customerAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });

    return updatedAddress;
  }

  async recent(userId: string) {
    const customer = await this.getCustomer(userId);
    const bookings = await prisma.booking.findMany({
      where: { customerId: customer.id, status: "TRIP_COMPLETED" },
      select: {
        pickupAddress: true,
        pickupLatitude: true,
        pickupLongitude: true,
        dropAddress: true,
        dropLatitude: true,
        dropLongitude: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const uniqueList: Array<{
      addressLine: string;
      latitude: number;
      longitude: number;
    }> = [];
    const seenAddresses = new Set<string>();

    for (const b of bookings) {
      // Process pickup
      const pickupNormalized = b.pickupAddress.trim().toLowerCase();
      if (
        !seenAddresses.has(pickupNormalized) &&
        uniqueList.length < CUSTOMER_LIMITS.MAX_RECENT_ADDRESSES
      ) {
        seenAddresses.add(pickupNormalized);
        uniqueList.push({
          addressLine: b.pickupAddress,
          latitude: Number(b.pickupLatitude),
          longitude: Number(b.pickupLongitude),
        });
      }

      // Process drop
      const dropNormalized = b.dropAddress.trim().toLowerCase();
      if (
        !seenAddresses.has(dropNormalized) &&
        uniqueList.length < CUSTOMER_LIMITS.MAX_RECENT_ADDRESSES
      ) {
        seenAddresses.add(dropNormalized);
        uniqueList.push({
          addressLine: b.dropAddress,
          latitude: Number(b.dropLatitude),
          longitude: Number(b.dropLongitude),
        });
      }
    }

    return uniqueList;
  }

  async saveRecentAddress(userId: string, data: any) {
    const customer = await this.getCustomer(userId);
    return prisma.customerAddress.create({
      data: {
        customerId: customer.id,
        label: data.label || "Recent Location",
        addressLine: data.addressLine,
        latitude: data.latitude,
        longitude: data.longitude,
        landmark: data.landmark,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        isDefault: false,
      },
    });
  }
}
