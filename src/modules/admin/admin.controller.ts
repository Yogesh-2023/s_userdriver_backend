import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { logAdmin } from "../../common/chalk-logger";
import { errors } from "../../common/errors";
import { env } from "../../config/env";
import { parse } from "../../common/validation";
import { success } from "../../common/response";
import { sessionCookieOptions } from "../../common/session-cookie";
import { AuditLogsService } from "../audit-logs/service";
import { AdminService } from "./admin.service";
import * as schemas from "./admin.validation";
import type { AdminActionContext } from "./admin.constants";
import { AdminAuthService } from "./services/admin-auth.service";
import { AdminBookingService } from "./services/admin-booking.service";
import { AdminConfigService } from "./services/admin-config.service";
import { AdminCustomerService } from "./services/admin-customer.service";
import { AdminDashboardService } from "./services/admin-dashboard.service";
import { AdminDriverService } from "./services/admin-driver.service";
import { AdminFareService } from "./services/admin-fare.service";
import { AdminNotificationService } from "./services/admin-notification.service";
import { AdminReportService } from "./services/admin-report.service";
import { AdminSafetyService } from "./services/admin-safety.service";
import { AdminSupportService } from "./services/admin-support.service";
import { AdminTripService } from "./services/admin-trip.service";
import { AdminVehicleService } from "./services/admin-vehicle.service";
import { AdminPaymentService } from "./services/admin-payment.service";
import { AdminRefundService } from "./services/admin-refund.service";
import { AdminWalletService } from "./services/admin-wallet.service";
import { AdminPayoutService } from "./services/admin-payout.service";
import { prisma } from "../../database/prisma";
import { AdminCouponService } from "./services/admin-coupon.service";
import { AdminReferralService } from "./services/admin-referral.service";
import { AdminReviewService } from "./services/admin-review.service";
import { AdminIncentiveService } from "./services/admin-incentive.service";
import { AdminDispatchService } from "./services/admin-dispatch.service";
import { AdminSurgeService } from "./services/admin-surge.service";
import { AdminSearchService } from "./services/admin-search.service";
import { AdminZoneService } from "./services/admin-zone.service";
import { uploadAdminProfileImage } from "../../integrations/storage";

const auth = new AdminAuthService();
const admins = new AdminService();
const customers = new AdminCustomerService();
const drivers = new AdminDriverService();
const vehicles = new AdminVehicleService();
const bookings = new AdminBookingService();
const trips = new AdminTripService();
const fares = new AdminFareService();
const notifications = new AdminNotificationService();
const reports = new AdminReportService();
const safety = new AdminSafetyService();
const support = new AdminSupportService();
const config = new AdminConfigService();
const dashboard = new AdminDashboardService();
const auditLogs = new AuditLogsService();
const paymentService = new AdminPaymentService();
const refundService = new AdminRefundService();
const walletService = new AdminWalletService();
const payoutService = new AdminPayoutService();
const couponService = new AdminCouponService();
const referralService = new AdminReferralService();
const reviewService = new AdminReviewService();
const incentiveService = new AdminIncentiveService();
const dispatchService = new AdminDispatchService();
const surgeService = new AdminSurgeService();
const searchService = new AdminSearchService();
const zoneService = new AdminZoneService();

const param = (request: FastifyRequest, name: string) =>
  parse(z.object({ [name]: z.uuid() }), request.params)[name] as string;

const pageResult = (
  items: unknown,
  total: number,
  page: number,
  limit: number,
  message: string,
) =>
  success(items, message, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });

const actor = (request: FastifyRequest): AdminActionContext => ({
  adminId: request.admin!.id,
  userId: request.admin!.userId,
  role: request.admin!.roles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : "ADMIN",
  requestId: request.id,
  ipAddress: request.ip,
  userAgent: request.headers["user-agent"],
});

const isSuper = (request: FastifyRequest) =>
  request.admin!.roles.includes("SUPER_ADMIN");

export const adminController = {
  async login(request: FastifyRequest, reply: FastifyReply) {
    const input = parse(schemas.adminLogin, request.body);
    const result = await auth.login(input, {
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });
    reply.setCookie(
      env.COOKIE_NAME,
      result.cookieValue,
      sessionCookieOptions(),
    );
    const { id, userId, roleId } = result.admin as any;
    const sanitizedAdmin = { id, userId, roleId };
    return {
      success: true,
      message: "Admin login successful",
      data: { admin: sanitizedAdmin },
    };
  },

  async logout(request: FastifyRequest, reply: FastifyReply) {
    await auth.logout(
      request.authSession!.sessionId,
      request.admin!.userId,
      actor(request),
    );
    reply.clearCookie(env.COOKIE_NAME, {
      path: "/",
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
    return {
      success: true,
      message: "Admin logged out",
    };
  },

  async logoutAll(request: FastifyRequest, reply: FastifyReply) {
    const count = await auth.logoutAll(request.admin!.userId, actor(request));
    reply.clearCookie(env.COOKIE_NAME, {
      path: "/",
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
    return success({ revokedSessions: count }, "All admin sessions revoked");
  },

  async me(request: FastifyRequest) {
    const profile = await auth.me(request.admin!.userId);
    return success(profile, "Admin profile retrieved");
  },

  async sessions(request: FastifyRequest) {
    return success(
      await auth.listSessions(request.admin!.userId),
      "Admin sessions retrieved",
    );
  },

  async revokeSession(request: FastifyRequest) {
    await auth.revokeSession(
      param(request, "sessionId"),
      request.admin!.userId,
    );
    return success(null, "Admin session revoked");
  },

  async forgotPassword(request: FastifyRequest) {
    const { email } = parse(schemas.forgotPassword, request.body);
    const result = await auth.forgotPassword(email, {
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });
    return success(result, "Forgot password processed");
  },

  async verifyResetOtp(request: FastifyRequest) {
    const { email, otp } = parse(schemas.verifyOtp, request.body);
    const result = await auth.verifyResetOtp(email, otp);
    return success(result, "OTP verified");
  },

  async resetPassword(request: FastifyRequest) {
    const { email, resetToken, newPassword } = parse(
      schemas.resetPassword,
      request.body,
    );
    await auth.resetPassword(email, resetToken, newPassword, actor(request));
    return success(null, "Password reset successful");
  },

  async changePassword(request: FastifyRequest) {
    const { oldPassword, newPassword } = parse(
      schemas.changePassword,
      request.body,
    );
    await auth.changePassword(
      request.admin!.userId,
      oldPassword,
      newPassword,
      actor(request),
    );
    return success(null, "Password changed successfully");
  },

  async updateProfile(request: FastifyRequest) {
    const input = parse(schemas.adminUpdateProfile, request.body);
    const result = await admins.update(
      request.admin!.id,
      input,
      actor(request),
    );
    return success(result, "Profile updated");
  },

  async updateProfileImage(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }

    const body: any = request.body;
    let file = body.profileImage;
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

    if (!imageBuffer || !imageBuffer.length) {
      throw errors.badRequest("profileImage file is required");
    }

    const result = await uploadAdminProfileImage(
      request.authSession!.userId,
      contentType,
      imageBuffer,
    );

    return success(
      { profileImageUrl: result.profileImageUrl },
      "Profile image uploaded",
    );
  },

  async listAdmins(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await admins.list(query.page, query.limit);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Admins retrieved",
    );
  },

  async createAdmin(request: FastifyRequest, reply: FastifyReply) {
    const input = parse(schemas.adminCreate, request.body);
    const result = await admins.create(input, actor(request));
    return reply.code(201).send(success(result, "Admin created"));
  },

  async updateAdmin(request: FastifyRequest) {
    return success(
      await admins.update(
        param(request, "adminId"),
        parse(schemas.adminUpdate, request.body),
        actor(request),
      ),
      "Admin updated",
    );
  },

  async updateAdminPassword(request: FastifyRequest) {
    const input = parse(schemas.adminPasswordUpdate, request.body);
    return success(
      await admins.updatePassword(
        param(request, "adminId"),
        input.password,
        input.reason,
        actor(request),
      ),
      "Admin password updated",
    );
  },

  async updateAdminStatus(request: FastifyRequest) {
    const input = parse(schemas.accountStatusUpdate, request.body);
    return success(
      await admins.updateStatus(
        param(request, "adminId"),
        input.status,
        input.reason,
        actor(request),
      ),
      "Admin status updated",
    );
  },

  async permissionMatrix() {
    return success(
      await admins.permissionMatrix(),
      "Permission matrix retrieved",
    );
  },

  async listCustomers(request: FastifyRequest) {
    const query = parse(schemas.customerList, request.query);
    const result = await customers.list(query);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Customers retrieved",
    );
  },

  async getCustomer(request: FastifyRequest) {
    return success(
      await customers.get(param(request, "customerId")),
      "Customer retrieved",
    );
  },

  async updateCustomer(request: FastifyRequest) {
    return success(
      await customers.update(
        param(request, "customerId"),
        parse(schemas.customerUpdate, request.body),
        actor(request),
      ),
      "Customer updated",
    );
  },

  async updateCustomerStatus(request: FastifyRequest) {
    return success(
      await customers.updateStatus(
        param(request, "customerId"),
        parse(schemas.accountStatusUpdate, request.body),
        actor(request),
      ),
      "Customer status updated",
    );
  },

  async listCustomerSessions(request: FastifyRequest) {
    return success(
      await customers.listSessions(param(request, "customerId")),
      "Customer sessions retrieved",
    );
  },

  async revokeCustomerSession(request: FastifyRequest) {
    await customers.revokeSession(
      param(request, "customerId"),
      param(request, "sessionId"),
      actor(request),
    );
    return success(null, "Customer session revoked");
  },

  async logoutAllCustomerSessions(request: FastifyRequest) {
    const count = await customers.logoutAll(
      param(request, "customerId"),
      actor(request),
    );
    return success({ revokedSessions: count }, "All customer sessions revoked");
  },

  async customerRelated(
    request: FastifyRequest,
    kind: "bookings" | "trips" | "payments" | "ratings" | "support",
  ) {
    const query = parse(schemas.pagination, request.query);
    const customerId = param(request, "customerId");
    const methods = {
      bookings: customers.listBookings.bind(customers),
      trips: customers.listTrips.bind(customers),
      payments: customers.listPayments.bind(customers),
      ratings: customers.listRatings.bind(customers),
      support: customers.listSupportTickets.bind(customers),
    };
    const [items, total] = await methods[kind](
      customerId,
      query.page,
      query.limit,
    );
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      `Customer ${kind} retrieved`,
    );
  },

  async listDrivers(request: FastifyRequest) {
    const query = parse(schemas.driverList, request.query);
    const result = await drivers.list(query);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Drivers retrieved",
    );
  },

  async getDriver(request: FastifyRequest) {
    return success(
      await drivers.get(param(request, "driverId")),
      "Driver retrieved",
    );
  },

  async updateDriver(request: FastifyRequest) {
    return success(
      await drivers.update(
        param(request, "driverId"),
        parse(schemas.driverUpdate, request.body),
        actor(request),
      ),
      "Driver updated",
    );
  },

  async updateDriverProfileImage(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest("Content-Type must be multipart/form-data");
    }

    const body: any = request.body;
    let file = body.profileImage;
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

    const result = await drivers.updateProfileImage(
      param(request, "driverId"),
      contentType,
      imageBuffer,
      actor(request),
    );

    return success(
      { profileImageUrl: result.profileImageUrl },
      "Driver profile image uploaded",
    );
  },

  async updateDriverStatus(request: FastifyRequest) {
    return success(
      await drivers.updateStatus(
        param(request, "driverId"),
        parse(schemas.accountStatusUpdate, request.body),
        actor(request),
      ),
      "Driver status updated",
    );
  },

  async verifyDriver(request: FastifyRequest) {
    return success(
      await drivers.verify(
        param(request, "driverId"),
        parse(schemas.verificationUpdate, request.body),
        actor(request),
      ),
      "Driver verification updated",
    );
  },

  async bulkReviewDriverKyc(request: FastifyRequest) {
    const input = parse(
      z.object({
        action: z.enum(["APPROVE", "REJECT"]),
        reason: z.string().optional(),
      }),
      request.body,
    );
    return success(
      await drivers.bulkReviewKyc(
        param(request, "driverId"),
        input.action,
        input.reason,
        actor(request),
      ),
      `KYC documents ${input.action.toLowerCase()}ed in bulk`,
    );
  },

  async reviewDriverKyc(request: FastifyRequest) {
    return success(
      await drivers.reviewKyc(param(request, "driverId"), actor(request)),
      "KYC review initiated",
    );
  },

  async approveDriverKyc(request: FastifyRequest) {
    const input = parse(schemas.optionalReasonBody, request.body);
    const res = success(
      await drivers.approveKyc(
        param(request, "driverId"),
        input?.reason,
        actor(request),
      ),
      "KYC approved",
    );
    logAdmin("Approved KYC", { driverId: param(request, "driverId") });
    return res;
  },

  async rejectDriverKyc(request: FastifyRequest) {
    const input = parse(schemas.reasonBody, request.body);
    return success(
      await drivers.rejectKyc(
        param(request, "driverId"),
        input?.reason,
        actor(request),
      ),
      "KYC rejected",
    );
  },

  async listDriverKyc(request: FastifyRequest) {
    const query = parse(
      schemas.pagination.extend({
        status: z
          .enum([
            "PENDING",
            "UNDER_REVIEW",
            "APPROVED",
            "REJECTED",
            "SUSPENDED",
          ])
          .optional(),
        search: z.string().trim().max(120).optional(),
      }),
      request.query,
    );
    const result = await drivers.listKyc(query);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Driver KYC submissions retrieved",
    );
  },

  async getDriverKyc(request: FastifyRequest) {
    return success(
      await drivers.getDriverKyc(param(request, "driverId")),
      "Driver KYC retrieved",
    );
  },

  async getDriverKycSubmission(request: FastifyRequest) {
    return success(
      await drivers.getKycSubmission(param(request, "kycId")),
      "Driver KYC submission retrieved",
    );
  },

  async reviewDriverKycSubmission(request: FastifyRequest) {
    return success(
      await drivers.reviewKycSubmission(
        param(request, "kycId"),
        actor(request),
      ),
      "KYC review initiated",
    );
  },

  async approveDriverKycSubmission(request: FastifyRequest) {
    const input = parse(schemas.optionalReasonBody, request.body);
    return success(
      await drivers.approveKycSubmission(
        param(request, "kycId"),
        input?.reason,
        actor(request),
      ),
      "KYC approved",
    );
  },

  async rejectDriverKycSubmission(request: FastifyRequest) {
    const input = parse(
      z
        .object({
          reason: z.string().trim().min(5).max(500).optional(),
          documents: z
            .array(
              z.object({
                documentType: z.string().trim().min(2).max(50),
                reason: z.string().trim().min(5).max(500).optional(),
              }),
            )
            .max(20)
            .optional(),
        })
        .refine((value) => value.reason || value.documents?.length, {
          message: "A rejection reason or document decision is required",
        }),
      request.body,
    );
    return success(
      await drivers.rejectKycSubmission(
        param(request, "kycId"),
        input.reason,
        input.documents,
        actor(request),
      ),
      "KYC rejected",
    );
  },

  async suspendDriverKycSubmission(request: FastifyRequest) {
    const input = parse(schemas.reasonBody, request.body);
    return success(
      await drivers.suspendKycSubmission(
        param(request, "kycId"),
        input.reason,
        actor(request),
      ),
      "KYC suspended",
    );
  },

  async getDriverKycLogs(request: FastifyRequest) {
    return success(
      await drivers.getKycLogs(param(request, "kycId")),
      "KYC logs retrieved",
    );
  },

  async verifyDriverDocument(request: FastifyRequest) {
    return success(
      await drivers.verifyDocument(
        param(request, "documentId"),
        parse(schemas.documentVerificationUpdate, request.body),
        actor(request),
      ),
      "Document verification updated",
    );
  },

  async forceDriverOffline(request: FastifyRequest) {
    const input = parse(schemas.reasonBody, request.body);
    return success(
      await drivers.forceOffline(
        param(request, "driverId"),
        input?.reason,
        actor(request),
      ),
      "Driver forced offline",
    );
  },

  async getDriverAvailability(request: FastifyRequest) {
    return success(
      await drivers.getAvailability(param(request, "driverId")),
      "Driver availability retrieved",
    );
  },

  async getDriverLiveLocation(request: FastifyRequest) {
    return success(
      await drivers.getLiveLocation(param(request, "driverId")),
      "Driver live location retrieved",
    );
  },

  async getDriverCurrentTrip(request: FastifyRequest) {
    return success(
      await drivers.getCurrentTrip(param(request, "driverId")),
      "Driver current trip retrieved",
    );
  },

  async listDriverSessions(request: FastifyRequest) {
    return success(
      await drivers.listSessions(param(request, "driverId")),
      "Driver sessions retrieved",
    );
  },

  async logoutAllDriverSessions(request: FastifyRequest) {
    const count = await drivers.logoutAll(
      param(request, "driverId"),
      actor(request),
    );
    return success({ revokedSessions: count }, "All driver sessions revoked");
  },

  async assignDriverVehicle(request: FastifyRequest) {
    const input = parse(schemas.assignmentBody, request.body);
    return success(
      await drivers.assignVehicle(
        param(request, "driverId"),
        input.vehicleId,
        input.reason,
        actor(request),
      ),
      "Vehicle assigned",
    );
  },

  async unassignDriverVehicle(request: FastifyRequest) {
    const input = parse(schemas.reasonBody, request.body);
    return success(
      await drivers.unassignVehicle(
        param(request, "driverId"),
        input.reason,
        actor(request),
      ),
      "Vehicle unassigned",
    );
  },

  async driverRelated(
    request: FastifyRequest,
    type: "documents" | "trips" | "ratings",
  ) {
    const driverId = param(request, "driverId");
    if (type === "documents") {
      return success(
        await drivers.documents(driverId),
        "Driver documents retrieved",
      );
    }
    const query = parse(schemas.pagination, request.query);
    const [items, total] =
      type === "trips"
        ? await drivers.trips(driverId, query.page, query.limit)
        : await drivers.ratings(driverId, query.page, query.limit);
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      `Driver ${type} retrieved`,
    );
  },

  async driverEarnings(request: FastifyRequest) {
    const query = parse(z.object(schemas.dateRange), request.query);
    return success(
      await drivers.earnings(param(request, "driverId"), query.from, query.to),
      "Driver earnings retrieved",
    );
  },

  async listVehicles(request: FastifyRequest) {
    const query = parse(schemas.vehicleList, request.query);
    const result = await vehicles.list(query);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Vehicles retrieved",
    );
  },

  async createVehicle(request: FastifyRequest, reply: FastifyReply) {
    const result = await vehicles.create(
      parse(schemas.vehicleCreate, request.body),
      actor(request),
    );
    return reply.code(201).send(success(result, "Vehicle created"));
  },

  async getVehicle(request: FastifyRequest) {
    return success(
      await vehicles.get(param(request, "vehicleId")),
      "Vehicle retrieved",
    );
  },

  async updateVehicle(request: FastifyRequest) {
    return success(
      await vehicles.update(
        param(request, "vehicleId"),
        parse(schemas.vehicleUpdate, request.body),
        actor(request),
      ),
      "Vehicle updated",
    );
  },

  async updateVehicleStatus(request: FastifyRequest) {
    return success(
      await vehicles.updateStatus(
        param(request, "vehicleId"),
        parse(schemas.vehicleStatusUpdate, request.body),
        actor(request),
      ),
      "Vehicle status updated",
    );
  },

  async verifyVehicle(request: FastifyRequest) {
    const res = success(
      await vehicles.verify(
        param(request, "vehicleId"),
        parse(schemas.vehicleVerificationUpdate, request.body),
        actor(request),
      ),
      "Vehicle verification updated",
    );
    logAdmin("Verified Vehicle", {
      vehicleId: param(request, "vehicleId"),
      status: parse(schemas.vehicleVerificationUpdate, request.body).status,
    });
    return res;
  },

  async vehicleDocuments(request: FastifyRequest) {
    return success(
      await vehicles.documents(param(request, "vehicleId")),
      "Vehicle documents retrieved",
    );
  },

  async verifyVehicleDocument(request: FastifyRequest) {
    return success(
      await vehicles.verifyDocument(
        param(request, "documentId"),
        parse(schemas.documentVerificationUpdate, request.body),
        actor(request),
      ),
      "Vehicle document verification updated",
    );
  },

  async vehicleCompliance(request: FastifyRequest) {
    return success(
      await vehicles.compliance(param(request, "vehicleId")),
      "Vehicle compliance retrieved",
    );
  },

  async vehicleTrips(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const [items, total] = await vehicles.trips(
      param(request, "vehicleId"),
      query.page,
      query.limit,
    );
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      "Vehicle trips retrieved",
    );
  },

  async categories() {
    return success(await vehicles.categories(), "Vehicle categories retrieved");
  },

  async createCategory(request: FastifyRequest, reply: FastifyReply) {
    const result = await vehicles.createCategory(
      parse(schemas.categoryBody, request.body),
      actor(request),
    );
    return reply.code(201).send(success(result, "Vehicle category created"));
  },

  async updateCategory(request: FastifyRequest) {
    return success(
      await vehicles.updateCategory(
        param(request, "categoryId"),
        parse(schemas.categoryBody.partial(), request.body),
        actor(request),
      ),
      "Vehicle category updated",
    );
  },

  async getCategory(request: FastifyRequest) {
    return success(
      await vehicles.getCategory(param(request, "categoryId")),
      "Vehicle category retrieved",
    );
  },

  async updateCategoryStatus(request: FastifyRequest) {
    const { isActive } = parse(
      z.object({ isActive: z.boolean() }),
      request.body,
    );
    return success(
      await vehicles.updateCategoryStatus(
        param(request, "categoryId"),
        isActive,
        actor(request),
      ),
      "Vehicle category status updated",
    );
  },

  async deleteCategory(request: FastifyRequest) {
    return success(
      await vehicles.deleteCategory(
        param(request, "categoryId"),
        actor(request),
      ),
      "Vehicle category deleted",
    );
  },

  async brands() {
    return success(await vehicles.brands(), "Vehicle brands retrieved");
  },

  async createBrand(request: FastifyRequest, reply: FastifyReply) {
    const result = await vehicles.createBrand(
      parse(
        z.object({
          name: z.string().min(1).max(100),
          slug: z.string().max(100).optional(),
          isActive: z.boolean().default(true),
        }),
        request.body,
      ),
      actor(request),
    );
    return reply.code(201).send(success(result, "Vehicle brand created"));
  },

  async getBrand(request: FastifyRequest) {
    return success(
      await vehicles.getBrand(param(request, "brandId")),
      "Vehicle brand retrieved",
    );
  },

  async updateBrand(request: FastifyRequest) {
    return success(
      await vehicles.updateBrand(
        param(request, "brandId"),
        parse(
          z.object({
            name: z.string().min(1).max(100).optional(),
            slug: z.string().max(100).optional(),
            isActive: z.boolean().optional(),
          }),
          request.body,
        ),
        actor(request),
      ),
      "Vehicle brand updated",
    );
  },

  async updateBrandStatus(request: FastifyRequest) {
    const { isActive } = parse(
      z.object({ isActive: z.boolean() }),
      request.body,
    );
    return success(
      await vehicles.updateBrandStatus(
        param(request, "brandId"),
        isActive,
        actor(request),
      ),
      "Vehicle brand status updated",
    );
  },

  async models() {
    return success(await vehicles.models(), "Vehicle models retrieved");
  },

  async createModel(request: FastifyRequest, reply: FastifyReply) {
    const result = await vehicles.createModel(
      parse(
        z.object({
          brandId: z.string().min(1),
          categoryId: z.string().uuid(),
          name: z.string().min(1).max(100),
          slug: z.string().max(100).optional(),
          isActive: z.boolean().default(true),
        }),
        request.body,
      ),
      actor(request),
    );
    return reply.code(201).send(success(result, "Vehicle model created"));
  },

  async getModel(request: FastifyRequest) {
    return success(
      await vehicles.getModel(param(request, "modelId")),
      "Vehicle model retrieved",
    );
  },

  async updateModel(request: FastifyRequest) {
    return success(
      await vehicles.updateModel(
        param(request, "modelId"),
        parse(
          z.object({
            brandId: z.string().min(1).optional(),
            categoryId: z.string().uuid().optional(),
            name: z.string().min(1).max(100).optional(),
            slug: z.string().max(100).optional(),
            isActive: z.boolean().optional(),
          }),
          request.body,
        ),
        actor(request),
      ),
      "Vehicle model updated",
    );
  },

  async updateModelStatus(request: FastifyRequest) {
    const { isActive } = parse(
      z.object({ isActive: z.boolean() }),
      request.body,
    );
    return success(
      await vehicles.updateModelStatus(
        param(request, "modelId"),
        isActive,
        actor(request),
      ),
      "Vehicle model status updated",
    );
  },

  async years() {
    return success(await vehicles.years(), "Manufacturer years retrieved");
  },

  async createYear(request: FastifyRequest, reply: FastifyReply) {
    const result = await vehicles.createYear(
      parse(
        z.object({
          modelId: z.string().uuid(),
          year: z.number().int().min(1900).max(2100),
          isActive: z.boolean().default(true),
        }),
        request.body,
      ),
      actor(request),
    );
    return reply.code(201).send(success(result, "Manufacturer year created"));
  },

  async updateYear(request: FastifyRequest) {
    return success(
      await vehicles.updateYear(
        param(request, "yearId"),
        parse(
          z.object({
            modelId: z.string().uuid().optional(),
            year: z.number().int().min(1900).max(2100).optional(),
            isActive: z.boolean().optional(),
          }),
          request.body,
        ),
        actor(request),
      ),
      "Manufacturer year updated",
    );
  },

  async updateYearStatus(request: FastifyRequest) {
    const { isActive } = parse(
      z.object({ isActive: z.boolean() }),
      request.body,
    );
    return success(
      await vehicles.updateYearStatus(
        param(request, "yearId"),
        isActive,
        actor(request),
      ),
      "Manufacturer year status updated",
    );
  },

  async listBookings(request: FastifyRequest) {
    const query = parse(schemas.bookingList, request.query);
    const result = await bookings.list(query);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Bookings retrieved",
    );
  },

  async bookingBids(request: FastifyRequest) {
    return success(
      await bookings.bids(param(request, "bookingId")),
      "Booking bids retrieved",
    );
  },

  async bookingMatchingLogs(request: FastifyRequest) {
    return success(
      await bookings.matchingLogs(param(request, "bookingId")),
      "Booking matching logs retrieved",
    );
  },

  async listScheduledBookings(request: FastifyRequest) {
    const query = parse(schemas.bookingList, request.query);
    const result = await bookings.listScheduled(query);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Scheduled bookings retrieved",
    );
  },

  async getScheduledBooking(request: FastifyRequest) {
    return success(
      await bookings.getScheduled(param(request, "id")),
      "Scheduled booking retrieved",
    );
  },

  async updateScheduledBookingStatus(request: FastifyRequest) {
    const { status, reason } = parse(schemas.bookingStatusUpdate, request.body);
    return success(
      await bookings.updateScheduledStatus(
        param(request, "id"),
        status,
        reason,
        actor(request),
      ),
      "Scheduled booking status updated",
    );
  },

  async assignScheduledBookingDriver(request: FastifyRequest) {
    const input = parse(schemas.dispatchOfferBody, request.body);
    return success(
      await bookings.assignScheduledDriver(
        param(request, "id"),
        input as any,
        actor(request),
      ),
      "Driver assigned to scheduled booking",
    );
  },

  async getBooking(request: FastifyRequest) {
    return success(
      await bookings.get(param(request, "bookingId")),
      "Booking retrieved",
    );
  },

  async bookingTimeline(request: FastifyRequest) {
    return success(
      await bookings.timeline(param(request, "bookingId")),
      "Booking timeline retrieved",
    );
  },

  async assignBooking(request: FastifyRequest, reassign = false) {
    return success(
      await bookings.assign(
        param(request, "bookingId"),
        parse(schemas.bookingAssignment, request.body),
        actor(request),
        reassign,
      ),
      reassign ? "Booking reassigned" : "Booking assigned",
    );
  },

  async cancelBooking(request: FastifyRequest) {
    const input = parse(schemas.reasonBody, request.body);
    return success(
      await bookings.cancel(
        param(request, "bookingId"),
        input.reason,
        actor(request),
      ),
      "Booking cancelled",
    );
  },

  async updateBookingStatus(request: FastifyRequest) {
    return success(
      await bookings.updateStatus(
        param(request, "bookingId"),
        parse(schemas.bookingStatusUpdate, request.body),
        actor(request),
      ),
      "Booking status updated",
    );
  },

  async bookingLocations(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const [items, total] = await bookings.locationHistory(
      param(request, "bookingId"),
      query.page,
      query.limit,
    );
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      "Booking location history retrieved",
    );
  },

  async bookingPayment(request: FastifyRequest) {
    return success(
      await bookings.payment(param(request, "bookingId")),
      "Booking payment retrieved",
    );
  },

  async listTrips(request: FastifyRequest, activeOnly = false) {
    const query = parse(schemas.tripList, request.query);
    const result = await trips.list({ ...query, activeOnly });
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Trips retrieved",
    );
  },

  async getTrip(request: FastifyRequest) {
    return success(await trips.get(param(request, "tripId")), "Trip retrieved");
  },

  async tripTimeline(request: FastifyRequest) {
    return success(
      await trips.timeline(param(request, "tripId")),
      "Trip timeline retrieved",
    );
  },

  async tripLiveLocation(request: FastifyRequest) {
    return success(
      await trips.liveLocation(param(request, "tripId")),
      "Trip live location retrieved",
    );
  },

  async tripLocationHistory(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const [items, total] = await trips.locationHistory(
      param(request, "tripId"),
      query.page,
      query.limit,
    );
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      "Trip location history retrieved",
    );
  },

  async updateTripStatus(request: FastifyRequest) {
    return success(
      await trips.updateStatus(
        param(request, "tripId"),
        parse(schemas.tripStatusUpdate, request.body),
        actor(request),
      ),
      "Trip status updated",
    );
  },

  async cancelTrip(request: FastifyRequest) {
    const input = parse(schemas.reasonBody, request.body);
    return success(
      await trips.cancel(
        param(request, "tripId"),
        input.reason,
        actor(request),
      ),
      "Trip cancelled",
    );
  },

  async forceCompleteTrip(request: FastifyRequest) {
    return success(
      await trips.forceComplete(
        param(request, "tripId"),
        parse(schemas.forceCompleteTrip, request.body),
        actor(request),
      ),
      "Trip force-completed",
    );
  },

  async addTripNote(request: FastifyRequest) {
    const input = parse(schemas.noteBody, request.body);
    return success(
      await trips.addNote(param(request, "tripId"), input.note, actor(request)),
      "Trip note added",
    );
  },

  async reportTripIncident(request: FastifyRequest) {
    const input = parse(
      z.object({
        type: z.string().min(1).max(50),
        description: z.string().min(1),
      }),
      request.body,
    );
    return success(
      await trips.reportIncident(
        param(request, "tripId"),
        input,
        actor(request),
      ),
      "Trip incident reported",
    );
  },

  async listFares(request: FastifyRequest) {
    const query = parse(
      schemas.pagination.extend({
        active: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
      }),
      request.query,
    );
    const result = await fares.list(query.page, query.limit, query.active);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Fare rules retrieved",
    );
  },

  async createFare(request: FastifyRequest, reply: FastifyReply) {
    const result = await fares.create(
      parse(schemas.fareBody, request.body),
      actor(request),
    );
    return reply.code(201).send(success(result, "Fare rule created"));
  },

  async getFare(request: FastifyRequest) {
    return success(
      await fares.get(param(request, "fareId")),
      "Fare rule retrieved",
    );
  },

  async updateFare(request: FastifyRequest) {
    return success(
      await fares.update(
        param(request, "fareId"),
        parse(schemas.fareUpdate, request.body),
        actor(request),
      ),
      "Fare rule version created",
    );
  },

  async updateFareStatus(request: FastifyRequest) {
    const input = parse(schemas.fareStatus, request.body);
    return success(
      await fares.setStatus(
        param(request, "fareId"),
        input.isActive,
        actor(request),
      ),
      "Fare rule status updated",
    );
  },

  async fareHistory(request: FastifyRequest) {
    const query = parse(
      z.object({
        vehicleCategoryId: z.uuid().optional(),
        rideType: z.enum(["CITY", "RENTAL", "OUTSTATION"]).optional(),
        scopeKey: z.string().max(100).optional(),
      }),
      request.query,
    );
    return success(
      await fares.history(
        query.vehicleCategoryId,
        query.rideType,
        query.scopeKey,
      ),
      "Fare history retrieved",
    );
  },

  async farePreview(request: FastifyRequest) {
    return success(
      await fares.preview(parse(schemas.farePreview, request.body)),
      "Fare preview calculated",
    );
  },

  async listNotifications(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await notifications.list(query.page, query.limit);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Notification campaigns retrieved",
    );
  },

  async sendNotification(
    request: FastifyRequest,
    reply: FastifyReply,
    scheduled: boolean,
  ) {
    const input = parse(schemas.notificationSend, request.body);
    if (scheduled && (!input.scheduledAt || input.scheduledAt <= new Date())) {
      throw errors.badRequest("scheduledAt must be in the future");
    }
    if (!scheduled && input.scheduledAt) {
      throw errors.badRequest(
        "Use the notification schedule endpoint when scheduledAt is supplied",
      );
    }
    const result = await notifications.createCampaign(
      input,
      String(request.headers["x-idempotency-key"] ?? ""),
      actor(request),
    );
    return reply
      .code(202)
      .send(
        success(
          result,
          scheduled ? "Notification scheduled" : "Notification queued",
        ),
      );
  },

  async getNotification(request: FastifyRequest) {
    return success(
      await notifications.get(param(request, "notificationId")),
      "Notification campaign retrieved",
    );
  },

  async retryNotification(request: FastifyRequest) {
    await notifications.retry(param(request, "notificationId"));
    return success(null, "Notification retry queued");
  },

  async cancelNotificationSchedule(request: FastifyRequest) {
    await notifications.cancelSchedule(
      param(request, "notificationId"),
      actor(request),
    );
    return success(null, "Notification schedule cancelled");
  },

  async notificationTemplates() {
    return success(
      await notifications.templates(),
      "Notification templates retrieved",
    );
  },

  async createNotificationTemplate(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const result = await notifications.createTemplate(
      parse(schemas.notificationTemplate, request.body),
      actor(request),
    );
    return reply
      .code(201)
      .send(success(result, "Notification template created"));
  },

  async updateNotificationTemplate(request: FastifyRequest) {
    return success(
      await notifications.updateTemplate(
        param(request, "templateId"),
        parse(schemas.notificationTemplateUpdate, request.body),
        actor(request),
      ),
      "Notification template updated",
    );
  },

  async dashboardReport(request: FastifyRequest) {
    const query = parse(z.object(schemas.dateRange), request.query);
    return success(
      await reports.dashboard(query.from, query.to),
      "Report dashboard retrieved",
    );
  },

  async report(request: FastifyRequest, type: string) {
    const query = parse(schemas.reportQuery, request.query);
    return success(
      await reports.report(type as never, query),
      `${type} report retrieved`,
    );
  },

  async createReportExport(request: FastifyRequest, reply: FastifyReply) {
    const input = parse(schemas.reportExport, request.body);
    const result = await reports.createExport(input, actor(request));
    return reply.code(202).send(success(result, "Report export queued"));
  },

  async getReportExport(request: FastifyRequest) {
    return success(
      await reports.getExport(
        param(request, "exportId"),
        request.admin!.id,
        isSuper(request),
      ),
      "Report export retrieved",
    );
  },

  async listSupport(request: FastifyRequest) {
    const query = parse(schemas.supportList, request.query);
    const result = await support.list(
      query,
      request.admin!.id,
      isSuper(request),
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Support tickets retrieved",
    );
  },

  async supportInbox(request: FastifyRequest) {
    const query = parse(
      z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      }),
      request.query,
    );
    const result = await support.inbox(query, actor(request), isSuper(request));
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Support inbox messages retrieved",
    );
  },

  async supportInboxUnreadCount(request: FastifyRequest) {
    return success(
      await support.unreadInboxCount(actor(request), isSuper(request)),
      "Unread support message count retrieved",
    );
  },

  async markSupportInboxMessageRead(request: FastifyRequest) {
    await support.markInboxMessageRead(
      param(request, "messageId"),
      actor(request),
      isSuper(request),
    );
    return success(null, "Support message marked as read");
  },

  async markAllSupportInboxMessagesRead(request: FastifyRequest) {
    await support.markAllInboxMessagesRead(actor(request), isSuper(request));
    return success(null, "All support messages marked as read");
  },

  async getSupport(request: FastifyRequest) {
    return success(
      await support.get(
        param(request, "ticketId"),
        request.admin!.id,
        isSuper(request),
      ),
      "Support ticket retrieved",
    );
  },

  async replySupport(request: FastifyRequest) {
    return success(
      await support.reply(
        param(request, "ticketId"),
        parse(schemas.supportReply, request.body),
        actor(request),
      ),
      "Support reply added",
    );
  },

  async updateSupportStatus(request: FastifyRequest) {
    return success(
      await support.updateStatus(
        param(request, "ticketId"),
        parse(schemas.supportStatus, request.body),
        actor(request),
      ),
      "Support status updated",
    );
  },

  async updateSupportPriority(request: FastifyRequest) {
    return success(
      await support.updatePriority(
        param(request, "ticketId"),
        parse(schemas.supportPriority, request.body),
        actor(request),
      ),
      "Support priority updated",
    );
  },

  async assignSupport(request: FastifyRequest) {
    const input = parse(schemas.supportAssignment, request.body);
    return success(
      await support.assign(
        param(request, "ticketId"),
        input.adminId,
        input.reason,
        actor(request),
      ),
      "Support ticket assigned",
    );
  },

  async escalateSupport(request: FastifyRequest) {
    const input = parse(schemas.reasonBody, request.body);
    return success(
      await support.escalate(
        param(request, "ticketId"),
        input.reason,
        actor(request),
      ),
      "Support ticket escalated",
    );
  },

  async supportInternalNote(request: FastifyRequest) {
    const input = parse(schemas.noteBody, request.body);
    return success(
      await support.addInternalNote(
        param(request, "ticketId"),
        input.note,
        actor(request),
      ),
      "Internal support note added",
    );
  },

  async supportCategories() {
    return success(await support.categories(), "Support categories retrieved");
  },

  async createSupportCategory(request: FastifyRequest, reply: FastifyReply) {
    const result = await support.createCategory(
      parse(schemas.supportCategory, request.body),
      actor(request),
    );
    return reply.code(201).send(success(result, "Support category created"));
  },

  async updateSupportCategory(request: FastifyRequest) {
    return success(
      await support.updateCategory(
        param(request, "categoryId"),
        parse(schemas.supportCategory.partial(), request.body),
        actor(request),
      ),
      "Support category updated",
    );
  },

  async listConfig(request: FastifyRequest) {
    const query = parse(
      z.object({ group: z.string().max(50).optional() }),
      request.query,
    );
    return success(
      await config.list(query.group),
      "Platform configuration retrieved",
    );
  },

  async getConfig(request: FastifyRequest) {
    const key = parse(
      z.object({ key: z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/) }),
      request.params,
    ).key;
    return success(await config.get(key), "Platform configuration retrieved");
  },

  async updateConfig(request: FastifyRequest) {
    const key = parse(
      z.object({ key: z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/) }),
      request.params,
    ).key;
    const input = parse(schemas.configUpdate, request.body);
    return success(
      await config.update(
        key,
        input.value,
        input.reason,
        actor(request),
        isSuper(request),
      ),
      "Platform configuration updated",
    );
  },

  async configHistory(request: FastifyRequest) {
    const query = parse(
      schemas.pagination.extend({ key: z.string().max(100).optional() }),
      request.query,
    );
    const [items, total] = await config.history(
      query.page,
      query.limit,
      query.key,
    );
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      "Configuration history retrieved",
    );
  },

  async maintenanceMode(request: FastifyRequest) {
    return success(
      await config.setMaintenanceMode(
        parse(schemas.maintenanceMode, request.body),
        actor(request),
        isSuper(request),
      ),
      "Maintenance mode updated",
    );
  },

  async dashboardCombined(request: FastifyRequest) {
    const query = parse(schemas.dashboardSummary, request.query);
    return success(
      await dashboard.combined(query),
      "Admin dashboard fetched successfully",
    );
  },

  async dashboardSummary(request: FastifyRequest) {
    const query = parse(schemas.dashboardSummary, request.query);
    return success(
      await dashboard.summary(query),
      "Dashboard summary retrieved",
    );
  },

  async dashboardBookingOverview(request: FastifyRequest) {
    const query = parse(schemas.dashboardOverview, request.query);
    return success(
      await dashboard.bookingOverview(query),
      "Booking overview retrieved",
    );
  },

  async dashboardBookingStatus(request: FastifyRequest) {
    const query = parse(schemas.dashboardSummary, request.query);
    return success(
      await dashboard.bookingStatus(query),
      "Booking status breakdown retrieved",
    );
  },

  async dashboardTopVehicles(request: FastifyRequest) {
    const query = parse(schemas.dashboardTopVehicles, request.query);
    return success(
      await dashboard.topVehicles(query),
      "Top vehicles retrieved",
    );
  },

  async dashboardRevenueOverview(request: FastifyRequest) {
    const query = parse(schemas.dashboardOverview, request.query);
    return success(
      await dashboard.revenueOverview(query),
      "Revenue overview retrieved",
    );
  },

  async dashboardDriverPerformance(request: FastifyRequest) {
    const query = parse(schemas.dashboardDriverPerformance, request.query);
    return success(
      await dashboard.driverPerformance(query),
      "Driver performance retrieved",
    );
  },

  async liveOperations() {
    return success(
      await dashboard.liveOperations(),
      "Live operations retrieved",
    );
  },

  async recentBookings(request: FastifyRequest) {
    const query = parse(schemas.dashboardRecentBookings, request.query);
    return success(
      await dashboard.recentBookings(query),
      "Recent bookings retrieved",
    );
  },

  async alerts(request: FastifyRequest) {
    const query = parse(
      z.object({ limit: z.coerce.number().default(10) }),
      request.query,
    );
    return success(
      await dashboard.alerts(query.limit),
      "Dashboard alerts retrieved",
    );
  },

  async auditLogs(request: FastifyRequest) {
    const query = parse(
      schemas.pagination.extend({
        actorUserId: z.uuid().optional(),
        entityType: z.string().max(80).optional(),
        action: z.string().max(100).optional(),
      }),
      request.query,
    );
    const [items, total] = await auditLogs.list(query);
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      "Audit logs retrieved",
    );
  },

  async listSos(request: FastifyRequest) {
    const query = parse(
      schemas.pagination.extend({
        status: z
          .enum([
            "OPEN",
            "ACKNOWLEDGED",
            "IN_PROGRESS",
            "RESOLVED",
            "FALSE_ALARM",
            "CLOSED",
          ])
          .optional(),
        requesterType: z.enum(["USER", "DRIVER"]).optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        assignedAdminId: z.uuid().optional(),
        userId: z.uuid().optional(),
        bookingId: z.uuid().optional(),
        search: z.string().trim().max(120).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
      }),
      request.query,
    );
    const result = await safety.listSos(query.page, query.limit, {
      ...query,
      from: query.from,
      to: query.to,
    });
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "SOS alerts retrieved",
    );
  },

  async getSosMessages(request: FastifyRequest) {
    return success(
      await safety.getMessages(param(request, "sosId")),
      "SOS messages retrieved",
    );
  },

  async createSosMessage(request: FastifyRequest) {
    const input = parse(
      z.object({
        message: z.string().trim().min(1).max(4000),
        isInternal: z.boolean().optional(),
      }),
      request.body,
    );
    return success(
      await safety.createMessage(
        actor(request),
        param(request, "sosId"),
        input,
      ),
      "SOS message sent",
    );
  },

  async markSosMessagesRead(request: FastifyRequest) {
    return success(
      await safety.markRead(actor(request), param(request, "sosId")),
      "SOS messages marked as read",
    );
  },

  async sosUnreadCount(request: FastifyRequest) {
    return success(
      await safety.unreadCount(actor(request).adminId),
      "SOS unread count retrieved",
    );
  },

  async assignSos(request: FastifyRequest) {
    const input = parse(
      z.object({
        adminId: z.string().uuid().optional(),
        reason: z.string().trim().min(3).max(500).optional(),
      }),
      request.body,
    );
    return success(
      await safety.assignSos(actor(request), param(request, "sosId"), input),
      "SOS assigned",
    );
  },

  async getSos(request: FastifyRequest) {
    return success(
      await safety.getSos(param(request, "sosId")),
      "SOS alert retrieved",
    );
  },

  async getEmergencyContacts(request: FastifyRequest) {
    const query = parse(z.object({ userId: z.uuid() }), request.query);
    return success(
      await safety.listEmergencyContacts(query.userId),
      "Emergency contacts retrieved",
    );
  },

  async getIncidentHistory(request: FastifyRequest) {
    const query = parse(
      schemas.pagination.extend({ tripId: z.uuid().optional() }),
      request.query,
    );
    const result = await safety.incidentHistory(query.page, query.limit, query);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Incident history retrieved",
    );
  },

  async complianceAudits(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const [items, total] = await auditLogs.list({
      ...query,
      entityType: "Compliance",
    });
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      "Compliance audits retrieved",
    );
  },

  async vehicleInspections(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const [items, total] = await prisma.$transaction([
      prisma.vehicleDocument.findMany({
        where: { type: { in: ["FITNESS", "INSPECTION", "PERMIT"] } },
        include: { vehicle: { select: { id: true, registrationNo: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.vehicleDocument.count({
        where: { type: { in: ["FITNESS", "INSPECTION", "PERMIT"] } },
      }),
    ]);
    return pageResult(
      items,
      total,
      query.page,
      query.limit,
      "Vehicle inspections retrieved",
    );
  },

  async driverComplianceStatuses(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const [items, total] = await prisma.$transaction([
      prisma.driverProfile.findMany({
        include: {
          user: { select: { displayName: true, status: true } },
          documents: true,
          kycSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.driverProfile.count(),
    ]);
    const now = new Date();
    const mapped = items.map((driver) => {
      const license = driver.documents.find((doc) => doc.type === "LICENSE");
      const licenseValid = Boolean(
        license &&
        license.status === "VERIFIED" &&
        (!license.expiresAt || license.expiresAt > now),
      );
      const kycApproved = driver.kycSubmissions[0]?.status === "VERIFIED";
      return {
        driverId: driver.id,
        driverName: driver.user.displayName,
        licenseValid,
        kycApproved,
        bgCheckPassed: driver.documents.some(
          (doc) => doc.type === "BACKGROUND_CHECK" && doc.status === "VERIFIED",
        ),
        overallStatus:
          licenseValid && kycApproved ? "COMPLIANT" : "NON_COMPLIANT",
        expiryDate: license?.expiresAt,
      };
    });
    return pageResult(
      mapped,
      total,
      query.page,
      query.limit,
      "Driver compliance statuses retrieved",
    );
  },

  async issueComplianceWarning(request: FastifyRequest) {
    const input = parse(
      z.object({
        driverId: z.uuid(),
        reason: z.string().trim().min(5).max(500),
        severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
      }),
      request.body,
    );
    await prisma.auditLog.create({
      data: {
        actorUserId: request.admin!.userId,
        actorRole: actor(request).role,
        action: "ADMIN_COMPLIANCE_WARNING_ISSUED",
        entityType: "Compliance",
        entityId: input.driverId,
        reason: input.reason,
        metadata: { severity: input.severity },
      },
    });
    return success(null, "Compliance warning issued");
  },

  async resolveComplianceItem(request: FastifyRequest) {
    const input = parse(
      z.object({ notes: z.string().trim().min(2).max(1000).optional() }),
      request.body,
    );
    await prisma.auditLog.create({
      data: {
        actorUserId: request.admin!.userId,
        actorRole: actor(request).role,
        action: "ADMIN_COMPLIANCE_ITEM_RESOLVED",
        entityType: "Compliance",
        entityId: param(request, "complianceId"),
        reason: input.notes,
      },
    });
    return success(null, "Compliance item resolved");
  },

  async updateSos(request: FastifyRequest) {
    const input = parse(
      z.object({
        status: z.enum([
          "OPEN",
          "ACKNOWLEDGED",
          "IN_PROGRESS",
          "RESOLVED",
          "FALSE_ALARM",
          "CLOSED",
        ]),
        reason: z.string().trim().max(500).optional(),
        resolution: z.string().trim().max(2000).optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
      }),
      request.body,
    );
    return success(
      await safety.updateSos(actor(request), param(request, "sosId"), input),
      "SOS status updated",
    );
  },

  async getAdmin(request: FastifyRequest) {
    return success(
      await admins.get(param(request, "adminId")),
      "Admin retrieved",
    );
  },

  async resetAdminPassword(request: FastifyRequest) {
    const admin = await admins.get(param(request, "adminId"));
    if (!admin.user.email) {
      throw errors.badRequest("Admin account does not have an email address");
    }
    const result = await auth.forgotPassword(admin.user.email, {
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });
    return success(result, "Admin password reset initiated");
  },

  async listRoles(_request: FastifyRequest) {
    return success(await admins.listRoles(), "Roles retrieved");
  },

  async assignAdminRole(request: FastifyRequest) {
    return success(
      await admins.assignRole(
        param(request, "adminId"),
        parse(schemas.adminRoleAssignment, request.body).roleId,
        actor(request),
      ),
      "Admin role assigned",
    );
  },

  async removeAdminRole(request: FastifyRequest) {
    return success(
      await admins.removeRole(
        param(request, "adminId"),
        param(request, "roleId"),
        actor(request),
      ),
      "Admin role removed",
    );
  },

  async listAdminSessions(request: FastifyRequest) {
    return success(
      await admins.listSessions(param(request, "adminId")),
      "Admin sessions retrieved",
    );
  },

  async revokeAdminSession(request: FastifyRequest) {
    await admins.revokeSession(
      param(request, "adminId"),
      param(request, "sessionId"),
      actor(request),
    );
    return success(null, "Admin session revoked");
  },

  async logoutAllAdminSessions(request: FastifyRequest) {
    const count = await admins.logoutAllSessions(
      param(request, "adminId"),
      actor(request),
    );
    return success({ revokedSessions: count }, "All admin sessions revoked");
  },

  // --- Search ---
  async globalSearch(request: FastifyRequest) {
    const query = parse(schemas.searchSchema, request.query);
    const results = await searchService.globalSearch(query.query, query.limit);
    return success(results, "Search results retrieved");
  },

  // --- Payments ---
  async listPayments(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await paymentService.list(
      query.page,
      query.limit,
      request.query as any,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Payments retrieved",
    );
  },
  async getPayment(request: FastifyRequest) {
    return success(
      await paymentService.get(param(request, "paymentId")),
      "Payment retrieved",
    );
  },
  async retryPayment(request: FastifyRequest) {
    return success(
      await paymentService.retry(param(request, "paymentId")),
      "Payment retried",
    );
  },
  async reconcilePayment(request: FastifyRequest) {
    return success(
      await paymentService.reconcile(param(request, "paymentId")),
      "Payment reconciled",
    );
  },
  async paymentGatewayLogs(request: FastifyRequest) {
    const query = parse(
      schemas.pagination.extend({
        type: z
          .enum([
            "ORDER_CREATED",
            "AUTHORIZED",
            "CAPTURED",
            "FAILED",
            "REFUND",
            "WEBHOOK",
            "RECONCILIATION",
          ])
          .optional(),
        status: z.string().trim().max(30).optional(),
      }),
      request.query,
    );
    const result = await paymentService.gatewayLogs(
      query.page,
      query.limit,
      query,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Payment gateway logs retrieved",
    );
  },

  // --- Refunds ---
  async listRefunds(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await refundService.list(
      query.page,
      query.limit,
      request.query as any,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Refunds retrieved",
    );
  },
  async getRefund(request: FastifyRequest) {
    return success(
      await refundService.get(param(request, "refundId")),
      "Refund retrieved",
    );
  },
  async processRefund(request: FastifyRequest) {
    return success(
      await refundService.processRefund(param(request, "refundId")),
      "Refund processed",
    );
  },
  async rejectRefund(request: FastifyRequest) {
    const { note } = parse(schemas.resolveDisputeBody, request.body); // reusing note schema
    return success(
      await refundService.rejectRefund(param(request, "refundId"), note),
      "Refund rejected",
    );
  },

  // --- Wallets ---
  async listCustomerWallets(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await walletService.listCustomerWallets(
      query.page,
      query.limit,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Customer wallets retrieved",
    );
  },
  async getCustomerWallet(request: FastifyRequest) {
    return success(
      await walletService.getCustomerWallet(param(request, "walletId")),
      "Customer wallet retrieved",
    );
  },
  async listDriverWallets(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await walletService.listDriverWallets(
      query.page,
      query.limit,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Driver wallets retrieved",
    );
  },
  async getDriverWallet(request: FastifyRequest) {
    return success(
      await walletService.getDriverWallet(param(request, "walletId")),
      "Driver wallet retrieved",
    );
  },

  // --- Payouts (Settlements) ---
  async listSettlements(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await payoutService.listSettlements(
      query.page,
      query.limit,
      request.query as any,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Settlements retrieved",
    );
  },
  async processSettlement(request: FastifyRequest) {
    // simplified
    return success(
      await payoutService.processSettlement(
        param(request, "settlementId"),
        "REF-" + Date.now(),
      ),
      "Settlement processed",
    );
  },
  async createManualPayout(request: FastifyRequest) {
    const input = parse(
      z.object({
        driverId: z.uuid(),
        amount: z.coerce.number().positive(),
        notes: z.string().trim().min(5).max(500).optional(),
        referenceId: z.string().trim().min(2).max(100).optional(),
      }),
      request.body,
    );
    return success(
      await payoutService.createManualPayout(input),
      "Manual payout created",
    );
  },
  async rejectSettlement(request: FastifyRequest) {
    return success(
      await payoutService.rejectSettlement(param(request, "settlementId")),
      "Settlement rejected",
    );
  },

  // --- Coupons ---
  async listCoupons(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await couponService.list(
      query.page,
      query.limit,
      request.query as any,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Coupons retrieved",
    );
  },
  async getCoupon(request: FastifyRequest) {
    return success(
      await couponService.get(param(request, "couponId")),
      "Coupon retrieved",
    );
  },
  async getCouponUsageStats(request: FastifyRequest) {
    return success(
      await couponService.usageStats(param(request, "couponId")),
      "Coupon usage stats retrieved",
    );
  },
  async getCouponRedemptions(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await couponService.redemptions(
      param(request, "couponId"),
      query.page,
      query.limit,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Coupon redemptions retrieved",
    );
  },
  async bulkGenerateCoupons(request: FastifyRequest) {
    return success(
      await couponService.bulkGenerate(request.body),
      "Coupons generated",
    );
  },
  async createCoupon(request: FastifyRequest) {
    return success(await couponService.create(request.body), "Coupon created");
  },
  async updateCoupon(request: FastifyRequest) {
    return success(
      await couponService.update(param(request, "couponId"), request.body),
      "Coupon updated",
    );
  },
  async deleteCoupon(request: FastifyRequest) {
    return success(
      await couponService.delete(param(request, "couponId")),
      "Coupon deleted",
    );
  },

  // --- Incentives ---
  async listIncentives(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await incentiveService.list(
      query.page,
      query.limit,
      request.query as any,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Incentives retrieved",
    );
  },
  async getIncentive(request: FastifyRequest) {
    return success(
      await incentiveService.get(param(request, "incentiveId")),
      "Incentive retrieved",
    );
  },
  async createIncentive(request: FastifyRequest) {
    return success(
      await incentiveService.create(request.body),
      "Incentive created",
    );
  },
  async updateIncentive(request: FastifyRequest) {
    return success(
      await incentiveService.update(
        param(request, "incentiveId"),
        request.body,
      ),
      "Incentive updated",
    );
  },
  async deleteIncentive(request: FastifyRequest) {
    return success(
      await incentiveService.delete(param(request, "incentiveId")),
      "Incentive deleted",
    );
  },

  // --- Dispatch ---
  async getDispatchSettings(_request: FastifyRequest) {
    return success(
      await dispatchService.getSettings(),
      "Dispatch settings retrieved",
    );
  },
  async updateDispatchSettings(request: FastifyRequest) {
    return success(
      await dispatchService.updateSettings(request.body, request.admin!.id),
      "Dispatch settings updated",
    );
  },

  // --- Surge ---
  async listSurgeRules(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await surgeService.list(
      query.page,
      query.limit,
      request.query as any,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Surge rules retrieved",
    );
  },
  async getSurgeRule(request: FastifyRequest) {
    return success(
      await surgeService.get(param(request, "surgeId")),
      "Surge rule retrieved",
    );
  },
  async createSurgeRule(request: FastifyRequest) {
    return success(
      await surgeService.create(request.body),
      "Surge rule created",
    );
  },
  async updateSurgeRule(request: FastifyRequest) {
    return success(
      await surgeService.update(param(request, "surgeId"), request.body),
      "Surge rule updated",
    );
  },
  async deleteSurgeRule(request: FastifyRequest) {
    return success(
      await surgeService.delete(param(request, "surgeId")),
      "Surge rule deleted",
    );
  },

  // --- Cancellations ---
  // --- Service Areas & Zones ---
  async listServiceAreas(_request: FastifyRequest) {
    return success(
      await zoneService.listServiceAreas(),
      "Service areas retrieved",
    );
  },
  async getServiceArea(request: FastifyRequest) {
    return success(
      await zoneService.getServiceArea(param(request, "areaId")),
      "Service area retrieved",
    );
  },
  async createServiceArea(request: FastifyRequest) {
    const input = parse(schemas.createServiceAreaSchema, request.body);
    return success(
      await zoneService.createServiceArea(input),
      "Service area created",
    );
  },
  async updateServiceArea(request: FastifyRequest) {
    const input = parse(schemas.updateServiceAreaSchema, request.body);
    return success(
      await zoneService.updateServiceArea(param(request, "areaId"), input),
      "Service area updated",
    );
  },
  async listZones(request: FastifyRequest) {
    return success(
      await zoneService.listZones(param(request, "areaId")),
      "Zones retrieved",
    );
  },
  async getZone(request: FastifyRequest) {
    return success(
      await zoneService.getZone(param(request, "zoneId")),
      "Zone retrieved",
    );
  },
  async createZone(request: FastifyRequest) {
    const input = parse(schemas.createZoneSchema, request.body);
    return success(await zoneService.createZone(input), "Zone created");
  },
  async updateZone(request: FastifyRequest) {
    const input = parse(schemas.updateZoneSchema, request.body);
    return success(
      await zoneService.updateZone(param(request, "zoneId"), input),
      "Zone updated",
    );
  },

  // --- Reviews ---
  async listReviews(request: FastifyRequest) {
    const query = parse(schemas.reviewQuery, request.query);
    return success(await reviewService.list(query), "Reviews retrieved");
  },

  async getReview(request: FastifyRequest) {
    return success(
      await reviewService.get(param(request, "reviewId")),
      "Review retrieved",
    );
  },

  async updateReviewVisibility(request: FastifyRequest) {
    const { isHidden } = request.body as any;
    return success(
      await reviewService.updateVisibility(
        param(request, "reviewId"),
        isHidden,
        actor(request),
      ),
      "Review visibility updated",
    );
  },

  // --- Referrals ---
  async listReferrals(request: FastifyRequest) {
    const { page, limit, search } = request.query as any;
    return success(
      await referralService.list(
        Number(page) || 1,
        Number(limit) || 20,
        search,
      ),
      "Referrals retrieved",
    );
  },

  async getReferral(request: FastifyRequest) {
    return success(
      await referralService.get(param(request, "referralId")),
      "Referral retrieved",
    );
  },

  async getReferralStats(request: FastifyRequest) {
    return success(await referralService.stats(), "Referral stats retrieved");
  },

  async deleteReview(request: FastifyRequest) {
    return success(
      await reviewService.delete(param(request, "reviewId"), actor(request)),
      "Review deleted",
    );
  },

  async reviewStatistics(_request: FastifyRequest) {
    return success(
      await reviewService.statistics(),
      "Review statistics retrieved",
    );
  },

  // --- Recovered Vehicle Methods ---
  async listVehicleMaintenance(request: FastifyRequest) {
    return success(
      await vehicles.listMaintenance(param(request, "vehicleId")),
      "Vehicle maintenance retrieved",
    );
  },
  async addVehicleMaintenance(request: FastifyRequest) {
    return success(
      await vehicles.addMaintenance(
        param(request, "vehicleId"),
        request.body,
        actor(request),
      ),
      "Vehicle maintenance added",
    );
  },
  async listVehicleInsurance(request: FastifyRequest) {
    return success(
      await vehicles.listInsurance(param(request, "vehicleId")),
      "Vehicle insurance retrieved",
    );
  },
  async addVehicleInsurance(request: FastifyRequest) {
    return success(
      await vehicles.addInsurance(
        param(request, "vehicleId"),
        request.body,
        actor(request),
      ),
      "Vehicle insurance added",
    );
  },
  async getVehicleLiveLocation(request: FastifyRequest) {
    return success(
      await vehicles.getLiveLocation(param(request, "vehicleId")),
      "Vehicle live location retrieved",
    );
  },

  // --- Recovered Booking Methods ---
  async createBooking(request: FastifyRequest) {
    return success(
      await bookings.create(request.body, actor(request)),
      "Booking created",
    );
  },
  async updateBooking(request: FastifyRequest) {
    return success(
      await bookings.update(
        param(request, "bookingId"),
        request.body,
        actor(request),
      ),
      "Booking updated",
    );
  },
  async deleteBooking(request: FastifyRequest) {
    return success(
      await bookings.delete(param(request, "bookingId"), actor(request)),
      "Booking deleted",
    );
  },
  async getBookingInvoice(request: FastifyRequest) {
    return success(
      await bookings.getInvoice(param(request, "bookingId")),
      "Booking invoice retrieved",
    );
  },
  async updateBookingPaymentStatus(request: FastifyRequest) {
    return success(
      await bookings.updatePaymentStatus(
        param(request, "bookingId"),
        request.body,
        actor(request),
      ),
      "Booking payment status updated",
    );
  },

  // --- Recovered Trip Methods ---
  async getGlobalTripLocations(_request: FastifyRequest) {
    return success(
      await trips.getGlobalLocations(),
      "Global trip locations retrieved",
    );
  },
  async tripPayment(request: FastifyRequest) {
    return success(
      await trips.getPayment(param(request, "tripId")),
      "Trip payment retrieved",
    );
  },

  // --- Recovered Customers ---
  async createCustomer(request: FastifyRequest) {
    return success(
      await customers.create(request.body as any, actor(request)),
      "Customer created",
    );
  },
  async deleteCustomer(request: FastifyRequest) {
    return success(
      await customers.delete(param(request, "customerId"), actor(request)),
      "Customer deleted",
    );
  },
  async getCustomerWalletByCustomer(request: FastifyRequest) {
    const customerId = param(request, "customerId");
    const wallet = await prisma.wallet.findUnique({
      where: { userId: customerId },
    });
    if (!wallet) throw new Error("Wallet not found");
    return success(
      await walletService.getCustomerWallet(wallet.id),
      "Wallet retrieved",
    );
  },
  async getCustomerActivity(request: FastifyRequest) {
    return success(
      await customers.getActivity(param(request, "customerId")),
      "Customer activity retrieved",
    );
  },
  async getCustomerAddress(request: FastifyRequest) {
    return success(
      await customers.getAddresses(param(request, "customerId")),
      "Customer addresses retrieved",
    );
  },

  // --- Recovered Drivers ---
  async createDriver(request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw errors.badRequest(
        "multipart/form-data is required with a profileImage file",
      );
    }
    const body: any = request.body;
    let file = body.profileImage;
    if (Array.isArray(file)) file = file[0];
    if (!file || !file.buffer) {
      throw errors.badRequest("profileImage file is required");
    }
    return success(
      await drivers.create(
        {
          phoneNumber: String(
            body.phoneNumber?.value ?? body.phoneNumber ?? "",
          ),
          firstName: String(body.firstName?.value ?? body.firstName ?? ""),
          lastName: body.lastName
            ? String(body.lastName?.value ?? body.lastName)
            : undefined,
          email: body.email
            ? String(body.email?.value ?? body.email)
            : undefined,
        },
        actor(request),
        { contentType: file.mimetype, buffer: file.buffer as Buffer },
      ),
      "Driver created",
    );
  },
  async deleteDriver(request: FastifyRequest) {
    return success(
      await drivers.delete(param(request, "driverId"), actor(request)),
      "Driver deleted",
    );
  },
  async uploadDriverDocument(request: FastifyRequest) {
    return success(
      await drivers.uploadDocument(
        param(request, "driverId"),
        request.body,
        actor(request),
      ),
      "Document uploaded",
    );
  },
  async deleteDriverDocument(request: FastifyRequest) {
    return success(
      await drivers.deleteDocument(
        param(request, "driverId"),
        param(request, "docId"),
        actor(request),
      ),
      "Document deleted",
    );
  },
  async getDriverWalletByDriver(request: FastifyRequest) {
    const driverId = param(request, "driverId");
    const wallet = await prisma.driverWallet.findUnique({
      where: { driverId },
    });
    if (!wallet) throw new Error("Wallet not found");
    return success(
      await walletService.getDriverWallet(wallet.id),
      "Wallet retrieved",
    );
  },
  async toggleDriverOnlineStatus(request: FastifyRequest) {
    return success(
      await drivers.toggleOnlineStatus(
        param(request, "driverId"),
        request.body as any,
        actor(request),
      ),
      "Status updated",
    );
  },

  // --- Recovered Vehicles ---
  async deleteVehicle(request: FastifyRequest) {
    return success(
      await vehicles.delete(param(request, "vehicleId"), actor(request)),
      "Vehicle deleted",
    );
  },
  async uploadVehicleDocument(request: FastifyRequest) {
    return success(
      await vehicles.uploadDocument(
        param(request, "vehicleId"),
        request.body,
        actor(request),
      ),
      "Document uploaded",
    );
  },
  async assignDriver(request: FastifyRequest) {
    const { driverId, reason } = request.body as any;
    return success(
      await vehicles.assignDriver(
        driverId,
        param(request, "vehicleId"),
        reason,
        actor(request),
      ),
      "Driver assigned",
    );
  },
  async removeDriver(request: FastifyRequest) {
    const { reason } = request.body as any;
    return success(
      await vehicles.unassignDriver(
        param(request, "vehicleId"),
        reason,
        actor(request),
      ),
      "Driver removed",
    );
  },

  // --- Notifications Extension ---
  async deleteNotification(request: FastifyRequest) {
    return success(
      await notifications.delete(
        param(request, "notificationId"),
        actor(request),
      ),
      "Notification deleted",
    );
  },
  async markAllNotificationsRead(request: FastifyRequest) {
    await notifications.markAllAsRead(actor(request));
    return success(null, "All notifications marked as read");
  },
  async markAllNotificationsUnread(request: FastifyRequest) {
    await notifications.markAllAsUnread(actor(request));
    return success(null, "All notifications marked as unread");
  },

  // --- Dashboard Extensions ---
  async dashboardCounts(request: FastifyRequest) {
    const filter = parse(schemas.dashboardSummary, request.query);
    return success(
      await dashboard.counts(filter),
      "Dashboard counts retrieved",
    );
  },
  async dashboardTrips(request: FastifyRequest) {
    const filter = parse(schemas.dashboardSummary, request.query);
    return success(
      await dashboard.tripsOverview(filter),
      "Trips overview retrieved",
    );
  },
  async dashboardCustomers(request: FastifyRequest) {
    const filter = parse(schemas.dashboardSummary, request.query);
    return success(
      await dashboard.customerOverview(filter),
      "Customer overview retrieved",
    );
  },
  async recentDrivers(request: FastifyRequest) {
    const query = request.query as any;
    const limit = query.limit ? parseInt(query.limit, 10) : 10;
    return success(
      await dashboard.recentDrivers(limit),
      "Recent drivers retrieved",
    );
  },
  async recentCustomers(request: FastifyRequest) {
    const query = request.query as any;
    const limit = query.limit ? parseInt(query.limit, 10) : 10;
    return success(
      await dashboard.recentCustomers(limit),
      "Recent customers retrieved",
    );
  },

  // --- Support Tickets Extensions ---
  async createTicket(request: FastifyRequest) {
    const payload = parse(schemas.supportCreateTicket, request.body);
    return success(
      await support.createTicket(payload),
      "Support ticket created successfully",
    );
  },
  async updateTicket(request: FastifyRequest) {
    const ticketId = param(request, "ticketId");
    const payload = parse(schemas.supportUpdateTicket, request.body);
    return success(
      await support.updateTicket(ticketId, payload),
      "Support ticket updated successfully",
    );
  },
  async deleteTicket(request: FastifyRequest) {
    const ticketId = param(request, "ticketId");
    return success(
      await support.deleteTicket(ticketId),
      "Support ticket deleted successfully",
    );
  },
  async ticketStatistics(_request: FastifyRequest) {
    return success(
      await support.statistics(),
      "Support ticket statistics retrieved",
    );
  },
  async exportTickets(request: FastifyRequest) {
    // Basic export hook; you might add full pagination/filters later
    const q = parse(schemas.pagination, request.query);
    const filter = {}; // In a real app, parse this from q
    return success(
      await support.exportTickets(q.page, q.limit, filter),
      "Tickets exported",
    );
  },
  async closeTicket(request: FastifyRequest) {
    const ticketId = param(request, "ticketId");
    const context = actor(request);
    return success(
      await support.updateStatus(
        ticketId,
        { status: "CLOSED", reason: "Closed via alias API" },
        context,
      ),
      "Support ticket closed successfully",
    );
  },
  async openTicket(request: FastifyRequest) {
    const ticketId = param(request, "ticketId");
    const context = actor(request);
    return success(
      await support.updateStatus(
        ticketId,
        { status: "OPEN", reason: "Reopened via alias API" },
        context,
      ),
      "Support ticket opened successfully",
    );
  },

  async getCustomerNotifications(request: FastifyRequest) {
    const customerId = param(request, "customerId");
    const query = parse(schemas.pagination, request.query);
    const result = await customers.getNotifications(
      customerId,
      query.page,
      query.limit,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Customer notifications retrieved",
    );
  },

  async getDriverNotifications(request: FastifyRequest) {
    const driverId = param(request, "driverId");
    const query = parse(schemas.pagination, request.query);
    const result = await drivers.getNotifications(
      driverId,
      query.page,
      query.limit,
    );
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Driver notifications retrieved",
    );
  },

  async listDispatchRules(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await dispatchService.listRules(query.page, query.limit);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Dispatch rules retrieved",
    );
  },
  async getDispatchRule(request: FastifyRequest) {
    return success(
      await dispatchService.getRule(param(request, "ruleId")),
      "Dispatch rule retrieved",
    );
  },
  async createDispatchRule(request: FastifyRequest) {
    return success(
      await dispatchService.createRule(request.body, request.admin!.id),
      "Dispatch rule created",
    );
  },
  async updateDispatchRule(request: FastifyRequest) {
    return success(
      await dispatchService.updateRule(
        param(request, "ruleId"),
        request.body,
        request.admin!.id,
      ),
      "Dispatch rule updated",
    );
  },
  async deleteDispatchRule(request: FastifyRequest) {
    return success(
      await dispatchService.deleteRule(
        param(request, "ruleId"),
        request.admin!.id,
      ),
      "Dispatch rule deleted",
    );
  },
  async listCancellationRules() {
    return success(
      await dispatchService.listCancellationRules(),
      "Cancellation rules retrieved",
    );
  },
  async getCancellationRule(request: FastifyRequest) {
    return success(
      await dispatchService.getCancellationRule(param(request, "ruleId")),
      "Cancellation rule retrieved",
    );
  },
  async createCancellationRule(request: FastifyRequest) {
    return success(
      await dispatchService.createCancellationRule(
        request.body,
        request.admin!.id,
      ),
      "Cancellation rule created",
    );
  },
  async updateCancellationRule(request: FastifyRequest) {
    return success(
      await dispatchService.updateCancellationRule(
        param(request, "ruleId"),
        request.body,
        request.admin!.id,
      ),
      "Cancellation rule updated",
    );
  },
  async deleteCancellationRule(request: FastifyRequest) {
    return success(
      await dispatchService.deleteCancellationRule(
        param(request, "ruleId"),
        request.admin!.id,
      ),
      "Cancellation rule deleted",
    );
  },

  async getDispatchLogs(request: FastifyRequest) {
    const query = parse(schemas.pagination, request.query);
    const result = await dispatchService.getLogs(query.page, query.limit);
    return pageResult(
      result.items,
      result.total,
      query.page,
      query.limit,
      "Dispatch logs retrieved",
    );
  },
};
