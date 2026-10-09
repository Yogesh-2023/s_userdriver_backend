import type { FastifyRequest, FastifyReply } from "fastify";
import { logCustomer } from "../../common/chalk-logger";
import { success } from "../../common/response";
import { parse } from "../../common/validation";
import { CustomerAuthService } from "./services/customer-auth.service";
import { CustomerProfileService } from "./services/customer-profile.service";
import { CustomerAddressService } from "./services/customer-address.service";
import { CustomerLocationService } from "./services/customer-location.service";
import { CustomerBookingService } from "./services/customer-booking.service";
import { CustomerTripHistoryService } from "./services/customer-trip-history.service";
import { CustomerPaymentService } from "./services/customer-payment.service";
import { CustomerMarketingService } from "./services/customer-marketing.service";
import { CustomerRatingService } from "./services/customer-rating.service";
import { CustomerNotificationService } from "./services/customer-notification.service";
import { CustomerSupportService } from "./services/customer-support.service";
import { CustomerSafetyService } from "./services/customer-safety.service";
import { CustomerSettingsService } from "./services/customer-settings.service";
import { CustomerAccountService } from "./services/customer-account.service";
import { customerRentalService } from "./services/customer-rental.service";
import * as schemas from "./customer.validation";
import { z } from "zod";
import { env } from "../../config/env";
import { sessionCookieOptions } from "../../common/session-cookie";
import { BookingStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "../../database/prisma";
import { redis } from "../../infrastructure/redis";
import { errors } from "../../common/errors";
import { RideChatService } from "../bookings/ride-chat.service";
import { buildFileUrl } from "../../common/url";

const authService = new CustomerAuthService();
const profileService = new CustomerProfileService();
const addressService = new CustomerAddressService();
const locationService = new CustomerLocationService();
const bookingService = new CustomerBookingService();
const tripHistoryService = new CustomerTripHistoryService();
const paymentService = new CustomerPaymentService();
const marketingService = new CustomerMarketingService();
const ratingService = new CustomerRatingService();
const notificationService = new CustomerNotificationService();
const supportService = new CustomerSupportService();
const safetyService = new CustomerSafetyService();
const chatService = new RideChatService();
const settingsService = new CustomerSettingsService();
const accountService = new CustomerAccountService();

const customerProfileFormFields = new Set([
  "fullName",
  "email",
  "gender",
  "preferredLanguage",
]);

const parseCustomerProfileForm = async (request: FastifyRequest) => {
  if (!request.isMultipart()) {
    throw errors.badRequest("Content-Type must be multipart/form-data");
  }

  const body = request.body as Record<string, unknown> | undefined;
  if (!body) {
    return { fields: {}, profileImage: undefined };
  }

  const fields: Record<string, string> = {};
  let profileImage:
    { buffer: Buffer; contentType: string; filename: string } | undefined;

  for (const [key, value] of Object.entries(body)) {
    if (key === "profileImage") {
      if (Buffer.isBuffer(value)) {
        if (value.length === 0) continue;
        if (value.length > 5 * 1024 * 1024) {
          throw errors.badRequest("profileImage must not exceed 5 MB");
        }

        const isJpeg =
          value.length >= 3 &&
          value[0] === 0xff &&
          value[1] === 0xd8 &&
          value[2] === 0xff;
        const pngSignature = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        const isPng =
          value.length >= pngSignature.length &&
          value.subarray(0, pngSignature.length).equals(pngSignature);

        if (!isJpeg && !isPng) {
          throw errors.badRequest("profileImage must be a JPEG or PNG file");
        }

        profileImage = {
          buffer: value,
          contentType: isPng ? "image/png" : "image/jpeg",
          filename: isPng ? "profile.png" : "profile.jpg",
        };
      }
      continue;
    }

    if (customerProfileFormFields.has(key)) {
      if (fields[key] !== undefined) {
        throw errors.badRequest(`Duplicate form field: ${key}`);
      }
      // Depending on fastify-multipart config, value could be a string or an array of strings
      fields[key] = Array.isArray(value) ? String(value[0]) : String(value);
    }
  }

  return { fields, profileImage };
};

export const customerController = {
  // 1. Authentication
  async requestOtp(request: FastifyRequest) {
    const input = parse(schemas.requestOtp, request.body);
    const identifier = input.mobile || input.email!;
    const type = input.mobile ? "mobile" : "email";
    await authService.requestOtp(identifier, type, request.ip);
    return {
      success: true,
      message: "OTP sent successfully",
    };
  },

  async verifyOtp(request: FastifyRequest, reply: FastifyReply) {
    const input = parse(schemas.verifyOtp, request.body);
    const identifier = input.mobile || input.email!;
    const type = input.mobile ? "mobile" : "email";
    const result = await authService.verifyOtp(identifier, type, input.otp, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      deviceId: input.deviceId,
    });

    reply.setCookie(
      env.COOKIE_NAME,
      result.session.cookieValue,
      sessionCookieOptions(),
    );

    const { session, ...data } = result;

    logCustomer("Logged In", { userId: result.session.session.userId });

    return {
      success: true,
      message: "OTP verified successfully",
      data,
    };
  },

  async resendOtp(request: FastifyRequest) {
    const input = parse(schemas.requestOtp, request.body);
    const identifier = input.mobile || input.email!;
    const type = input.mobile ? "mobile" : "email";
    await authService.resendOtp(identifier, type, request.ip);
    return {
      success: true,
      message: "OTP resent successfully",
    };
  },

  async logout(request: FastifyRequest, reply: FastifyReply) {
    request.log.info({
      msg: "DEBUG: Customer logout started",
      authSession: request.authSession,
    });
    try {
      if (request.authSession) {
        request.log.info("DEBUG: Calling authService.logout");
        await authService.logout(
          request.authSession.userId,
          request.authSession.sessionId,
        );
        request.log.info("DEBUG: authService.logout completed");
      }
      request.log.info({
        msg: "DEBUG: Clearing cookie",
        cookieName: env.COOKIE_NAME,
        domain: env.COOKIE_DOMAIN,
      });
      reply.clearCookie(env.COOKIE_NAME, {
        path: "/",
        ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
      });
      request.log.info("DEBUG: Cookie cleared");
    } catch (error: any) {
      request.log.error({
        msg: "DEBUG: Error inside customer logout",
        err: error,
        stack: error.stack,
      });
      // Rethrow to allow Fastify to handle it
      throw error;
    }
    return {
      success: true,
      message: "Logged out successfully",
    };
  },

  async logoutAll(request: FastifyRequest, reply: FastifyReply) {
    if (request.authSession) {
      await authService.logoutAll(request.authSession.userId);
    }
    reply.clearCookie(env.COOKIE_NAME, {
      path: "/",
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
    return success(null, "All sessions revoked successfully");
  },

  async me(request: FastifyRequest) {
    const profile = await authService.me(request.authSession!.userId);
    return success(profile, "Profile retrieved");
  },

  async home(request: FastifyRequest) {
    const userId = request.authSession!.userId;
    const [profile, activeBooking, recentLocations, addresses] =
      await Promise.all([
        authService.me(userId),
        bookingService.getActiveBooking(userId).catch(() => null),
        addressService.recent(userId),
        addressService.list(userId),
      ]);

    return success(
      {
        profile,
        activeBooking,
        recentLocations,
        savedAddresses: addresses,
      },
      "Home data retrieved",
    );
  },

  async listSessions(request: FastifyRequest) {
    const sessions = await authService.listSessions(
      request.authSession!.userId,
    );
    return success(sessions, "Sessions retrieved");
  },

  async revokeSession(request: FastifyRequest) {
    const { sessionId } = request.params as { sessionId: string };
    await authService.logout(request.authSession!.userId, sessionId);
    return success(null, "Session revoked");
  },

  // 2. Profile & Onboarding
  async createProfile(request: FastifyRequest, reply: FastifyReply) {
    const { fields, profileImage } = await parseCustomerProfileForm(request);
    const data = parse(schemas.profileCreate, fields);
    const profile = await profileService.createProfile(
      request.authSession!.userId,
      data,
      profileImage,
      {
        customerId: "",
        userId: request.authSession!.userId,
        sessionId: request.authSession!.sessionId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: String(request.id),
      },
    );
    return reply.code(201).send({
      success: true,
      message: "Customer profile created successfully",
      data: { customer: profile },
    });
  },

  async getProfile(request: FastifyRequest) {
    const profile = await profileService.getProfile(
      request.authSession!.userId,
    );
    return {
      success: true,
      message: "Profile retrieved",
      data: profile,
    };
  },

  async updateProfile(request: FastifyRequest) {
    const { fields } = await parseCustomerProfileForm(request);
    const data = parse(schemas.profileUpdate, fields);
    const profile = await profileService.updateProfile(
      request.authSession!.userId,
      data,
      {
        customerId: "",
        userId: request.authSession!.userId,
        sessionId: request.authSession!.sessionId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: String(request.id),
      },
    );
    return success(profile, "Profile updated");
  },

  async updatePreferences(request: FastifyRequest) {
    const data = parse(schemas.preferencesUpdate, request.body);
    const preferences = await profileService.updatePreferences(
      request.authSession!.userId,
      data,
      {
        customerId: "",
        userId: request.authSession!.userId,
        sessionId: request.authSession!.sessionId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: String(request.id),
      },
    );
    return success(preferences, "Preferences updated");
  },

  async uploadProfileImage(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }

    const body: any = request.body;
    let file = body?.profileImage;
    if (Array.isArray(file)) {
      file = file[0];
    }

    if (!file || !file.buffer) {
      throw errors.badRequest("profileImage file is required");
    }

    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      throw errors.badRequest("profileImage must be a JPEG or PNG file");
    }

    const imageBuffer = file.buffer;
    const contentType = file.mimetype;

    const result = await profileService.uploadProfileImage(
      request.authSession!.userId,
      contentType,
      imageBuffer,
    );

    return {
      success: true,
      message: "Profile image uploaded",
      data: result,
    };
  },

  async deleteProfileImage(request: FastifyRequest) {
    const result = await profileService.deleteProfileImage(
      request.authSession!.userId,
    );
    return success(result, "Profile image deleted");
  },

  async getOnboardingStatus(request: FastifyRequest) {
    const result = await profileService.getOnboardingStatus(
      request.authSession!.userId,
    );
    return success(result, "Onboarding status retrieved");
  },

  // 3. Saved & Recent Addresses
  async listAddresses(request: FastifyRequest) {
    const result = await addressService.list(request.authSession!.userId);
    const addresses = result.map(
      ({
        id: addressId,
        landmark: _landmark,
        placeId: _placeId,
        ...address
      }) => ({ addressId, ...address }),
    );
    return {
      success: true,
      message: "Addresses retrieved",
      data: addresses,
    };
  },

  async createAddress(request: FastifyRequest) {
    const data = parse(schemas.addressCreate, request.body);
    const result = await addressService.create(
      request.authSession!.userId,
      data,
    );
    const {
      id: addressId,
      landmark: _landmark,
      placeId: _placeId,
      ...address
    } = result;
    return {
      success: true,
      message: "Address created",
      data: { addressId, ...address },
    };
  },

  async getAddress(request: FastifyRequest) {
    const { addressId } = request.params as { addressId: string };
    const result = await addressService.get(
      request.authSession!.userId,
      addressId,
    );
    const {
      id: responseAddressId,
      landmark: _landmark,
      placeId: _placeId,
      ...address
    } = result;
    return {
      success: true,
      message: "Address retrieved",
      data: { addressId: responseAddressId, ...address },
    };
  },

  async updateAddress(request: FastifyRequest) {
    const { addressId } = request.params as { addressId: string };
    const data = parse(schemas.addressUpdate, request.body);
    const result = await addressService.update(
      request.authSession!.userId,
      addressId,
      data,
    );
    const {
      id: responseAddressId,
      landmark: _landmark,
      placeId: _placeId,
      ...address
    } = result;
    return {
      success: true,
      message: "Address updated",
      data: { addressId: responseAddressId, ...address },
    };
  },

  async deleteAddress(request: FastifyRequest) {
    const { addressId } = request.params as { addressId: string };
    const result = await addressService.delete(
      request.authSession!.userId,
      addressId,
    );
    return {
      success: true,
      message: "Address deleted",
      data: result,
    };
  },

  async setDefaultAddress(request: FastifyRequest) {
    const { addressId } = request.params as { addressId: string };
    const result = (await addressService.setDefault(
      request.authSession!.userId,
      addressId,
    )) as unknown as Awaited<ReturnType<typeof addressService.get>>;
    const { id: responseAddressId, placeId: _placeId, ...address } = result;
    return {
      success: true,
      message: "Default address updated",
      data: { addressId: responseAddressId, ...address },
    };
  },

  async recentAddresses(request: FastifyRequest) {
    const result = await addressService.recent(request.authSession!.userId);
    return {
      success: true,
      message: "Recent addresses retrieved",
      data: result,
    };
  },

  async saveRecentAddress(request: FastifyRequest) {
    const data = request.body as any;
    const result = await addressService.saveRecentAddress(
      request.authSession!.userId,
      data,
    );
    return success(result, "Recent address saved");
  },

  // 4. Location Search & Serviceability
  async searchLocation(request: FastifyRequest) {
    const query = parse(schemas.locationSearch, request.query);
    const result = await locationService.search(query.q);
    return success(result, "Locations search results");
  },

  async reverseGeocode(request: FastifyRequest) {
    const data = parse(schemas.reverseGeocode, request.body);
    const result = await locationService.reverseGeocode(
      data.latitude,
      data.longitude,
    );
    return success(result, "Address retrieved");
  },

  async checkServiceability(request: FastifyRequest) {
    const data = parse(schemas.serviceabilityCheck, request.body);
    const result = await locationService.checkServiceability(
      data.latitude,
      data.longitude,
    );
    return success(result, "Serviceability check completed");
  },

  async listServiceAreas(request: FastifyRequest) {
    const result = await locationService.listServiceAreas();
    return success(result, "Service areas retrieved");
  },

  // 5. Vehicle Categories & Fare Estimate
  async listCategories(request: FastifyRequest) {
    const query = request.query as { latitude?: string; longitude?: string };
    const lat = query.latitude ? parseFloat(query.latitude) : undefined;
    const lng = query.longitude ? parseFloat(query.longitude) : undefined;
    const result = await bookingService.listCategories(
      request.authSession!.userId,
      lat,
      lng,
    );
    return success(result, "Active vehicle categories retrieved");
  },

  async getCategoryDetails(request: FastifyRequest) {
    const { categoryId } = request.params as { categoryId: string };
    const result = await prisma.vehicleCategory.findUnique({
      where: { id: categoryId, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        iconUrl: true,
        minPassengers: true,
        maxPassengers: true,
      },
    });
    return success(result, "Category details retrieved");
  },

  async estimateFare(request: FastifyRequest) {
    console.log("INCOMING FARE ESTIMATE:", JSON.stringify(request.body));
    const data = parse(schemas.fareEstimate, request.body);
    const result = await bookingService.estimateFare(
      request.authSession!.userId,
      data,
    );
    return success(result, "Fare estimate retrieved");
  },

  // 6. Bookings
  async createBookingImmediate(request: FastifyRequest) {
    const data = parse(schemas.bookingCreateImmediate, request.body);
    const key = String(request.headers["x-idempotency-key"] || "");
    const result = await bookingService.createBookingImmediate(
      request.authSession!.userId,
      data,
      key,
    );
    logCustomer("Booking Created", { bookingId: result.id, type: "IMMEDIATE" });
    return success(result, "Booking created");
  },

  async createBookingScheduled(request: FastifyRequest) {
    const data = parse(schemas.bookingCreateScheduled, request.body);
    const key = String(request.headers["x-idempotency-key"] || "");
    const result = await bookingService.createBookingScheduled(
      request.authSession!.userId,
      data,
      key,
    );
    return success(result, "Scheduled booking created");
  },

  async rescheduleBooking(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const data = parse(schemas.bookingReschedule, request.body);
    const result = await bookingService.rescheduleBooking(
      request.authSession!.userId,
      bookingId,
      data.scheduledAt,
    );
    return success(result, "Rescheduled successfully");
  },

  async getActiveBooking(request: FastifyRequest) {
    const result = await bookingService.getActiveBooking(
      request.authSession!.userId,
    );
    return success(result, "Active booking retrieved");
  },

  async getTimeline(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getTimeline(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Timeline retrieved");
  },

  async getDriverDetails(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getDriverDetails(
      request.authSession!.userId,
      bookingId,
    );
    return success(
      {
        driver: result.driver
          ? {
              id: result.driver.id,
              name: result.driver.user.displayName,
              profileImageUrl: buildFileUrl(
                request,
                result.driver.profileImageUrl,
              ),
              rating: Number(result.driver.averageRating),
              totalTrips: result.driver.totalTrips,
            }
          : null,
        vehicle: result.vehicle
          ? {
              id: result.vehicle.id,
              name: result.vehicle.name,
              make: result.vehicle.make,
              model: result.vehicle.model,
              color: result.vehicle.color,
              number: result.vehicle.number,
              category: result.vehicle.category?.name || "Unknown",
              images: result.vehicle.category?.imageUrl
                ? [buildFileUrl(request, result.vehicle.category.imageUrl)]
                : [],
            }
          : null,
        etaMinutes: result.etaMinutes,
        distanceToPickupMeters: result.distanceToPickupMeters,
        dropOffTime: result.dropOffTime,
      },
      "Driver details retrieved",
    );
  },

  async getFareDetails(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getFareDetails(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Fare details retrieved");
  },

  async getPaymentDetails(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getPaymentDetails(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Payment details retrieved");
  },

  async getLiveDriverLocation(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getLiveDriverLocation(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Driver live location retrieved");
  },

  async cancelBooking(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const data = parse(schemas.bookingCancel, request.body);
    const result = await bookingService.cancel(
      request.authSession!.userId,
      bookingId,
      data,
    );
    return success(result, "Booking cancelled");
  },

  // 7. Trips & Realtime
  async getTripOtpStatus(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { booking: { include: { customer: true } } },
    });
    if (!trip || trip.booking.customer.userId !== request.authSession!.userId) {
      throw new Error("Trip not found");
    }
    // We mask or display expiring parameters
    return success(
      {
        tripId: trip.id,
        status: trip.status,
        expiresAt: trip.verificationOtpExpiresAt,
      },
      "OTP status retrieved",
    );
  },

  async listTrips(request: FastifyRequest) {
    const query = parse(schemas.tripsList, request.query);
    const customer = await prisma.customerProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!customer) throw errors.notFound("Customer profile not found");
    const history = await tripHistoryService.getTripHistory(customer.id, query);
    return success(history, "Trip history retrieved");
  },

  async getActiveTrip(request: FastifyRequest) {
    const customer = await prisma.customerProfile.findUnique({
      where: { userId: request.authSession!.userId },
    });
    if (!customer) throw new Error("Customer profile not found");
    const result = await prisma.trip.findFirst({
      where: {
        booking: { customerId: customer.id },
        status: {
          in: ["CREATED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "STARTED"],
        },
      },
      include: { booking: true },
    });
    return success(result, "Active trip retrieved");
  },

  async getTripDetails(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const customer = await prisma.customerProfile.findUnique({
      where: { userId: request.authSession!.userId },
    });
    if (!customer) throw new Error("Customer profile not found");
    const result = await prisma.trip.findFirst({
      where: { id: tripId, booking: { customerId: customer.id } },
      include: { booking: true },
    });
    return success(result, "Trip details retrieved");
  },

  async getTripLiveLocation(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
    });
    if (!trip) throw new Error("Trip not found");
    const locationKey = `location:driver:${trip.driverId}`;
    const rawLocation = await redis.get(locationKey);
    return success(
      rawLocation ? JSON.parse(rawLocation) : null,
      "Trip live location retrieved",
    );
  },

  async getTripTimeline(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const result = await prisma.tripStatusHistory.findMany({
      where: { tripId },
      orderBy: { createdAt: "asc" },
    });
    return success(result, "Timeline retrieved");
  },

  async getTripInvoice(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const result = await prisma.invoice.findFirst({
      where: { tripId },
    });
    return success(result, "Invoice retrieved");
  },

  async createTripShare(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const input = request.body as any;
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { bookingId: true },
    });
    if (!trip) throw new Error("Trip not found");

    const safetyService = new (
      await import("./services/customer-safety.service")
    ).CustomerSafetyService();
    const result = await safetyService.reportIncident(
      request.authSession!.userId,
      {
        bookingId: trip.bookingId,
        type: "TRIP_SHARE",
        description: `Recipient: ${input.recipientName || "shared"}`,
      },
    );
    return success(result, "Share created");
  },

  // 8. Payments & Wallet
  async getPaymentOptions(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await paymentService.getPaymentOptions(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Payment options retrieved");
  },

  async createBookingOrder(request: FastifyRequest) {
    const data = parse(schemas.createPaymentOrder, request.body);
    const key = String(request.headers["x-idempotency-key"] || "");
    const result = await paymentService.createBookingOrder(
      request.authSession!.userId,
      data.bookingId!,
      PaymentMethod.UPI, // Default or parse from payload
      key,
    );
    return success(result, "Booking payment order created");
  },

  async verifyBookingPayment(request: FastifyRequest) {
    const data = parse(schemas.verifyPayment, request.body);
    const result = await paymentService.verifyBookingPayment(
      request.authSession!.userId,
      data,
    );
    return success(result, "Booking payment verified");
  },

  async getWallet(request: FastifyRequest) {
    const query = request.query as { page?: string; limit?: string };
    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "20", 10);
    const result = await paymentService.getWallet(
      request.authSession!.userId,
      page,
      limit,
    );
    return success(result, "Wallet details retrieved");
  },

  async addWalletMoney(request: FastifyRequest) {
    const data = parse(schemas.walletAddMoney, request.body);
    const result = await paymentService.addWalletMoney(
      request.authSession!.userId,
      data.amount,
      data.paymentMethod,
    );
    return success(result, "Wallet topup order created");
  },

  async verifyWalletTopup(request: FastifyRequest) {
    const data = parse(schemas.verifyPayment, request.body);
    const result = await paymentService.verifyWalletTopup(
      request.authSession!.userId,
      {
        orderId: data.paymentId, // Razorpay orderId passed as paymentId
        providerPaymentId: data.providerPaymentId,
        signature: data.signature,
      },
    );
    return success(result, "Wallet topup verified");
  },

  async changePaymentMethod(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const data = parse(schemas.changePaymentMethod, request.body);
    const result = await paymentService.changePaymentMethod(
      request.authSession!.userId,
      bookingId,
      data.paymentMethod,
    );
    return success(result, "Payment method changed");
  },

  // 9. Coupons & Marketing
  async listOffers(request: FastifyRequest) {
    const result = await marketingService.listOffers(
      request.authSession!.userId,
    );
    return success(result, "Offers retrieved");
  },

  async listAvailableCoupons(request: FastifyRequest) {
    const result = await marketingService.listAvailableCoupons(
      request.authSession!.userId,
    );
    return success(result, "Available coupons retrieved");
  },

  async validateCoupon(request: FastifyRequest) {
    const data = parse(schemas.couponValidate, request.body);
    const result = await marketingService.validateCoupon(
      request.authSession!.userId,
      data.couponCode,
      data.subtotal,
      data.categoryId,
    );
    return success(result, "Coupon details retrieved");
  },

  async getCouponHistory(request: FastifyRequest) {
    const result = await marketingService.getCouponHistory(
      request.authSession!.userId,
    );
    return success(result, "Coupon usage history retrieved");
  },

  async getReferralCode(request: FastifyRequest) {
    const result = await marketingService.getReferralCode(
      request.authSession!.userId,
    );
    return success(result, "Referral code retrieved");
  },

  async applyReferralCode(request: FastifyRequest) {
    const data = parse(schemas.referralApply, request.body);
    const result = await marketingService.applyReferralCode(
      request.authSession!.userId,
      data.referralCode,
    );
    return success(result, "Referral code applied");
  },

  async listReferrals(request: FastifyRequest) {
    const result = await marketingService.listReferrals(
      request.authSession!.userId,
    );
    return success(result, "Referrals list retrieved");
  },

  async listRewards(request: FastifyRequest) {
    const result = await marketingService.listRewards(
      request.authSession!.userId,
    );
    return success(result, "Referral rewards list retrieved");
  },

  // 10. Ratings
  async createRating(request: FastifyRequest) {
    const { tripId } = request.params as { tripId: string };
    const data = parse(schemas.ratingCreate, request.body);
    const result = await ratingService.create(
      request.authSession!.userId,
      tripId,
      data,
    );
    return success(result, "Rating submitted");
  },

  async listRatings(request: FastifyRequest) {
    const result = await ratingService.list(request.authSession!.userId);
    return success(result, "Ratings retrieved");
  },

  async updateRating(request: FastifyRequest) {
    const { ratingId } = request.params as { ratingId: string };
    const data = parse(schemas.ratingCreate, request.body);
    const result = await ratingService.update(
      request.authSession!.userId,
      ratingId,
      data,
    );
    return success(result, "Rating updated");
  },

  // 11. Notifications
  async listNotifications(request: FastifyRequest) {
    const query = request.query as { page?: string; limit?: string };
    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "20", 10);
    const result = await notificationService.list(
      request.authSession!.userId,
      page,
      limit,
    );
    return success(result, "Notifications retrieved");
  },

  async getUnreadNotificationsCount(request: FastifyRequest) {
    const result = await notificationService.getUnreadCount(
      request.authSession!.userId,
    );
    return success(result, "Unread count retrieved");
  },

  async markNotificationRead(request: FastifyRequest) {
    const { notificationId } = request.params as { notificationId: string };
    const result = await notificationService.markRead(
      request.authSession!.userId,
      notificationId,
    );
    return success(result, "Notification marked read");
  },

  async markAllNotificationsRead(request: FastifyRequest) {
    const result = await notificationService.markAllRead(
      request.authSession!.userId,
    );
    return success(result, "All notifications marked read");
  },

  async deleteNotification(request: FastifyRequest) {
    const { notificationId } = request.params as { notificationId: string };
    const result = await notificationService.delete(
      request.authSession!.userId,
      notificationId,
    );
    return success(result, "Notification deleted");
  },

  async registerDeviceToken(request: FastifyRequest) {
    const { token, platform } = request.body as {
      token: string;
      platform: string;
    };
    const normPlatform = (platform || "ANDROID").toUpperCase();
    const result = await notificationService.registerDeviceToken(
      request.authSession!.userId,
      token,
      normPlatform,
    );
    console.log(`[FCM][TOKEN_REGISTERED] customerUserId=${request.authSession!.userId} platform=${normPlatform} tokenPrefix=${token ? token.substring(0, 15) : "NULL"}...`);
    return success(result, "Device token registered");
  },

  async deleteDeviceToken(request: FastifyRequest) {
    const params = request.params as { tokenId?: string };
    const query = request.query as { token?: string; tokenId?: string };
    const token = params.tokenId || query.token || query.tokenId;
    if (!token) throw errors.badRequest("Token parameter required");
    const result = await notificationService.deleteDeviceToken(
      request.authSession!.userId,
      token,
    );
    return success(result, "Device token deleted");
  },

  // 12. Support
  async listSupportCategories(_request: FastifyRequest) {
    const result = await supportService.listCategories();
    return success(result, "Support categories retrieved");
  },

  async createSupportTicket(request: FastifyRequest) {
    const data = parse(schemas.supportTicketCreate, request.body);
    const result = await supportService.createTicket(
      request.authSession!.userId,
      {
        categoryId: data.categoryId,
        subject: data.subject ?? data.title!,
        description: data.description,
        bookingId: data.bookingId,
        tripId: data.tripId,
        paymentId: data.paymentId,
        attachments: data.attachments ?? data.attachmentUrl,
      },
    );
    return success(result, "Support ticket created");
  },

  async listSupportTickets(request: FastifyRequest) {
    const query = parse(
      z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      request.query,
    );
    const result = await supportService.listTickets(
      request.authSession!.userId,
      query.page,
      query.limit,
    );
    return success(result.items, "Support tickets retrieved", {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / query.limit),
    });
  },

  async getSupportTicket(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const result = await supportService.getTicket(
      request.authSession!.userId,
      ticketId,
    );
    return success(result, "Support ticket details retrieved");
  },

  async getSupportMessages(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const result = await supportService.getMessages(
      request.authSession!.userId,
      ticketId,
    );
    return success(result, "Support ticket messages retrieved");
  },

  async markSupportMessagesRead(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const result = await supportService.markMessagesRead(
      request.authSession!.userId,
      ticketId,
    );
    return success(result, "Support messages marked as read");
  },

  async uploadSupportAttachment(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }

    const body: any = request.body;
    let file = body?.attachment;
    if (Array.isArray(file)) {
      file = file[0];
    }

    if (!file || !file.buffer) {
      throw errors.badRequest("attachment file is required");
    }

    if (
      ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        file.mimetype,
      ) === false
    ) {
      throw errors.badRequest(
        "Support attachment must be a JPEG, PNG, WebP image or PDF file",
      );
    }

    const result = await supportService.uploadAttachment(
      request.authSession!.userId,
      file.mimetype as
        "image/jpeg" | "image/png" | "image/webp" | "application/pdf",
      file.buffer,
      file.filename,
    );

    return success(result, "Support attachment uploaded");
  },

  async createSupportMessage(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const data = parse(schemas.supportMessageCreate, request.body);
    const result = await supportService.createMessage(
      request.authSession!.userId,
      ticketId,
      data.message,
      data.attachments ?? data.attachmentUrl,
    );
    return success(result, "Message sent successfully");
  },

  async closeSupportTicket(request: FastifyRequest) {
    const { ticketId } = request.params as { ticketId: string };
    const result = await supportService.closeTicket(
      request.authSession!.userId,
      ticketId,
    );
    return success(result, "Ticket closed successfully");
  },

  // 13. Safety
  async createSos(request: FastifyRequest) {
    const data = parse(schemas.safetySosCreate, request.body);
    const result = await safetyService.createSos(
      request.authSession!.userId,
      data,
    );
    return success(result, "SOS triggered successfully");
  },

  async getSos(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const result = await safetyService.getSos(
      request.authSession!.userId,
      sosId,
    );
    return success(result, "SOS details retrieved");
  },

  async listSos(request: FastifyRequest) {
    const query = parse(
      z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      request.query,
    );
    const result = await safetyService.listSos(
      request.authSession!.userId,
      query.page,
      query.limit,
    );
    return success(result.items, "SOS history retrieved", {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / query.limit),
    });
  },

  async activeSos(_request: FastifyRequest) {
    const result = await safetyService.activeSos(_request.authSession!.userId);
    return success(result, "Active SOS retrieved");
  },

  async getSosMessages(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const result = await safetyService.getMessages(
      request.authSession!.userId,
      sosId,
    );
    return success(result, "SOS messages retrieved");
  },

  async createSosMessage(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const input = parse(schemas.safetyMessageCreate, request.body);
    const result = await safetyService.createSosMessage(
      request.authSession!.userId,
      sosId,
      input,
    );
    return success(result, "SOS message sent");
  },

  async markSosMessagesRead(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const result = await safetyService.markMessagesRead(
      request.authSession!.userId,
      sosId,
    );
    return success(result, "SOS messages marked as read");
  },

  async cancelSos(request: FastifyRequest) {
    const { sosId } = request.params as { sosId: string };
    const result = await safetyService.cancelSos(
      request.authSession!.userId,
      sosId,
    );
    return success(result, "SOS cancelled successfully");
  },

  async reportIncident(request: FastifyRequest) {
    const data = parse(schemas.safetyIncidentReport, request.body);
    const result = await safetyService.reportIncident(
      request.authSession!.userId,
      {
        bookingId: data.bookingId!,
        type: data.type,
        description: data.description,
      },
    );
    return success(result, "Incident reported successfully");
  },

  async listEmergencyContacts(request: FastifyRequest) {
    const result = await safetyService.listEmergencyContacts(
      request.authSession!.userId,
    );
    return success(result, "Emergency contacts retrieved");
  },

  async createEmergencyContact(request: FastifyRequest) {
    const data = parse(schemas.emergencyContactCreate, request.body);
    const result = await safetyService.createEmergencyContact(
      request.authSession!.userId,
      data,
    );
    return success(result, "Emergency contact added successfully");
  },

  async updateEmergencyContact(request: FastifyRequest) {
    const { contactId } = request.params as { contactId: string };
    const data = parse(schemas.emergencyContactCreate.partial(), request.body);
    const result = await safetyService.updateEmergencyContact(
      request.authSession!.userId,
      contactId,
      data,
    );
    return success(result, "Emergency contact updated successfully");
  },

  async deleteEmergencyContact(request: FastifyRequest) {
    const { contactId } = request.params as { contactId: string };
    const result = await safetyService.deleteEmergencyContact(
      request.authSession!.userId,
      contactId,
    );
    return success(result, "Emergency contact deleted successfully");
  },

  // 14. Settings
  async getSettings(request: FastifyRequest) {
    const result = await settingsService.get(request.authSession!.userId);
    return success(result, "Preferences retrieved");
  },

  async updateSettings(request: FastifyRequest) {
    const data = parse(schemas.preferencesUpdate, request.body);
    const result = await settingsService.update(
      request.authSession!.userId,
      data,
    );
    return success(result, "Preferences updated");
  },

  // 15. Account Deletion & Data Export
  async requestDeletion(request: FastifyRequest) {
    const result = await accountService.requestDeletion(
      request.authSession!.userId,
    );
    return success(result, "Account deletion requested successfully");
  },

  async cancelDeletion(request: FastifyRequest) {
    const result = await accountService.cancelDeletion(
      request.authSession!.userId,
    );
    return success(result, "Account deletion cancelled successfully");
  },

  async requestDataExport(request: FastifyRequest) {
    const result = await accountService.requestDataExport(
      request.authSession!.userId,
    );
    return success(result, "Data export requested successfully");
  },

  async getDataExport(request: FastifyRequest) {
    const { exportId } = request.params as { exportId: string };
    const result = await accountService.getDataExport(
      request.authSession!.userId,
      exportId,
    );
    return success(result, "Data export status retrieved");
  },

  // 16. Home Screen
  async getHome(request: FastifyRequest) {
    const userId = request.authSession!.userId;
    const [profile, activeBooking, notifications] = await Promise.all([
      profileService.getProfile(userId),
      bookingService.getActiveBooking(userId).catch(() => null),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return success(
      {
        profile,
        activeBooking,
        unreadNotifications: notifications,
      },
      "Home screen data retrieved",
    );
  },

  async getNearbyVehicles(request: FastifyRequest) {
    const { latitude, longitude } = request.query as {
      latitude: string;
      longitude: string;
    };
    if (!latitude || !longitude) {
      throw new Error("latitude and longitude are required");
    }
    const result = await bookingService.listCategories(
      request.authSession!.userId,
      parseFloat(latitude),
      parseFloat(longitude),
    );
    return success(result, "Nearby vehicles retrieved");
  },

  // 17. Booking status, vehicle details, tracking, ETA
  async getBookingStatus(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const customer = await prisma.customerProfile.findUnique({
      where: { userId: request.authSession!.userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      select: { id: true, status: true, updatedAt: true },
    });
    if (!booking) throw new Error("Booking not found");
    return success(booking, "Booking status retrieved");
  },

  async getBookingList(request: FastifyRequest) {
    const userId = request.authSession!.userId;
    const query = request.query as {
      status?: string;
      page?: string;
      limit?: string;
    };
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const page = parseInt(query.page || "1", 10);
    const limit = Math.min(parseInt(query.limit || "20", 10), 50);
    const skip = (page - 1) * limit;
    const where: any = { customerId: customer.id };
    if (query.status) {
      where.status = query.status;
    }
    const [bookings, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          status: true,
          pickupAddress: true,
          pickupLatitude: true,
          pickupLongitude: true,
          dropAddress: true,
          dropLatitude: true,
          dropLongitude: true,
          createdAt: true,
          finalFare: true,
          vehicleCategory: { select: { name: true, imageUrl: true } },
          assignedDriver: {
            select: {
              user: { select: { displayName: true } },
              profileImageUrl: true,
            },
          },
          assignedVehicle: {
            select: {
              id: true,
              make: true,
              model: true,
              color: true,
              registrationNo: true,
              category: { select: { name: true, imageUrl: true } },
            },
          },
          trip: { select: { startedAt: true, completedAt: true } },
          payments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true, method: true },
          },
        },
      }),
      prisma.booking.count({ where }),
    ]);
    const formattedBookings = bookings.map((booking) => ({
      ...booking,
      vehicleCategory: {
        ...booking.vehicleCategory,
        imageUrl: buildFileUrl(request, booking.vehicleCategory.imageUrl),
      },
      assignedDriver: booking.assignedDriver
        ? {
            ...booking.assignedDriver,
            profileImageUrl: buildFileUrl(
              request,
              booking.assignedDriver.profileImageUrl,
            ),
          }
        : null,
      vehicle: booking.assignedVehicle
        ? {
            id: booking.assignedVehicle.id,
            name: `${booking.assignedVehicle.make} ${booking.assignedVehicle.model}`,
            make: booking.assignedVehicle.make,
            model: booking.assignedVehicle.model,
            color: booking.assignedVehicle.color,
            number: booking.assignedVehicle.registrationNo,
            category: booking.assignedVehicle.category?.name || "Unknown",
            images: booking.assignedVehicle.category?.imageUrl
              ? [
                  buildFileUrl(
                    request,
                    booking.assignedVehicle.category.imageUrl,
                  ),
                ]
              : [],
          }
        : null,
      dropLocation: {
        address: booking.dropAddress,
        latitude: Number(booking.dropLatitude),
        longitude: Number(booking.dropLongitude),
      },
      pickupLocation: {
        address: booking.pickupAddress,
        latitude: Number(booking.pickupLatitude),
        longitude: Number(booking.pickupLongitude),
      },
      dateTime: {
        bookingCreatedAt: booking.createdAt,
        pickupTime: booking.trip?.startedAt ?? null,
        dropTime: booking.trip?.completedAt ?? null,
      },
      fare: {
        finalFare: booking.finalFare,
      },
    }));
    return success(
      { bookings: formattedBookings, meta: { page, limit, total } },
      "Bookings retrieved",
    );
  },

  async getBookingDetails(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      include: {
        vehicleCategory: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
        assignedDriver: {
          select: {
            id: true,
            profileImageUrl: true,
            averageRating: true,
            totalTrips: true,
            user: { select: { displayName: true, phone: true } },
          },
        },
        assignedVehicle: true,
        trip: {
          include: {
            fareBreakdown: true,
            invoice: true,
            ratings: { where: { authorUserId: userId } },
          },
        },
        fareBreakdowns: true,
        payments: true,
        cancellation: true,
        coupon: {
          select: { code: true, discountType: true, discountValue: true },
        },
      },
    });
    if (!booking) throw new Error("Booking not found");
    return success(booking, "Booking details retrieved");
  },

  async getBookingVehicle(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getDriverDetails(
      request.authSession!.userId,
      bookingId,
    );
    return success(result.vehicle, "Vehicle details retrieved");
  },

  async getDriverLocation(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getLiveDriverLocation(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Driver location retrieved");
  },

  async getNearbyDriversForBooking(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getNearbyDriversForBooking(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Nearby drivers retrieved");
  },

  async getPickupEta(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getLiveDriverLocation(
      request.authSession!.userId,
      bookingId,
    );
    return success(
      { etaMinutes: result.etaMinutes, distanceMeters: result.distanceMeters },
      "Pickup ETA retrieved",
    );
  },

  async retryDriverSearch(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
    });
    if (!booking) throw new Error("Booking not found");
    if (booking.status !== "NO_DRIVER_FOUND")
      throw new Error("Can only retry search for NO_DRIVER_FOUND bookings");
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "SEARCHING_DRIVER" },
    });
    return success(
      { bookingId, status: "SEARCHING_DRIVER" },
      "Driver search retried",
    );
  },

  // 18. Pickup OTP
  async getPickupOtpStatus(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const trip = await prisma.trip.findFirst({
      where: { booking: { id: bookingId, customerId: customer.id } },
      select: {
        id: true,
        status: true,
        verificationOtpExpiresAt: true,
        otpAttempts: true,
      },
    });
    if (!trip) throw new Error("Trip not found for booking");
    return success(
      {
        tripId: trip.id,
        tripStatus: trip.status,
        otpExpiresAt: trip.verificationOtpExpiresAt,
        otpAttemptsUsed: trip.otpAttempts,
      },
      "Pickup OTP status retrieved",
    );
  },

  async sendPickupOtp(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const trip = await prisma.trip.findFirst({
      where: { booking: { id: bookingId, customerId: customer.id } },
    });
    if (!trip) throw new Error("Trip not found");
    // OTP is generated server-side when driver is assigned/arrives; customer just sees the status
    return success(
      { message: "OTP has been sent to your registered number" },
      "Pickup OTP sent",
    );
  },

  // 19. Booking Tracking
  async getBookingTracking(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getLiveDriverLocation(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Tracking data retrieved");
  },

  async getBookingRoute(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      select: {
        routePolyline: true,
        pickupAddress: true,
        dropAddress: true,
        pickupLatitude: true,
        pickupLongitude: true,
        dropLatitude: true,
        dropLongitude: true,
      },
    });
    if (!booking) throw new Error("Booking not found");
    return success(booking, "Route retrieved");
  },

  async getBookingLiveStatus(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      select: {
        id: true,
        status: true,
        assignedDriverId: true,
        trip: { select: { id: true, status: true, startedAt: true } },
      },
    });
    if (!booking) throw new Error("Booking not found");
    const driverLocation = booking.assignedDriverId
      ? await redis.get(`location:driver:${booking.assignedDriverId}`)
      : null;
    return success(
      {
        booking,
        driverLocation: driverLocation ? JSON.parse(driverLocation) : null,
      },
      "Live status retrieved",
    );
  },

  // 20. Trip Share & Booking Safety
  async shareTrip(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const input = request.body as {
      recipientName?: string;
      recipientPhone?: string;
    };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
    });
    if (!booking) throw new Error("Booking not found");

    const { randomBytes, createHash } = await import("node:crypto");
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const share = await prisma.tripShare.create({
      data: {
        bookingId,
        tokenHash,
        expiresAt,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
      },
    });
    return success(
      {
        shareId: share.id,
        trackingUrl: `${process.env.APP_URL || "https://app.tuktuk.com"}/track/${token}`,
        expiresAt,
      },
      "Trip share created",
    );
  },

  async getTripShare(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const shares = await prisma.tripShare.findMany({
      where: {
        bookingId,
        booking: { customerId: customer.id },
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    return success(shares, "Trip shares retrieved");
  },

  async createSosForBooking(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const data = parse(schemas.safetySosCreate, {
      ...(request.body as any),
      bookingId,
    });
    const result = await safetyService.createSos(
      request.authSession!.userId,
      data,
    );
    return success(result, "SOS triggered successfully");
  },

  async reportSafetyIssue(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const data = parse(schemas.safetyIncidentReport, request.body);
    const result = await safetyService.reportIncident(
      request.authSession!.userId,
      {
        bookingId,
        type: data.type,
        description: data.description,
      },
    );
    return success(result, "Safety issue reported");
  },

  // 21. Booking chat messages
  async getBookingMessages(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
    });
    if (!booking) throw new Error("Booking not found");

    const messages = await prisma.chatMessage.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
    });
    return success(messages, "Messages retrieved");
  },

  async sendBookingMessage(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const { message } = request.body as { message: string };
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw errors.notFound("Customer not found");
    const data = await chatService.send({
      userId,
      bookingId,
      message,
      senderType: "CUSTOMER",
      customerId: customer.id,
    });
    return success(data, "Message sent");
  },

  // 22. Fare Breakdown and Invoice
  async getFareBreakdown(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getFareDetails(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Fare breakdown retrieved");
  },

  async getInvoice(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      select: {
        id: true,
        pickupAddress: true,
        pickupLatitude: true,
        pickupLongitude: true,
        dropAddress: true,
        dropLatitude: true,
        dropLongitude: true,
        trip: {
          select: {
            id: true,
            invoice: true,
            driver: {
              select: {
                id: true,
                profileImageUrl: true,
                averageRating: true,
                user: { select: { displayName: true } },
              },
            },
            vehicle: {
              select: {
                id: true,
                make: true,
                model: true,
                registrationNo: true,
                color: true,
                category: { select: { name: true, imageUrl: true } },
              },
            },
          },
        },
      },
    });
    if (!booking) throw new Error("Booking not found");
    if (!booking.trip?.invoice) return success(null, "Invoice retrieved");
    return success(
      {
        ...booking.trip.invoice,
        tripDetails: {
          rideId: booking.trip.id,
          pickupLocation: {
            address: booking.pickupAddress,
            latitude: Number(booking.pickupLatitude),
            longitude: Number(booking.pickupLongitude),
          },
          dropLocation: {
            address: booking.dropAddress,
            latitude: Number(booking.dropLatitude),
            longitude: Number(booking.dropLongitude),
          },
          driver: {
            id: booking.trip.driver.id,
            name: booking.trip.driver.user.displayName,
            profileImageUrl: buildFileUrl(
              request,
              booking.trip.driver.profileImageUrl,
            ),
            rating: Number(booking.trip.driver.averageRating),
          },
          vehicle: {
            id: booking.trip.vehicle.id,
            name: `${booking.trip.vehicle.make} ${booking.trip.vehicle.model}`,
            make: booking.trip.vehicle.make,
            model: booking.trip.vehicle.model,
            number: booking.trip.vehicle.registrationNo,
            color: booking.trip.vehicle.color,
            category: booking.trip.vehicle.category?.name || "Unknown",
            images: booking.trip.vehicle.category?.imageUrl
              ? [buildFileUrl(request, booking.trip.vehicle.category.imageUrl)]
              : [],
          },
        },
      },
      "Invoice retrieved",
    );
  },

  async downloadInvoice(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      select: { trip: { select: { invoice: true } } },
    });
    if (!booking || !booking.trip?.invoice)
      throw new Error("Invoice not found");
    return success(
      { downloadUrl: booking.trip.invoice.fileKey },
      "Invoice download URL retrieved",
    );
  },

  // 23. Payment
  async processPayment(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const data = parse(schemas.createPaymentOrder, request.body);
    const key = String(
      request.headers["x-idempotency-key"] || `pay-${bookingId}-${Date.now()}`,
    );
    const method = (data as any).method || "CASH";
    const result = await paymentService.createBookingOrder(
      request.authSession!.userId,
      bookingId,
      method,
      key,
    );
    return success(result, "Payment processed");
  },

  async getPaymentStatus(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const result = await bookingService.getPaymentDetails(
      request.authSession!.userId,
      bookingId,
    );
    return success(result, "Payment status retrieved");
  },

  async retryPayment(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const key = String(
      request.headers["x-idempotency-key"] ||
        `retry-pay-${bookingId}-${Date.now()}`,
    );
    // Cancel old failed payment and create a new one
    const result = await paymentService.createBookingOrder(
      request.authSession!.userId,
      bookingId,
      "CASH",
      key,
    );
    return success(result, "Payment retry initiated");
  },

  // 24. Rating for booking (via trip)
  async getBookingRating(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const trip = await prisma.trip.findFirst({
      where: { booking: { id: bookingId, customerId: customer.id } },
      include: { ratings: { where: { authorUserId: userId } } },
    });
    return success(trip?.ratings[0] || null, "Rating retrieved");
  },

  async createBookingRating(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const data = parse(schemas.ratingCreate, request.body);
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const trip = await prisma.trip.findFirst({
      where: { booking: { id: bookingId, customerId: customer.id } },
    });
    if (!trip) throw new Error("Trip not found for this booking");
    const result = await ratingService.create(userId, trip.id, data);
    return success(result, "Rating submitted");
  },

  async addTip(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { amount } = request.body as { amount: number };
    const userId = request.authSession!.userId;
    if (!amount || amount <= 0) throw new Error("Invalid tip amount");

    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      include: {
        fareBreakdowns: { orderBy: { createdAt: "desc" }, take: 1 },
        trip: true,
      },
    });
    if (!booking) throw new Error("Booking not found");

    const latestFare = booking.fareBreakdowns[0];
    if (!latestFare) throw new Error("Fare breakdown not found");

    await prisma.$transaction(async (tx) => {
      // Update the fare breakdown
      await tx.fareBreakdown.update({
        where: { id: latestFare.id },
        data: {
          tipAmount: { increment: amount },
          total: { increment: amount },
        },
      });

      // Update the booking estimated fare and total amount (if trip is completed)
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          estimatedFare: { increment: amount },
        },
      });

      // Update trip total if it exists
      if (booking.trip) {
        await tx.trip.update({
          where: { id: booking.trip.id },
          data: {
            tipAmount: { increment: amount },
          },
        });
      }
    });

    const { emitBooking } = require("../../infrastructure/realtime");
    emitBooking(bookingId, "booking:fare_updated", { type: "TIP", amount });

    return success({ bookingId, tipAmount: amount }, "Tip added successfully");
  },

  // 25. Refund
  async requestRefund(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { reason, amount } = request.body as {
      reason: string;
      amount?: number;
    };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      include: {
        payments: { where: { status: { in: ["CAPTURED"] } }, take: 1 },
      },
    });
    if (!booking) throw new Error("Booking not found");
    const payment = booking.payments[0];
    if (!payment) throw new Error("No captured payment found for this booking");
    const { randomUUID } = await import("node:crypto");
    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        status: "REQUESTED",
        amount: amount
          ? new (await import("@prisma/client")).Prisma.Decimal(amount)
          : payment.amountPaid,
        reason,
        idempotencyKey: randomUUID(),
      },
    });
    return success(refund, "Refund request submitted");
  },

  async getRefundStatus(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      include: { payments: { include: { refunds: true } } },
    });
    if (!booking) throw new Error("Booking not found");
    const refunds = booking.payments.flatMap((p) => p.refunds);
    return success(refunds, "Refund status retrieved");
  },

  // 26. Booking-level support
  async reportBooking(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const data = parse(schemas.supportTicketCreate, request.body);
    const result = await supportService.createTicket(
      request.authSession!.userId,
      {
        categoryId: data.categoryId,
        subject: data.subject ?? data.title ?? "Booking Report",
        description: data.description,
        bookingId,
      },
    );
    return success(result, "Booking report submitted");
  },

  async reportLostItem(request: FastifyRequest) {
    const { bookingId } = request.params as { bookingId: string };
    const { description } = request.body as { description: string };
    const result = await supportService.createTicket(
      request.authSession!.userId,
      {
        categoryId: (request.body as any).categoryId || undefined,
        subject: "Lost Item Report",
        description: description || "I lost an item during this trip",
        bookingId,
      },
    );
    return success(result, "Lost item report submitted");
  },

  // 27. Scheduled Rides
  async listScheduledRides(request: FastifyRequest) {
    const {
      status: statusFilter,
      page,
      limit,
    } = parse(schemas.scheduledRidesList, request.query);
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw errors.notFound("Customer profile not found");

    const status: Prisma.EnumBookingStatusFilter | BookingStatus =
      !statusFilter || statusFilter === "UPCOMING"
        ? {
            in: [
              BookingStatus.PENDING,
              BookingStatus.SEARCHING_DRIVER,
              BookingStatus.DRIVER_ASSIGNED,
              BookingStatus.DRIVER_ARRIVING,
              BookingStatus.DRIVER_ARRIVED,
            ],
          }
        : statusFilter;

    const where: Prisma.BookingWhereInput = {
      customerId: customer.id,
      type: "SCHEDULED",
      status,
    };
    const include = {
      scheduledBooking: true,
      vehicleCategory: { select: { id: true, name: true } },
      assignedVehicle: {
        select: {
          id: true,
          registrationNo: true,
          category: { select: { id: true, name: true } },
        },
      },
      assignedDriver: {
        select: {
          id: true,
          user: { select: { displayName: true, phone: true } },
        },
      },
    } satisfies Prisma.BookingInclude;
    const [rides, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include,
        orderBy: { scheduledAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);
    return success(
      {
        rides: rides.map((ride) => ({
          id: ride.id,
          bookingId: ride.id,
          status: ride.status,
          scheduledAt: ride.scheduledAt?.toISOString() ?? null,
          pickup: {
            address: ride.pickupAddress,
            latitude: Number(ride.pickupLatitude),
            longitude: Number(ride.pickupLongitude),
          },
          drop: {
            address: ride.dropAddress,
            latitude: Number(ride.dropLatitude),
            longitude: Number(ride.dropLongitude),
          },
          vehicleCategory: ride.vehicleCategory
            ? { id: ride.vehicleCategory.id, name: ride.vehicleCategory.name }
            : null,
          vehicle: ride.assignedVehicle
            ? {
                id: ride.assignedVehicle.id,
                vehicleNumber: ride.assignedVehicle.registrationNo,
                category: ride.assignedVehicle.category?.name ?? null,
              }
            : null,
          driver: ride.assignedDriver
            ? {
                id: ride.assignedDriver.id,
                name: ride.assignedDriver.user.displayName,
                phone: ride.assignedDriver.user.phone
                  ? `${ride.assignedDriver.user.phone.slice(0, 2)}${"*".repeat(
                      Math.max(4, ride.assignedDriver.user.phone.length - 4),
                    )}${ride.assignedDriver.user.phone.slice(-2)}`
                  : null,
              }
            : null,
          estimatedFare: ride.estimatedFare ? Number(ride.estimatedFare) : null,
          rescheduleCount: ride.scheduledBooking?.rescheduleCount ?? 0,
          reminderSentAt:
            ride.scheduledBooking?.reminderSentAt?.toISOString() ?? null,
          activatedAt:
            ride.scheduledBooking?.activatedAt?.toISOString() ?? null,
          dispatchStartedAt:
            ride.scheduledBooking?.dispatchStartedAt?.toISOString() ?? null,
          createdAt: ride.createdAt.toISOString(),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      "Scheduled rides retrieved",
    );
  },

  async getScheduledRide(request: FastifyRequest) {
    const { scheduleId } = request.params as { scheduleId: string };
    const userId = request.authSession!.userId;
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");
    const ride = await prisma.booking.findFirst({
      where: { id: scheduleId, customerId: customer.id, type: "SCHEDULED" },
      include: { scheduledBooking: true, vehicleCategory: true },
    });
    if (!ride) throw new Error("Scheduled ride not found");
    return success(ride, "Scheduled ride retrieved");
  },

  async updateScheduledRide(request: FastifyRequest) {
    const { scheduleId } = request.params as { scheduleId: string };
    const data = parse(schemas.bookingReschedule, request.body);
    const result = await bookingService.rescheduleBooking(
      request.authSession!.userId,
      scheduleId,
      data.scheduledAt,
    );
    return success(result, "Scheduled ride updated");
  },

  async cancelScheduledRide(request: FastifyRequest) {
    const { scheduleId } = request.params as { scheduleId: string };
    const data = parse(schemas.bookingCancel, request.body);
    const result = await bookingService.cancel(
      request.authSession!.userId,
      scheduleId,
      data,
    );
    return success(result, "Scheduled ride cancelled");
  },

  async getRentalPackages(request: FastifyRequest) {
    const { categoryId } = request.query as { categoryId?: string };
    const packages = await customerRentalService.getPackages(categoryId);
    return success(packages, "Rental packages retrieved");
  },

  async getOutstationPricing(request: FastifyRequest) {
    const { categoryId } = request.query as { categoryId?: string };
    const pricing =
      await customerRentalService.getOutstationPricing(categoryId);
    return success(pricing, "Outstation pricing retrieved");
  },
};
