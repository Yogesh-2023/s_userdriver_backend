import { prisma } from "../../database/prisma";

export class VehiclesService {
  async listCategories() {
    const categories = await prisma.vehicleCategory.findMany({
      where: { 
        isActive: true, 
        deletedAt: null
      },
      orderBy: { displayOrder: "asc" },
      include: {
        pricingRules: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    return categories.map((cat) => {
      const pricing = cat.pricingRules[0];
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        iconUrl: cat.iconUrl ?? cat.imageUrl,
        imageUrl: cat.imageUrl ?? cat.iconUrl,
        capacity: cat.maxPassengers ?? 4,
        baseFare: pricing ? Number(pricing.baseFare) : 5.0,
        perKmRate: pricing ? Number(pricing.perKilometer) : 12.0,
        perMinuteRate: pricing ? Number(pricing.perMinute) : 2.0,
      };
    });
  }

  async getOptions() {
    const p = prisma as any;
    let [categories, brands, models, manufacturerYears] = await Promise.all([
      this.listCategories(),
      p.vehicleBrand?.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true },
      }) ?? [],
      p.vehicleModel?.findMany({
        where: {
          isActive: true,
          brand: { isActive: true },
          category: { isActive: true, deletedAt: null },
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          brandId: true,
          categoryId: true,
        },
      }) ?? [],
      p.manufacturerYear?.findMany({
        where: { isActive: true },
        orderBy: { year: "desc" },
        select: { id: true, year: true, modelId: true },
      }) ?? [],
    ]);

    categories = categories.filter((cat) => {
      const name = (cat.name || "").trim().toLowerCase();
      const slug = (cat.slug || "").trim().toLowerCase();
      return name !== "bike" && name !== "auto" && slug !== "bike" && slug !== "auto";
    });

    const firstCatId = categories[0]?.id ?? "0ebd561d-7fc1-4430-9c05-50437d61b47f";

    if (brands.length === 0) {
      brands = [
        { id: "b35f6d3d-f0c1-439f-8916-5fe09e568a67", name: "Hyundai", slug: "hyundai" },
        { id: "b35f6d3d-f0c1-439f-8916-5fe09e568a68", name: "Tata Motors", slug: "tata-motors" },
        { id: "b35f6d3d-f0c1-439f-8916-5fe09e568a69", name: "Mahindra & Mahindra", slug: "mahindra" },
        { id: "b35f6d3d-f0c1-439f-8916-5fe09e568a70", name: "Ashok Leyland", slug: "ashok-leyland" },
      ];
    }

    if (models.length === 0) {
      const firstBrandId = brands[0]?.id ?? "b35f6d3d-f0c1-439f-8916-5fe09e568a67";
      models = [
        {
          id: "91144ab2-2a14-47ec-978d-67a41e6155d9",
          name: "Verna",
          slug: "verna",
          brandId: firstBrandId,
          categoryId: firstCatId,
        },
        {
          id: "91144ab2-2a14-47ec-978d-67a41e6155e0",
          name: "Tata Ace Gold",
          slug: "tata-ace-gold",
          brandId: brands[1]?.id ?? firstBrandId,
          categoryId: firstCatId,
        },
      ];
    }

    if (manufacturerYears.length === 0) {
      const defaultYears = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
      manufacturerYears = defaultYears.map((yr, idx) => ({
        id: `05660829-f134-4bd9-8edc-fdd27fbd7f0${idx}`,
        year: yr,
      }));
    }

    return {
      categories,
      brands,
      models,
      manufacturerYears,
      years: manufacturerYears.map(({ year }: { year: number }) => year),
    };
  }
}
