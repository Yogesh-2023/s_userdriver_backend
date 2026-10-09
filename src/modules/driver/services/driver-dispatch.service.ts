import { prisma } from "../../../database/prisma";
import { DispatchService } from "../../dispatch/service";

const dispatchService = new DispatchService();

export class DriverDispatchService {
  async getActiveRequest(driverId: string) {
    return prisma.dispatchOffer.findFirst({
      where: {
        driverId,
        status: "OFFERED",
        expiresAt: { gt: new Date() },
      },
      include: {
        booking: {
          select: {
            pickupAddress: true,
            pickupLatitude: true,
            pickupLongitude: true,
            dropAddress: true,
            dropLatitude: true,
            dropLongitude: true,
            estimatedFare: true,
          },
        },
      },
    });
  }

  async acceptRide(userId: string, bookingId: string, requestId: string) {
    console.log(`\n[YOGESH][DRIVER-APP] 🟢 DRIVER ACCEPTED RIDE`);
    console.log(`driverId : ${userId}`);
    console.log(`bookingId: ${bookingId}`);
    console.log(`offerId  : ${requestId}\n`);
    return dispatchService.accept(requestId, userId);
  }

  async rejectRide(
    userId: string,
    bookingId: string,
    requestId: string,
    reasonCode?: string,
  ) {
    console.log(`\n[YOGESH][DRIVER-APP] 🔴 DRIVER REJECTED RIDE`);
    console.log(`driverId : ${userId}`);
    console.log(`bookingId: ${bookingId}`);
    console.log(`offerId  : ${requestId}`);
    console.log(`reason   : ${reasonCode ?? 'N/A'}\n`);
    return dispatchService.reject(requestId, userId, reasonCode);
  }

  async cancelAssignedRide(userId: string, bookingId: string, reason?: string) {
    return dispatchService.driverCancel(bookingId, userId, reason);
  }
}
