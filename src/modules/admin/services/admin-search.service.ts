import { prisma } from "../../../database/prisma";

export class AdminSearchService {
  async globalSearch(query: string, limit: number = 5) {
    if (!query || query.trim().length < 2) {
      return {
        customers: [],
        drivers: [],
        bookings: [],
        vehicles: [],
        tickets: [],
      };
    }

    const searchTerm = query.trim();

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        searchTerm,
      );

    // Run parallel searches across major entities
    const [customers, drivers, bookings, vehicles, tickets] = await Promise.all(
      [
        prisma.user.findMany({
          where: {
            customerProfile: { isNot: null },
            OR: [
              { displayName: { contains: searchTerm, mode: "insensitive" } },
              { email: { contains: searchTerm, mode: "insensitive" } },
              { phone: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            displayName: true,
            email: true,
            phone: true,
            customerProfile: { select: { id: true } },
          },
          take: limit,
        }),

        prisma.user.findMany({
          where: {
            driverProfile: { isNot: null },
            OR: [
              { displayName: { contains: searchTerm, mode: "insensitive" } },
              { email: { contains: searchTerm, mode: "insensitive" } },
              { phone: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            displayName: true,
            email: true,
            phone: true,
            driverProfile: { select: { id: true } },
          },
          take: limit,
        }),

        prisma.booking.findMany({
          where: isUuid
            ? { id: searchTerm }
            : { pickupAddress: { contains: searchTerm, mode: "insensitive" } },
          take: limit,
        }),

        prisma.vehicle.findMany({
          where: {
            registrationNo: { contains: searchTerm, mode: "insensitive" },
          },
          take: limit,
        }),

        prisma.supportTicket.findMany({
          where: isUuid
            ? { id: searchTerm }
            : { subject: { contains: searchTerm, mode: "insensitive" } },
          take: limit,
        }),
      ],
    );

    return {
      customers,
      drivers,
      bookings,
      vehicles,
      tickets,
    };
  }
}
