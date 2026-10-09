import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { SafetyService } from "../../safety/service";

export class CustomerSafetyService {
  private readonly safety = new SafetyService();

  async createSos(
    userId: string,
    input: {
      bookingId: string;
      latitude: number;
      longitude: number;
      message?: string;
    },
  ) {
    // Delegate to the unified SafetyService which validates ownership and
    // triggers admin safety alerts, requester-type detection and notifications.
    return this.safety.createSos(userId, input);
  }

  async getSos(userId: string, sosId: string) {
    return this.safety.getSosForRequester(userId, sosId);
  }

  async listSos(userId: string, page: number, limit: number) {
    return this.safety.listForRequester(userId, page, limit);
  }

  async activeSos(userId: string) {
    return this.safety.activeForRequester(userId);
  }

  async getMessages(userId: string, sosId: string) {
    return this.safety.getMessages(userId, sosId);
  }

  async createSosMessage(
    userId: string,
    sosId: string,
    input: { message: string },
  ) {
    return this.safety.createSosMessage(userId, sosId, input);
  }

  async markMessagesRead(userId: string, sosId: string) {
    return this.safety.markMessagesRead(userId, sosId);
  }

  async cancelSos(userId: string, sosId: string) {
    return this.safety.cancelSos(userId, sosId);
  }

  async reportIncident(
    userId: string,
    input: { bookingId: string; type: string; description: string },
  ) {
    // Validate booking ownership
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      include: { customer: true },
    });
    if (!booking || booking.customer.userId !== userId) {
      throw errors.forbidden("Booking access denied");
    }

    return prisma.safetyIncident.create({
      data: {
        bookingId: input.bookingId,
        reportedByUserId: userId,
        type: input.type,
        description: input.description,
        status: "OPEN",
      },
    });
  }

  async listEmergencyContacts(userId: string) {
    return prisma.emergencyContact.findMany({
      where: { ownerUserId: userId },
    });
  }

  async createEmergencyContact(
    userId: string,
    input: { name: string; phone: string; relationship?: string },
  ) {
    try {
      return await prisma.emergencyContact.create({
        data: { ownerUserId: userId, ...input },
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        throw errors.conflict(
          "This phone number is already registered as an emergency contact",
        );
      }
      throw error;
    }
  }

  async updateEmergencyContact(
    userId: string,
    contactId: string,
    input: { name?: string; phone?: string; relationship?: string },
  ) {
    const contact = await prisma.emergencyContact.findFirst({
      where: { id: contactId, ownerUserId: userId },
    });
    if (!contact) throw errors.notFound("Emergency contact not found");

    return prisma.emergencyContact.update({
      where: { id: contactId },
      data: input,
    });
  }

  async deleteEmergencyContact(userId: string, contactId: string) {
    const contact = await prisma.emergencyContact.findFirst({
      where: { id: contactId, ownerUserId: userId },
    });
    if (!contact) throw errors.notFound("Emergency contact not found");

    await prisma.emergencyContact.delete({
      where: { id: contactId },
    });

    return { success: true };
  }
}