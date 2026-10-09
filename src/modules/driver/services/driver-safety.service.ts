import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { SafetyService } from "../../safety/service";

export class DriverSafetyService {
  private readonly safety = new SafetyService();

  async raiseSos(
    driverId: string,
    data: {
      tripId?: string;
      latitude: number;
      longitude: number;
      message?: string;
    },
  ) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    // Delegate to the unified SafetyService (requester auto-detected as DRIVER).
    return this.safety.createSos(driver.userId, data);
  }

  async getSosDetails(driverId: string, sosId: string) {
    const driver = await this.requireDriver(driverId);
    return this.safety.getSosForRequester(driver.userId, sosId);
  }

  async listSos(driverId: string, page: number, limit: number) {
    const driver = await this.requireDriver(driverId);
    return this.safety.listForRequester(driver.userId, page, limit);
  }

  async activeSos(driverId: string) {
    const driver = await this.requireDriver(driverId);
    return this.safety.activeForRequester(driver.userId);
  }

  async getMessages(driverId: string, sosId: string) {
    const driver = await this.requireDriver(driverId);
    return this.safety.getMessages(driver.userId, sosId);
  }

  async createSosMessage(
    driverId: string,
    sosId: string,
    input: { message: string },
  ) {
    const driver = await this.requireDriver(driverId);
    return this.safety.createSosMessage(driver.userId, sosId, input);
  }

  async markMessagesRead(driverId: string, sosId: string) {
    const driver = await this.requireDriver(driverId);
    return this.safety.markMessagesRead(driver.userId, sosId);
  }

  async cancelSos(driverId: string, sosId: string) {
    const driver = await this.requireDriver(driverId);
    return this.safety.cancelSos(driver.userId, sosId);
  }

  private async requireDriver(driverId: string) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw errors.notFound("Driver profile not found");
    return driver;
  }
}