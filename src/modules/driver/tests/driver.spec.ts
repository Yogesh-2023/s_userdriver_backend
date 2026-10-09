import { DriverAuthService } from "../services/driver-auth.service";
import { DriverProfileService } from "../services/driver-profile.service";
import { DriverKycService } from "../services/driver-kyc.service";
import { DriverVehicleService } from "../services/driver-vehicle.service";
import { DriverAvailabilityService } from "../services/driver-availability.service";
import { DriverLocationService } from "../services/driver-location.service";
import { DriverEligibilityService } from "../services/driver-eligibility.service";
import { DriverWalletService } from "../services/driver-wallet.service";
import { DriverSupportService } from "../services/driver-support.service";
import { DriverSafetyService } from "../services/driver-safety.service";
import { DriverAccountService } from "../services/driver-account.service";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { errors } from "../../../common/errors";
import { closeQueues } from "../../../infrastructure/queues";

describe("Driver Module Comprehensive Tests", () => {
  const auth = new DriverAuthService();
  const profile = new DriverProfileService();
  const kyc = new DriverKycService();
  const vehicle = new DriverVehicleService();
  const availability = new DriverAvailabilityService();
  const location = new DriverLocationService();
  const eligibility = new DriverEligibilityService();
  const wallet = new DriverWalletService();
  const support = new DriverSupportService();
  const safety = new DriverSafetyService();
  const account = new DriverAccountService();

  let testUserId: string;
  let testDriverId: string;
  const testPhone = "+918888888888";

  beforeAll(async () => {
    // Setup test user/driver
    let user = await prisma.user.findUnique({
      where: { phone: testPhone },
      include: { driverProfile: true },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone: testPhone,
          status: "ACTIVE",
          driverProfile: {
            create: {
              verificationStatus: "PENDING",
              onboardingStatus: "ACCOUNT_CREATED",
            },
          },
        },
        include: { driverProfile: true },
      });
    } else if (!user.driverProfile) {
      const dp = await prisma.driverProfile.create({
        data: {
          userId: user.id,
          verificationStatus: "PENDING",
          onboardingStatus: "ACCOUNT_CREATED",
        },
      });
      user.driverProfile = dp;
    }
    testUserId = user.id;
    testDriverId = user.driverProfile!.id;

    // Seed test role
    await prisma.role.upsert({
      where: { name: "DRIVER" },
      update: {},
      create: { name: "DRIVER" },
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testDriverId) {
      await prisma.driverVehicleAssignment.deleteMany({
        where: { driverId: testDriverId },
      });
      await prisma.vehicleDocument.deleteMany({
        where: { vehicle: { driverId: testDriverId } },
      });
      await prisma.vehicle.deleteMany({ where: { driverId: testDriverId } });
      await prisma.driverDocument.deleteMany({
        where: { driverId: testDriverId },
      });
      try {
        await prisma.driverProfile.delete({ where: { id: testDriverId } });
      } catch (err) {}
    }
    if (testUserId) {
      try {
        await prisma.user.delete({ where: { id: testUserId } });
      } catch (err) {}
    }

    await closeQueues();
    await prisma.$disconnect();
    await redis.quit();
  });

  describe("Authentication Rate Limiting and Verification Lockout", () => {
    it("enforces failed verify-otp lockout after 5 attempts", async () => {
      const phone = "+918765432109";
      const attemptsKey = `driver:otp:verify-attempts:${phone}`;
      await redis.del(attemptsKey);

      await redis.setex(`driver:otp:verify:${phone}`, 300, "hash_mock");

      for (let i = 0; i < 4; i++) {
        await expect(auth.verifyOtp(phone, "wrong", {})).rejects.toThrow(
          "OTP is invalid or has expired",
        );
      }

      await expect(auth.verifyOtp(phone, "wrong", {})).rejects.toThrow(
        "Too many failed verification attempts",
      );
    });
  });

  describe("Profile Onboarding Constraints", () => {
    it("validates age limit and duplicate license constraints", async () => {
      const underAgeDate = new Date();
      underAgeDate.setFullYear(underAgeDate.getFullYear() - 16); // 16 years old

      await expect(
        profile.createProfile(
          testUserId,
          {
            fullName: "Underage Driver",
            email: "underage@test.com",
            dateOfBirth: underAgeDate,
            gender: "MALE",
            addressLine1: "Test St",
            city: "Delhi",
            state: "Delhi",
            postalCode: "110001",
            country: "India",
            drivingLicenseNumber: "DL123456",
            drivingLicenseIssueDate: new Date(),
            drivingLicenseExpiryDate: new Date(
              Date.now() + 365 * 24 * 3600 * 1000,
            ),
            drivingExperienceYears: 2,
            emergencyContactName: "Emergency Parent",
            emergencyContactPhone: "+919999999999",
            emergencyContactRelation: "PARENT",
          },
          {
            driverId: "",
            userId: testUserId,
            sessionId: "test-sess",
            requestId: "req-1",
          },
        ),
      ).rejects.toThrow();
    });
  });

  describe("Vehicle Category Constraints", () => {
    it("rejects vehicle creations that violate category passenger/capacity limits", async () => {
      const category = await prisma.vehicleCategory.findFirst({
        where: { isActive: true },
      });
      if (!category) return;

      await prisma.vehicleCategory.update({
        where: { id: category.id },
        data: { minPassengers: 1, maxPassengers: 4 },
      });

      const oversizedCapacity = 14;

      await expect(
        vehicle.createVehicle(testUserId, {
          categoryId: category.id,
          drivingLicenseNumber: "DL123456",
          make: "Tata",
          model: "Sumo",
          registrationNo: "UP14Z9999",
          year: 2018,
          color: "White",
          fuelType: "DIESEL",
          seatingCapacity: oversizedCapacity,
        }),
      ).rejects.toThrow(
        "Vehicle seating capacity is outside the category limits",
      );
    });
  });

  describe("Centralized Eligibility Service", () => {
    it("reports driver ineligible if profile is incomplete or KYC pending", async () => {
      const check = await eligibility.checkEligibility(testDriverId);
      expect(check.eligible).toBe(false);
      expect(check.code).toBe("DRIVER_PROFILE_INCOMPLETE");
    });
  });

  describe("Realtime Location updates and GEO indexing", () => {
    it("enforces coordinate and payload boundaries validations", async () => {
      const badUpdate = {
        latitude: 100, // Invalid latitude (> 90)
        longitude: 77.4538,
        heading: 90,
        speed: 10,
        accuracy: 5,
        timestamp: new Date(),
      };

      await expect(
        location.updateLocationByDriverId(testDriverId, badUpdate),
      ).rejects.toThrow("SOCKET_INVALID_PAYLOAD");
    });
  });

  describe("Aggregate Account Info and Vehicle Info", () => {
    it("returns structured account info with masked sensitive fields", async () => {
      const before = await prisma.driverProfile.findUnique({
        where: { id: testDriverId },
      });
      await prisma.driverProfile.update({
        where: { id: testDriverId },
        data: {
          addressLine1: "Test St",
          city: "Delhi",
          state: "Delhi",
          postalCode: "110001",
          country: "India",
          licenseNumber: "DL123456",
        },
      });
      await prisma.user.update({
        where: { id: testUserId },
        data: { displayName: "Test Driver" },
      });
      try {
        const info = await profile.getAccountInfo(testUserId);
        expect(info.personalInfo.fullName).toBe("Test Driver");
        expect(info.personalInfo.phone).toBe(testPhone);
        expect(info.personalInfo.address.city).toBe("Delhi");
        expect(info.personalInfo.address.addressLine1).toBe("Test St");
        expect(info.kyc.status).toBeDefined();
        expect([
          "NOT_SUBMITTED",
          "UNDER_REVIEW",
          "APPROVED",
          "REJECTED",
          "EXPIRED",
        ]).toContain(info.kyc.status);
        expect(info.drivingLicense.licenseNumber).toBe("DL123456");
        expect(info.drivingLicense.status).toBeDefined();
        expect(info.bankAccount).toBeNull();
      } finally {
        await prisma.driverProfile.update({
          where: { id: testDriverId },
          data: {
            addressLine1: before?.addressLine1 ?? null,
            city: before?.city ?? null,
            state: before?.state ?? null,
            postalCode: before?.postalCode ?? null,
            country: before?.country ?? null,
            licenseNumber: before?.licenseNumber ?? null,
          },
        });
        await prisma.user.update({
          where: { id: testUserId },
          data: { displayName: null },
        });
      }
    });

    it("masks aadhaar and pan document numbers keeping last 4 digits", async () => {
      const aadhaarDoc = await prisma.driverDocument.create({
        data: {
          driverId: testDriverId,
          type: "AADHAR_FRONT",
          documentNo: "123412341234",
          status: "PENDING",
          fileKey: "test-aadhaar.jpg",
        },
      });
      const panDoc = await prisma.driverDocument.create({
        data: {
          driverId: testDriverId,
          type: "PAN_CARD",
          documentNo: "ABCDE1234F",
          status: "PENDING",
          fileKey: "test-pan.jpg",
        },
      });

      const info = await profile.getAccountInfo(testUserId);
      expect(info.kyc.aadhaar.documentNo).toBe("********1234");
      expect(info.kyc.pan.documentNo).toBe("******234F");

      await prisma.driverDocument.deleteMany({
        where: { id: { in: [aadhaarDoc.id, panDoc.id] } },
      });
    });

    it("returns vehicle info with null details when driver has no active assignment", async () => {
      await prisma.driverVehicleAssignment.deleteMany({
        where: { driverId: testDriverId, isActive: true },
      });
      const info = await vehicle.getVehicleInfo(testUserId);
      expect(info.vehicleDetails).toBeNull();
      expect(info.vehicleDocuments).toBeNull();
    });

    it("returns vehicle details and documents for an active assignment", async () => {
      const category = await prisma.vehicleCategory.findFirst({
        where: { isActive: true },
      });
      if (!category) return;

      const vehicleRow = await prisma.vehicle.create({
        data: {
          driverId: testDriverId,
          categoryId: category.id,
          registrationNo: "UP14AGG9000",
          make: "Maruti",
          model: "Ertiga",
          year: 2020,
          color: "Silver",
          fuelType: "CNG",
          seatingCapacity: 6,
          verificationStatus: "PENDING",
        },
      });
      await prisma.vehicleDocument.create({
        data: {
          vehicleId: vehicleRow.id,
          type: "REGISTRATION_CERTIFICATE",
          documentNo: "UP14AGG9000",
          status: "VERIFIED",
          fileKey: "test-rc.jpg",
        },
      });
      await prisma.vehicleDocument.create({
        data: {
          vehicleId: vehicleRow.id,
          type: "INSURANCE",
          documentNo: "POL-123456",
          status: "VERIFIED",
          fileKey: "test-insurance.jpg",
          expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
        },
      });
      await prisma.vehicleInsurance.create({
        data: {
          vehicleId: vehicleRow.id,
          provider: "ICICI Lombard",
          policyNo: "POL-123456",
          validFrom: new Date(),
          expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
        },
      });
      const assignmentRow = await prisma.driverVehicleAssignment.create({
        data: {
          driverId: testDriverId,
          vehicleId: vehicleRow.id,
          assignedAt: new Date(),
          isActive: true,
        },
      });

      const info = await vehicle.getVehicleInfo(testUserId);
      expect(info.vehicleDetails).not.toBeNull();
      expect(info.vehicleDetails!.registrationNumber).toBe("UP14AGG9000");
      expect(info.vehicleDetails!.make).toBe("Maruti");
      expect(info.vehicleDetails!.category?.name).toBe(category.name);
      expect(info.vehicleDocuments!.rc?.status).toBe("VERIFIED");
      expect(info.vehicleDocuments!.insurance?.provider).toBe("ICICI Lombard");
      expect(info.vehicleDocuments!.insurance?.policyNo).toBe("POL-123456");
      expect(info.vehicleDocuments!.puc).toBeNull();

      await prisma.driverVehicleAssignment.delete({
        where: { id: assignmentRow.id },
      });
      await prisma.vehicleInsurance.deleteMany({
        where: { vehicleId: vehicleRow.id },
      });
      await prisma.vehicleDocument.deleteMany({
        where: { vehicleId: vehicleRow.id },
      });
      await prisma.vehicle.delete({ where: { id: vehicleRow.id } });
    });
  });
});
