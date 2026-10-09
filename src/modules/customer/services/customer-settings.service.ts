import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class CustomerSettingsService {
  private async getCustomer(userId: string) {
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw errors.notFound("Customer profile not found");
    return customer;
  }

  async get(userId: string) {
    const customer = await this.getCustomer(userId);
    let preferences = await prisma.customerPreference.findUnique({
      where: { customerId: customer.id },
    });
    if (!preferences) {
      preferences = await prisma.customerPreference.create({
        data: { customerId: customer.id },
      });
    }
    return preferences;
  }

  async update(userId: string, data: any) {
    const customer = await this.getCustomer(userId);
    return prisma.customerPreference.upsert({
      where: { customerId: customer.id },
      create: { customerId: customer.id, ...data },
      update: data,
    });
  }
}
