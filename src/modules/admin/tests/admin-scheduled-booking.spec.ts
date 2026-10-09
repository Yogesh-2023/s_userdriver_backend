import { AdminBookingService } from "../services/admin-booking.service";
import { AdminCustomerService } from "../services/admin-customer.service";
import { prisma } from "../../../database/prisma";

const service = new AdminBookingService();
const customerService = new AdminCustomerService();

const scheduledFindMany = () =>
  prisma.scheduledBooking.findMany as unknown as jest.Mock;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();

  jest
    .spyOn(prisma.scheduledBooking, "findMany")
    .mockResolvedValue([] as never);
  jest.spyOn(prisma.scheduledBooking, "count").mockResolvedValue(0);
  jest
    .spyOn(prisma, "$transaction")
    .mockImplementation(((ops: Promise<unknown>[]) =>
      Promise.all(ops)) as never);
});

describe("AdminBookingService.listScheduled", () => {
  it("filters by booking status", async () => {
    await service.listScheduled({ page: 1, limit: 10, status: "PENDING" });
    const where = scheduledFindMany().mock.calls[0][0].where;
    expect(where.booking.status).toBe("PENDING");
  });

  it("filters by customerId", async () => {
    await service.listScheduled({ page: 1, limit: 10, customerId: "cust-1" });
    expect(scheduledFindMany().mock.calls[0][0].where.booking.customerId).toBe(
      "cust-1",
    );
  });

  it("filters by driver and vehicle via booking assignment OR", async () => {
    await service.listScheduled({
      page: 1,
      limit: 10,
      driverId: "drv-1",
      vehicleId: "veh-1",
    });
    const where = scheduledFindMany().mock.calls[0][0].where;
    expect(where.booking.OR).toEqual([
      { assignedDriverId: "drv-1" },
      { assignedVehicleId: "veh-1" },
    ]);
  });

  it("combines search with driver filter", async () => {
    await service.listScheduled({
      page: 1,
      limit: 10,
      driverId: "drv-1",
      search: "rahul",
    });
    const where = scheduledFindMany().mock.calls[0][0].where;
    expect(where.booking.OR).toEqual([{ assignedDriverId: "drv-1" }]);
    expect(where.booking.AND).toEqual([
      {
        OR: [
          { pickupAddress: { contains: "rahul", mode: "insensitive" } },
          { dropAddress: { contains: "rahul", mode: "insensitive" } },
          {
            customer: {
              user: {
                OR: [
                  { displayName: { contains: "rahul", mode: "insensitive" } },
                  { phone: { contains: "rahul" } },
                ],
              },
            },
          },
        ],
      },
    ]);
  });

  it("adds uuid equality to search when the value is a booking id", async () => {
    await service.listScheduled({
      page: 1,
      limit: 10,
      search: "7a0b3c4d-1111-4222-8333-444455556666",
    });
    const where = scheduledFindMany().mock.calls[0][0].where;
    expect(where.booking.AND[0].OR).toContainEqual({
      id: "7a0b3c4d-1111-4222-8333-444455556666",
    });
  });

  it("filters by scheduledAt window when from/to provided", async () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-30T23:59:59.999Z");
    await service.listScheduled({ page: 1, limit: 10, from, to });
    expect(scheduledFindMany().mock.calls[0][0].where.scheduledAt).toEqual({
      gte: from,
      lte: to,
    });
  });

  it("paginates with skip/take", async () => {
    await service.listScheduled({ page: 3, limit: 25 });
    expect(scheduledFindMany().mock.calls[0][0]).toMatchObject({
      skip: 50,
      take: 25,
    });
  });
});

describe("AdminCustomerService.getAddresses", () => {
  it("excludes soft-deleted addresses and orders default first", async () => {
    jest
      .spyOn(prisma.customerAddress, "findMany")
      .mockResolvedValue([] as never);
    await customerService.getAddresses("cust-1");
    expect(prisma.customerAddress.findMany).toHaveBeenCalledWith({
      where: { customerId: "cust-1", isDeleted: false },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
  });
});
