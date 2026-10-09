import type { FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import { prisma } from "../../../database/prisma";
import {
  driverVerifyOtpResponseExamples,
  driverVerifyOtpRouteSchema,
} from "../driver-auth.contract";
import { driverController } from "../driver.controller";
import { DriverAuthService } from "../services/driver-auth.service";
import {
  DriverLoginProfile,
  DriverProfileService,
} from "../services/driver-profile.service";

type LoginState = {
  driverId: string;
  userId: string;
  isNewDriver: boolean;
  isProfileCompleted: boolean;
  kycStatus: string;
  vehicleApproved: boolean;
  documentsValid: boolean;
  accountStatus: string;
  availability: string;
  canGoOnline: boolean;
  hasActiveBooking: boolean;
  activeBooking: { id: string; status: string } | null;
  nextStep: string;
};

const returningLoginState: LoginState = {
  driverId: "a83b5cea-e762-4935-9c6f-ecacce562a2e",
  userId: "ae860832-fa18-4826-b766-cb3c3cfe01d4",
  isNewDriver: false,
  isProfileCompleted: true,
  kycStatus: "NOT_SUBMITTED",
  vehicleApproved: false,
  documentsValid: false,
  accountStatus: "ACTIVE",
  availability: "OFFLINE",
  canGoOnline: false,
  hasActiveBooking: false,
  activeBooking: null,
  nextStep: "SUBMIT_KYC",
};

const savedProfile: DriverLoginProfile = {
  fullName: "Driver Name",
  phoneNumber: "+919800000000",
  email: "driver@example.com",
  profileImage: "https://example.com/driver.jpg",
  gender: "MALE",
  dateOfBirth: "1995-01-01",
  preferredLanguage: "en",
  address: {
    addressLine1: "Address line",
    addressLine2: null,
    city: "Delhi",
    state: "Delhi",
    postalCode: "110001",
    country: "India",
  },
  createdAt: "2026-07-29",
  updatedAt: "2026-07-29",
};

const mockRequest = () =>
  ({
    body: {
      mobile: "+919800000000",
      otp: "1234",
      deviceId: "test-device",
    },
    ip: "127.0.0.1",
    headers: { "user-agent": "jest" },
  }) as unknown as FastifyRequest;

const mockReply = () =>
  ({
    setCookie: jest.fn(),
    header: jest.fn(),
  }) as unknown as FastifyReply;

const mockAuthResult = (loginState: LoginState) =>
  ({
    session: {
      cookieValue: "session-id.session-secret",
      session: { userId: loginState.userId },
    },
    driver: { id: loginState.driverId },
    loginState,
  }) as never;

describe("driver OTP profile response", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps the first-time driver response unchanged", async () => {
    const getLoginProfile = jest.spyOn(
      DriverProfileService.prototype,
      "getLoginProfile",
    );
    jest.spyOn(DriverAuthService.prototype, "verifyOtp").mockResolvedValue(
      mockAuthResult({
        ...returningLoginState,
        isNewDriver: true,
        isProfileCompleted: false,
        nextStep: "COMPLETE_PROFILE",
      }),
    );
    const reply = mockReply();

    const response = await driverController.verifyOtp(mockRequest(), reply);

    expect(response).toEqual({
      success: true,
      message: "OTP verified successfully",
      data: null,
    });
    expect(getLoginProfile).not.toHaveBeenCalled();
    expect(reply.setCookie).toHaveBeenCalledWith(
      expect.any(String),
      "session-id.session-secret",
      expect.any(Object),
    );
  });

  it("documents and serializes the returning profile without dropping fields", async () => {
    const app = Fastify();
    app.post(
      "/verify-otp",
      { schema: driverVerifyOtpRouteSchema },
      async () => driverVerifyOtpResponseExamples.returningDriver,
    );

    const response = await app.inject({
      method: "POST",
      url: "/verify-otp",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      driverVerifyOtpResponseExamples.returningDriver,
    );
  });

  it("adds the completed saved profile for a returning driver", async () => {
    jest
      .spyOn(DriverAuthService.prototype, "verifyOtp")
      .mockResolvedValue(mockAuthResult(returningLoginState));
    jest
      .spyOn(DriverProfileService.prototype, "getLoginProfile")
      .mockResolvedValue({
        profile: savedProfile,
        isProfileCompleted: true,
      });
    const reply = mockReply();

    const response = await driverController.verifyOtp(mockRequest(), reply);

    const { userId, ...expectedLoginState } = returningLoginState;
    expect(response.data).toMatchObject({
      ...expectedLoginState,
      profile: savedProfile,
    });
    expect(reply.setCookie).toHaveBeenCalledTimes(1);
  });

  it("returns available fields and correct onboarding for an incomplete profile", async () => {
    jest
      .spyOn(DriverAuthService.prototype, "verifyOtp")
      .mockResolvedValue(mockAuthResult(returningLoginState));
    jest
      .spyOn(DriverProfileService.prototype, "getLoginProfile")
      .mockResolvedValue({
        profile: {
          ...savedProfile,
          fullName: null,
          profileImage: null,
        },
        isProfileCompleted: false,
      });

    const response = await driverController.verifyOtp(
      mockRequest(),
      mockReply(),
    );

    expect(response.data).toMatchObject({
      isNewDriver: false,
      isProfileCompleted: false,
      canGoOnline: false,
      nextStep: "COMPLETE_PROFILE",
      profile: {
        fullName: null,
        phoneNumber: "+919800000000",
        profileImage: null,
      },
    });
  });

  it("preserves the active-booking next step for an incomplete profile", async () => {
    jest.spyOn(DriverAuthService.prototype, "verifyOtp").mockResolvedValue(
      mockAuthResult({
        ...returningLoginState,
        hasActiveBooking: true,
        activeBooking: {
          id: "5d8096a0-3889-440f-95e9-acd809a7b6f3",
          status: "TRIP_STARTED",
        },
        nextStep: "ACTIVE_TRIP",
      }),
    );
    jest
      .spyOn(DriverProfileService.prototype, "getLoginProfile")
      .mockResolvedValue({
        profile: {
          ...savedProfile,
          fullName: null,
        },
        isProfileCompleted: false,
      });

    const response = await driverController.verifyOtp(
      mockRequest(),
      mockReply(),
    );

    expect(response.data).toMatchObject({
      isProfileCompleted: false,
      canGoOnline: false,
      hasActiveBooking: true,
      nextStep: "ACTIVE_TRIP",
    });
  });

  it("returns null instead of throwing when a returning profile is missing", async () => {
    jest
      .spyOn(DriverAuthService.prototype, "verifyOtp")
      .mockResolvedValue(mockAuthResult(returningLoginState));
    jest
      .spyOn(DriverProfileService.prototype, "getLoginProfile")
      .mockResolvedValue(null);

    const response = await driverController.verifyOtp(
      mockRequest(),
      mockReply(),
    );

    expect(response.data).toMatchObject({
      isNewDriver: false,
      isProfileCompleted: false,
      canGoOnline: false,
      nextStep: "COMPLETE_PROFILE",
      profile: null,
    });
  });

  it("selects and returns only the allowed login-profile fields", async () => {
    const profileRow = {
      dateOfBirth: new Date("1995-01-01T00:00:00.000Z"),
      gender: "MALE",
      profileImageUrl: savedProfile.profileImage,
      preferredLanguage: "en",
      addressLine1: "Address line",
      addressLine2: null,
      city: "Delhi",
      state: "Delhi",
      postalCode: "110001",
      country: "India",
      createdAt: new Date(savedProfile.createdAt),
      updatedAt: new Date(savedProfile.updatedAt),
      user: {
        displayName: "Driver Name",
        phone: "+919800000000",
        email: "driver@example.com",
      },
    };
    const findUnique = jest
      .spyOn(prisma.driverProfile, "findUnique")
      .mockResolvedValue(profileRow as never);
    const create = jest.spyOn(prisma.driverProfile, "create");
    const update = jest.spyOn(prisma.driverProfile, "update");

    const result = await new DriverProfileService().getLoginProfile(
      returningLoginState.userId,
    );

    expect(result).toEqual({
      profile: savedProfile,
      isProfileCompleted: true,
    });
    expect(Object.keys(result!.profile)).toEqual([
      "fullName",
      "phoneNumber",
      "email",
      "profileImage",
      "gender",
      "dateOfBirth",
      "preferredLanguage",
      "address",
      "createdAt",
      "updatedAt",
    ]);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: returningLoginState.userId },
        select: expect.not.objectContaining({
          licenseNumber: expect.anything(),
          documents: expect.anything(),
          payoutAccounts: expect.anything(),
        }),
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
