import { prisma } from "../../database/prisma";

export const DEFAULT_SUPPORT_CATEGORIES = [
  {
    code: "GENERAL",
    name: "General",
    description: "General queries, feedback and other requests",
  },
  {
    code: "PAYMENT",
    name: "Payment Issue",
    description: "Billing, refunds, wallet and payment failures",
  },
  {
    code: "RIDE_ISSUE",
    name: "Ride Issue",
    description: "Problems faced during a ride or trip",
  },
  {
    code: "TECHNICAL",
    name: "Technical Issue",
    description: "App crashes, errors and technical problems",
  },
  {
    code: "OTHER",
    name: "Other",
    description: "Anything that does not fit another category",
  },
] as const;

/**
 * Idempotently ensures the default support categories exist. Categories are
 * seeded without an admin owner so tickets can be raised before any admin
 * configures categories.
 */
export const ensureSupportCategories = async (): Promise<void> => {
  const admin = await prisma.adminProfile.findFirst({ select: { id: true } });
  const createdByAdminId = admin?.id ?? null;

  for (const category of DEFAULT_SUPPORT_CATEGORIES) {
    await prisma.supportCategory.upsert({
      where: { code: category.code },
      update: {
        name: category.name,
        description: category.description,
        isActive: true,
      },
      create: {
        code: category.code,
        name: category.name,
        description: category.description,
        createdByAdminId,
      },
    });
  }
};
