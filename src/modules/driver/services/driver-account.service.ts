import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class DriverAccountService {
  async getRestrictions(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        driverProfile: {
          select: { verificationStatus: true, availability: true },
        },
      },
    });
    if (!user) throw errors.notFound("User not found");

    const restrictions = [];
    if (user.status !== "ACTIVE") restrictions.push(`ACCOUNT_${user.status}`);
    if (user.driverProfile?.verificationStatus !== "VERIFIED")
      restrictions.push(`KYC_${user.driverProfile?.verificationStatus}`);

    return { restrictions };
  }

  async requestDataExport(_userId: string) {
    // In a real scenario, this enqueues a BullMQ job
    return {
      status: "PROCESSING",
      message:
        "Data export request received. You will be notified when it is ready.",
    };
  }

  async requestAccountDeletion(userId: string) {
    // Check if active trips exist
    const driver = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!driver) throw errors.notFound("Driver not found");

    const activeTrips = await prisma.trip.findFirst({
      where: {
        driverId: driver.id,
        status: {
          in: ["CREATED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "STARTED"],
        },
      },
    });
    if (activeTrips)
      throw errors.conflict("Cannot delete account with active trips");

    const activeWallet = await prisma.driverWallet.findUnique({
      where: { driverId: driver.id },
    });
    if (activeWallet && Number(activeWallet.balance) > 0) {
      throw errors.conflict(
        "Cannot delete account with pending wallet balance",
      );
    }

    // In a real scenario, we might enqueue a job here or mark for deletion
    await prisma.user.update({
      where: { id: userId },
      data: { status: "DELETED" },
    });

    return {
      status: "DELETED",
      message: "Account deletion requested successfully",
    };
  }
}
