import type { FastifyPluginAsync } from "fastify";
import { env } from "../../config/env";
import { adminController as controller } from "./admin.controller";
import { adminSubscriptionController } from "./admin-subscription.controller";
import {
  requireAdminPermission,
  requireAdminSession,
  requireCustomerStatusPermission,
  requireSuperAdmin,
} from "./admin.middleware";

const guards = (permission?: string, csrf = false, superAdmin = false) => [
  requireAdminSession,
  ...(permission ? [requireAdminPermission(permission)] : []),
  ...(superAdmin ? [requireSuperAdmin] : []),
  ...(csrf ? [] : []),
];

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: env.ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
        },
      },
    },
    controller.login,
  );
  app.post(
    "/auth/logout",
    { preHandler: guards(undefined, false) },
    controller.logout,
  );
  app.post("/auth/forgot-password", controller.forgotPassword);
  app.post("/auth/verify-otp", controller.verifyResetOtp);
  app.post("/auth/reset-password", controller.resetPassword);
  app.post(
    "/auth/change-password",
    { preHandler: guards(undefined, true) },
    controller.changePassword,
  );
  app.patch(
    "/profile",
    { preHandler: guards(undefined, true) },
    controller.updateProfile,
  );
  app.post(
    "/profile/image",
    { preHandler: guards(undefined, true) },
    controller.updateProfileImage,
  );
  app.post(
    "/auth/logout-all",
    { preHandler: guards(undefined, true) },
    controller.logoutAll,
  );
  app.get("/auth/me", { preHandler: guards() }, controller.me);
  app.get("/auth/sessions", { preHandler: guards() }, controller.sessions);
  app.delete(
    "/auth/sessions/:sessionId",
    { preHandler: guards(undefined, true) },
    controller.revokeSession,
  );

  app.get(
    "/admins",
    { preHandler: guards("admins.read") },
    controller.listAdmins,
  );
  app.post(
    "/admins",
    { preHandler: guards("admins.create", true, true) },
    controller.createAdmin,
  );
  app.get(
    "/admins/:adminId",
    { preHandler: guards("admins.read") },
    controller.getAdmin,
  );
  app.patch(
    "/admins/:adminId",
    { preHandler: guards("admins.update", true, true) },
    controller.updateAdmin,
  );
  app.patch(
    "/admins/:adminId/password",
    { preHandler: guards("admins.update", true, true) },
    controller.updateAdminPassword,
  );
  app.post(
    "/admins/:adminId/reset-password",
    { preHandler: guards("admins.update", true, true) },
    controller.resetAdminPassword,
  );
  app.patch(
    "/admins/:adminId/status",
    { preHandler: guards("admins.disable", true, true) },
    controller.updateAdminStatus,
  );
  app.get(
    "/permissions",
    { preHandler: guards("admins.read") },
    controller.permissionMatrix,
  );
  app.get(
    "/roles",
    { preHandler: guards("admins.read") },
    controller.listRoles,
  );
  app.post(
    "/admins/:adminId/roles",
    { preHandler: guards("admins.roles.manage", true, true) },
    controller.assignAdminRole,
  );
  app.delete(
    "/admins/:adminId/roles/:roleId",
    { preHandler: guards("admins.roles.manage", true, true) },
    controller.removeAdminRole,
  );
  app.get(
    "/admins/:adminId/sessions",
    { preHandler: guards("admins.read") },
    controller.listAdminSessions,
  );
  app.delete(
    "/admins/:adminId/sessions/:sessionId",
    { preHandler: guards("admins.sessions.revoke", true, true) },
    controller.revokeAdminSession,
  );
  app.post(
    "/admins/:adminId/logout-all",
    { preHandler: guards("admins.sessions.revoke", true, true) },
    controller.logoutAllAdminSessions,
  );

  // New Aliases and Endpoints for Customer Management
  app.get(
    "/customers/search",
    { preHandler: guards("customers.read") },
    controller.listCustomers,
  );
  app.get(
    "/customers/filter",
    { preHandler: guards("customers.read") },
    controller.listCustomers,
  );
  app.get(
    "/customers/export",
    { preHandler: guards("reports.export", true) },
    (req, res) => {
      req.body = {
        type: "customers",
        format: "CSV",
        dateRange: {
          from: new Date(0).toISOString(),
          to: new Date().toISOString(),
        },
      };
      return controller.createReportExport(req, res);
    },
  );
  app.get(
    "/customers/statistics",
    { preHandler: guards("reports.read") },
    (req) => controller.report(req, "customers"),
  );

  app.post(
    "/customers",
    { preHandler: guards("customers.create", true) },
    controller.createCustomer,
  );
  app.put(
    "/customers/:customerId",
    { preHandler: guards("customers.update", true) },
    controller.updateCustomer,
  );
  app.delete(
    "/customers/:customerId",
    { preHandler: guards("customers.delete", true) },
    controller.deleteCustomer,
  );

  app.patch(
    "/customers/:customerId/block",
    { preHandler: guards("customers.suspend", true) },
    (req) => {
      req.body = { status: "BLOCKED", reason: "Blocked via alias" };
      return controller.updateCustomerStatus(req);
    },
  );
  app.patch(
    "/customers/:customerId/unblock",
    { preHandler: guards("customers.suspend", true) },
    (req) => {
      req.body = { status: "ACTIVE", reason: "Unblocked via alias" };
      return controller.updateCustomerStatus(req);
    },
  );

  app.get(
    "/customers/:customerId/reviews",
    { preHandler: guards("customers.read") },
    (req) => controller.customerRelated(req, "ratings"),
  );
  app.get(
    "/customers/:customerId/wallet",
    { preHandler: guards("customers.read") },
    controller.getCustomerWalletByCustomer,
  );
  app.get(
    "/customers/:customerId/activity",
    { preHandler: guards("customers.read") },
    controller.getCustomerActivity,
  );
  app.get(
    "/customers/:customerId/address",
    { preHandler: guards("customers.read") },
    controller.getCustomerAddress,
  );

  app.get(
    "/customers",
    { preHandler: guards("customers.read") },
    controller.listCustomers,
  );
  app.get(
    "/customers/:customerId",
    { preHandler: guards("customers.read") },
    controller.getCustomer,
  );
  app.patch(
    "/customers/:customerId",
    { preHandler: guards("customers.update", true) },
    controller.updateCustomer,
  );
  app.patch(
    "/customers/:customerId/status",
    {
      preHandler: [requireAdminSession, requireCustomerStatusPermission],
    },
    controller.updateCustomerStatus,
  );
  app.get(
    "/customers/:customerId/sessions",
    { preHandler: guards("customers.read") },
    controller.listCustomerSessions,
  );
  app.delete(
    "/customers/:customerId/sessions/:sessionId",
    { preHandler: guards("customers.sessions.revoke", true) },
    controller.revokeCustomerSession,
  );
  app.get(
    "/customers/:customerId/notifications",
    { preHandler: guards("customers.read") },
    controller.getCustomerNotifications,
  );
  app.post(
    "/customers/:customerId/logout-all",
    { preHandler: guards("customers.sessions.revoke", true) },
    controller.logoutAllCustomerSessions,
  );
  for (const path of ["bookings", "trips", "payments", "ratings"] as const) {
    app.get(
      `/customers/:customerId/${path}`,
      { preHandler: guards("customers.read") },
      (request) => controller.customerRelated(request, path),
    );
  }
  app.get(
    "/customers/:customerId/support-tickets",
    { preHandler: guards("support.read") },
    (request) => controller.customerRelated(request, "support"),
  );

  app.get(
    "/drivers/kyc",
    { preHandler: guards("drivers.read") },
    controller.listDriverKyc,
  );
  app.get(
    "/drivers/kyc/:kycId",
    { preHandler: guards("drivers.read") },
    controller.getDriverKycSubmission,
  );
  app.patch(
    "/drivers/kyc/:kycId/review",
    { preHandler: guards("drivers.verify", true) },
    controller.reviewDriverKycSubmission,
  );
  app.patch(
    "/drivers/kyc/:kycId/approve",
    { preHandler: guards("drivers.verify", true) },
    controller.approveDriverKycSubmission,
  );
  app.patch(
    "/drivers/kyc/:kycId/reject",
    { preHandler: guards("drivers.verify", true) },
    controller.rejectDriverKycSubmission,
  );
  app.patch(
    "/drivers/kyc/:kycId/suspend",
    { preHandler: guards("drivers.suspend", true) },
    controller.suspendDriverKycSubmission,
  );
  app.get(
    "/drivers/kyc/:kycId/logs",
    { preHandler: guards("drivers.read") },
    controller.getDriverKycLogs,
  );
  app.get(
    "/drivers/:driverId/kyc",
    { preHandler: guards("drivers.read") },
    controller.getDriverKyc,
  );

  // New Aliases for Driver Management requested by user
  app.get(
    "/drivers/search",
    { preHandler: guards("drivers.read") },
    controller.listDrivers,
  );
  app.get(
    "/drivers/filter",
    { preHandler: guards("drivers.read") },
    controller.listDrivers,
  );
  app.get(
    "/drivers/export",
    { preHandler: guards("reports.export", true) },
    (req, res) => {
      req.body = {
        type: "drivers",
        format: "CSV",
        dateRange: {
          from: new Date(0).toISOString(),
          to: new Date().toISOString(),
        },
      };
      return controller.createReportExport(req, res);
    },
  );
  app.get(
    "/drivers/statistics",
    { preHandler: guards("reports.read") },
    (req) => controller.report(req, "drivers"),
  );

  app.post(
    "/drivers",
    { preHandler: guards("drivers.create", true) },
    controller.createDriver,
  );
  app.put(
    "/drivers/:driverId",
    { preHandler: guards("drivers.update", true) },
    controller.updateDriver,
  );
  app.post(
    "/drivers/:driverId/image",
    { preHandler: guards("drivers.update", true) },
    controller.updateDriverProfileImage,
  );
  app.delete(
    "/drivers/:driverId",
    { preHandler: guards("drivers.delete", true) },
    controller.deleteDriver,
  );

  app.patch(
    "/drivers/:driverId/approve",
    { preHandler: guards("drivers.verify", true) },
    (req) => {
      req.body = { status: "VERIFIED", reason: "Approved via alias" };
      return controller.verifyDriver(req);
    },
  );
  app.patch(
    "/drivers/:driverId/reject",
    { preHandler: guards("drivers.verify", true) },
    (req) => {
      req.body = { status: "REJECTED", reason: "Rejected via alias" };
      return controller.verifyDriver(req);
    },
  );
  app.patch(
    "/drivers/:driverId/suspend",
    { preHandler: guards("drivers.suspend", true) },
    (req) => {
      req.body = { status: "SUSPENDED", reason: "Suspended via alias" };
      return controller.updateDriverStatus(req);
    },
  );
  app.patch(
    "/drivers/:driverId/activate",
    { preHandler: guards("drivers.suspend", true) },
    (req) => {
      req.body = { status: "ACTIVE", reason: "Activated via alias" };
      return controller.updateDriverStatus(req);
    },
  );
  app.patch(
    "/drivers/:driverId/block",
    { preHandler: guards("drivers.suspend", true) },
    (req) => {
      req.body = { status: "BLOCKED", reason: "Blocked via alias" };
      return controller.updateDriverStatus(req);
    },
  );
  app.patch(
    "/drivers/:driverId/unblock",
    { preHandler: guards("drivers.suspend", true) },
    (req) => {
      req.body = { status: "ACTIVE", reason: "Unblocked via alias" };
      return controller.updateDriverStatus(req);
    },
  );

  app.patch(
    "/drivers/:driverId/kyc/approve",
    { preHandler: guards("drivers.verify", true) },
    controller.approveDriverKyc,
  );
  app.patch(
    "/drivers/:driverId/kyc/reject",
    { preHandler: guards("drivers.verify", true) },
    controller.rejectDriverKyc,
  );

  app.post(
    "/drivers/:driverId/documents",
    { preHandler: guards("drivers.update", true) },
    controller.uploadDriverDocument,
  );
  app.delete(
    "/drivers/:driverId/documents/:docId",
    { preHandler: guards("drivers.update", true) },
    controller.deleteDriverDocument,
  );

  app.get(
    "/drivers/:driverId/wallet",
    { preHandler: guards("drivers.read") },
    controller.getDriverWalletByDriver,
  );
  app.get(
    "/drivers/:driverId/reviews",
    { preHandler: guards("drivers.read") },
    (req) => controller.driverRelated(req, "ratings"),
  );
  app.get(
    "/drivers/:driverId/location",
    { preHandler: guards("drivers.read") },
    controller.getDriverLiveLocation,
  );

  app.patch(
    "/drivers/:driverId/online-status",
    { preHandler: guards("drivers.suspend", true) },
    controller.toggleDriverOnlineStatus,
  );

  app.get(
    "/drivers",
    { preHandler: guards("drivers.read") },
    controller.listDrivers,
  );
  app.get(
    "/drivers/:driverId",
    { preHandler: guards("drivers.read") },
    controller.getDriver,
  );
  app.patch(
    "/drivers/:driverId",
    { preHandler: guards("drivers.update", true) },
    controller.updateDriver,
  );
  app.patch(
    "/drivers/:driverId/status",
    { preHandler: guards("drivers.suspend", true) },
    controller.updateDriverStatus,
  );
  app.patch(
    "/drivers/:driverId/verification",
    { preHandler: guards("drivers.verify", true) },
    controller.verifyDriver,
  );
  app.post(
    "/drivers/:driverId/kyc/bulk-review",
    { preHandler: guards("drivers.verify", true) },
    controller.bulkReviewDriverKyc,
  );
  app.post(
    "/drivers/:driverId/kyc/review",
    { preHandler: guards("drivers.verify", true) },
    controller.reviewDriverKyc,
  );
  app.post(
    "/drivers/:driverId/kyc/approve",
    { preHandler: guards("drivers.verify", true) },
    controller.approveDriverKyc,
  );
  app.post(
    "/drivers/:driverId/kyc/reject",
    { preHandler: guards("drivers.verify", true) },
    controller.rejectDriverKyc,
  );
  app.patch(
    "/driver-documents/:documentId/verification",
    { preHandler: guards("drivers.verify", true) },
    controller.verifyDriverDocument,
  );
  app.post(
    "/drivers/:driverId/force-offline",
    { preHandler: guards("drivers.suspend", true) },
    controller.forceDriverOffline,
  );
  app.get(
    "/drivers/:driverId/availability",
    { preHandler: guards("drivers.read") },
    controller.getDriverAvailability,
  );
  app.get(
    "/drivers/:driverId/live-location",
    { preHandler: guards("drivers.read") },
    controller.getDriverLiveLocation,
  );
  app.get(
    "/drivers/:driverId/current-trip",
    { preHandler: guards("drivers.read") },
    controller.getDriverCurrentTrip,
  );
  app.get(
    "/drivers/:driverId/sessions",
    { preHandler: guards("drivers.read") },
    controller.listDriverSessions,
  );
  app.get(
    "/drivers/:driverId/notifications",
    { preHandler: guards("drivers.read") },
    controller.getDriverNotifications,
  );
  app.post(
    "/drivers/:driverId/logout-all",
    { preHandler: guards("drivers.suspend", true) },
    controller.logoutAllDriverSessions,
  );
  app.post(
    "/drivers/:driverId/assign-vehicle",
    { preHandler: guards("drivers.assign_vehicle", true) },
    controller.assignDriverVehicle,
  );
  app.post(
    "/drivers/:driverId/unassign-vehicle",
    { preHandler: guards("drivers.assign_vehicle", true) },
    controller.unassignDriverVehicle,
  );
  for (const path of ["trips", "ratings", "documents"] as const) {
    app.get(
      `/drivers/:driverId/${path}`,
      { preHandler: guards("drivers.read") },
      (request) => controller.driverRelated(request, path),
    );
  }
  app.get(
    "/drivers/:driverId/earnings",
    { preHandler: guards("drivers.read") },
    controller.driverEarnings,
  );

  // New Aliases and Endpoints for Vehicle Management
  app.get(
    "/vehicles/search",
    { preHandler: guards("vehicles.read") },
    controller.listVehicles,
  );
  app.get(
    "/vehicles/filter",
    { preHandler: guards("vehicles.read") },
    controller.listVehicles,
  );
  app.get(
    "/vehicles/export",
    { preHandler: guards("reports.export", true) },
    (req, res) => {
      req.body = {
        type: "vehicles",
        format: "CSV",
        dateRange: {
          from: new Date(0).toISOString(),
          to: new Date().toISOString(),
        },
      };
      return controller.createReportExport(req, res);
    },
  );
  app.get(
    "/vehicles/statistics",
    { preHandler: guards("reports.read") },
    (req) => controller.report(req, "vehicles"),
  );

  app.put(
    "/vehicles/:vehicleId",
    { preHandler: guards("vehicles.update", true) },
    controller.updateVehicle,
  );
  app.delete(
    "/vehicles/:vehicleId",
    { preHandler: guards("vehicles.delete", true) },
    controller.deleteVehicle,
  );

  app.patch(
    "/vehicles/:vehicleId/approve",
    { preHandler: guards("vehicles.verify", true) },
    (req) => {
      req.body = { status: "VERIFIED", notes: "Approved via alias" };
      return controller.verifyVehicle(req);
    },
  );
  app.patch(
    "/vehicles/:vehicleId/reject",
    { preHandler: guards("vehicles.verify", true) },
    (req) => {
      req.body = { status: "REJECTED", notes: "Rejected via alias" };
      return controller.verifyVehicle(req);
    },
  );

  app.post(
    "/vehicles/:vehicleId/documents",
    { preHandler: guards("vehicles.update", true) },
    controller.uploadVehicleDocument,
  );

  app.patch(
    "/vehicles/:vehicleId/assign-driver",
    { preHandler: guards("vehicles.update", true) },
    controller.assignDriver,
  );
  app.patch(
    "/vehicles/:vehicleId/remove-driver",
    { preHandler: guards("vehicles.update", true) },
    controller.removeDriver,
  );

  app.get(
    "/vehicles/maintenance",
    { preHandler: guards("vehicles.read") },
    controller.listVehicleMaintenance,
  );
  app.post(
    "/vehicles/maintenance",
    { preHandler: guards("vehicles.update", true) },
    controller.addVehicleMaintenance,
  );

  app.get(
    "/vehicles/insurance",
    { preHandler: guards("vehicles.read") },
    controller.listVehicleInsurance,
  );
  app.post(
    "/vehicles/insurance",
    { preHandler: guards("vehicles.update", true) },
    controller.addVehicleInsurance,
  );

  app.get(
    "/vehicles/live-location",
    { preHandler: guards("vehicles.read") },
    controller.getVehicleLiveLocation,
  );

  app.get(
    "/vehicles",
    { preHandler: guards("vehicles.read") },
    controller.listVehicles,
  );
  app.post(
    "/vehicles",
    { preHandler: guards("vehicles.create", true) },
    controller.createVehicle,
  );
  app.get(
    "/vehicles/:vehicleId",
    { preHandler: guards("vehicles.read") },
    controller.getVehicle,
  );
  app.patch(
    "/vehicles/:vehicleId",
    { preHandler: guards("vehicles.update", true) },
    controller.updateVehicle,
  );
  app.patch(
    "/vehicles/:vehicleId/status",
    { preHandler: guards("vehicles.deactivate", true) },
    controller.updateVehicleStatus,
  );
  app.patch(
    "/vehicles/:vehicleId/verification",
    { preHandler: guards("vehicles.verify", true) },
    controller.verifyVehicle,
  );
  app.get(
    "/vehicles/:vehicleId/documents",
    { preHandler: guards("vehicles.read") },
    controller.vehicleDocuments,
  );
  app.patch(
    "/vehicle-documents/:documentId/verification",
    { preHandler: guards("vehicles.verify", true) },
    controller.verifyVehicleDocument,
  );
  app.get(
    "/vehicles/:vehicleId/compliance",
    { preHandler: guards("vehicles.read") },
    controller.vehicleCompliance,
  );
  app.get(
    "/vehicles/:vehicleId/trips",
    { preHandler: guards("vehicles.read") },
    controller.vehicleTrips,
  );
  app.get(
    "/vehicle-categories",
    { preHandler: guards("vehicles.read") },
    controller.categories,
  );
  app.post(
    "/vehicle-categories",
    { preHandler: guards("vehicles.create", true) },
    controller.createCategory,
  );
  app.get(
    "/vehicle-categories/:categoryId",
    { preHandler: guards("vehicles.read") },
    controller.getCategory,
  );
  app.patch(
    "/vehicle-categories/:categoryId",
    { preHandler: guards("vehicles.update", true) },
    controller.updateCategory,
  );

  // Subscriptions
  app.post(
    "/subscriptions/plans",
    { preHandler: guards("subscriptions.create", true) },
    adminSubscriptionController.createPlan,
  );
  app.get(
    "/subscriptions/plans",
    { preHandler: guards("subscriptions.read") },
    adminSubscriptionController.getPlans,
  );
  app.get(
    "/subscriptions/plans/:id",
    { preHandler: guards("subscriptions.read") },
    adminSubscriptionController.getPlan,
  );
  app.patch(
    "/subscriptions/plans/:id",
    { preHandler: guards("subscriptions.update", true) },
    adminSubscriptionController.updatePlan,
  );
  app.delete(
    "/subscriptions/plans/:id",
    { preHandler: guards("subscriptions.delete", true) },
    adminSubscriptionController.deletePlan,
  );

  app.get(
    "/subscriptions/purchases",
    { preHandler: guards("subscriptions.read") },
    adminSubscriptionController.getPurchasedSubscriptions,
  );
  app.get(
    "/subscriptions/purchases/:id",
    { preHandler: guards("subscriptions.read") },
    adminSubscriptionController.getPurchase,
  );

  app.patch(
    "/vehicle-categories/:categoryId/status",
    { preHandler: guards("vehicles.update", true) },
    controller.updateCategoryStatus,
  );
  app.delete(
    "/vehicle-categories/:categoryId",
    { preHandler: guards("vehicles.delete", true) },
    controller.deleteCategory,
  );

  // Vehicle Brands
  app.get(
    "/vehicle-brands",
    { preHandler: guards("vehicles.read") },
    controller.brands,
  );
  app.post(
    "/vehicle-brands",
    { preHandler: guards("vehicles.create", true) },
    controller.createBrand,
  );
  app.get(
    "/vehicle-brands/:brandId",
    { preHandler: guards("vehicles.read") },
    controller.getBrand,
  );
  app.patch(
    "/vehicle-brands/:brandId",
    { preHandler: guards("vehicles.update", true) },
    controller.updateBrand,
  );
  app.patch(
    "/vehicle-brands/:brandId/status",
    { preHandler: guards("vehicles.update", true) },
    controller.updateBrandStatus,
  );

  // Vehicle Models
  app.get(
    "/vehicle-models",
    { preHandler: guards("vehicles.read") },
    controller.models,
  );
  app.post(
    "/vehicle-models",
    { preHandler: guards("vehicles.create", true) },
    controller.createModel,
  );
  app.get(
    "/vehicle-models/:modelId",
    { preHandler: guards("vehicles.read") },
    controller.getModel,
  );
  app.patch(
    "/vehicle-models/:modelId",
    { preHandler: guards("vehicles.update", true) },
    controller.updateModel,
  );
  app.patch(
    "/vehicle-models/:modelId/status",
    { preHandler: guards("vehicles.update", true) },
    controller.updateModelStatus,
  );

  // Manufacturer Years
  app.get(
    "/manufacturer-years",
    { preHandler: guards("vehicles.read") },
    controller.years,
  );
  app.post(
    "/manufacturer-years",
    { preHandler: guards("vehicles.create", true) },
    controller.createYear,
  );
  app.patch(
    "/manufacturer-years/:yearId",
    { preHandler: guards("vehicles.update", true) },
    controller.updateYear,
  );
  app.patch(
    "/manufacturer-years/:yearId/status",
    { preHandler: guards("vehicles.update", true) },
    controller.updateYearStatus,
  );


  // New Aliases and Endpoints for Booking Management
  app.get(
    "/bookings/search",
    { preHandler: guards("bookings.read") },
    controller.listBookings,
  );
  app.get(
    "/bookings/filter",
    { preHandler: guards("bookings.read") },
    controller.listBookings,
  );
  app.get(
    "/bookings/export",
    { preHandler: guards("reports.export", true) },
    (req, res) => {
      req.body = {
        type: "bookings",
        format: "CSV",
        dateRange: {
          from: new Date(0).toISOString(),
          to: new Date().toISOString(),
        },
      };
      return controller.createReportExport(req, res);
    },
  );
  app.get(
    "/bookings/statistics",
    { preHandler: guards("reports.read") },
    (req) => controller.report(req, "bookings"),
  );

  app.post(
    "/bookings",
    { preHandler: guards("bookings.create", true) },
    controller.createBooking,
  );
  app.put(
    "/bookings/:bookingId",
    { preHandler: guards("bookings.update", true) },
    controller.updateBooking,
  );
  app.delete(
    "/bookings/:bookingId",
    { preHandler: guards("bookings.delete", true) },
    controller.deleteBooking,
  );

  app.patch(
    "/bookings/:bookingId/complete",
    { preHandler: guards("bookings.update", true) },
    (req) => {
      req.body = { status: "COMPLETED", reason: "Completed via alias" };
      return controller.updateBookingStatus(req);
    },
  );
  app.patch(
    "/bookings/:bookingId/start-trip",
    { preHandler: guards("bookings.update", true) },
    (req) => {
      req.body = { status: "IN_PROGRESS", reason: "Started via alias" };
      return controller.updateBookingStatus(req);
    },
  );

  app.get(
    "/bookings/:bookingId/invoice",
    { preHandler: guards("bookings.read") },
    controller.getBookingInvoice,
  );
  app.patch(
    "/bookings/:bookingId/payment-status",
    { preHandler: guards("bookings.update", true) },
    controller.updateBookingPaymentStatus,
  );

  app.get("/bookings/live", { preHandler: guards("bookings.read") }, (req) => {
    (req.query as any).status = "TRIP_STARTED";
    return controller.listBookings(req);
  });
  app.get(
    "/bookings/upcoming",
    { preHandler: guards("bookings.read") },
    (req) => {
      (req.query as any).status = "PENDING";
      return controller.listBookings(req);
    },
  );
  app.get(
    "/bookings/history",
    { preHandler: guards("bookings.read") },
    (req) => {
      return controller.listBookings(req);
    },
  );
  app.get(
    "/bookings/cancelled",
    { preHandler: guards("bookings.read") },
    (req) => {
      (req.query as any).status = "CANCELLED";
      return controller.listBookings(req);
    },
  );
  app.get(
    "/bookings/completed",
    { preHandler: guards("bookings.read") },
    (req) => {
      (req.query as any).status = "TRIP_COMPLETED";
      return controller.listBookings(req);
    },
  );
  app.get(
    "/bookings/active",
    { preHandler: guards("bookings.read") },
    (req) => {
      (req.query as any).status = "DRIVER_ASSIGNED";
      return controller.listBookings(req);
    },
  );

  app.get(
    "/bookings",
    { preHandler: guards("bookings.read") },
    controller.listBookings,
  );
  app.get(
    "/bookings/:bookingId",
    { preHandler: guards("bookings.read") },
    controller.getBooking,
  );
  app.get(
    "/bookings/:bookingId/timeline",
    { preHandler: guards("bookings.read") },
    controller.bookingTimeline,
  );
  app.get(
    "/bookings/:bookingId/status-history",
    { preHandler: guards("bookings.read") },
    controller.bookingTimeline,
  );
  app.get(
    "/bookings/:bookingId/bids",
    { preHandler: guards("bookings.read") },
    controller.bookingBids,
  );
  app.get(
    "/bookings/:bookingId/matching-logs",
    { preHandler: guards("bookings.read") },
    controller.bookingMatchingLogs,
  );
  app.get(
    "/scheduled-bookings",
    { preHandler: guards("bookings.read") },
    controller.listScheduledBookings,
  );
  app.get(
    "/scheduled-bookings/:id",
    { preHandler: guards("bookings.read") },
    controller.getScheduledBooking,
  );
  app.patch(
    "/scheduled-bookings/:id/status",
    { preHandler: guards("bookings.update", true) },
    controller.updateScheduledBookingStatus,
  );
  app.post(
    "/scheduled-bookings/:id/assign-driver",
    { preHandler: guards("bookings.assign_driver", true) },
    controller.assignScheduledBookingDriver,
  );
  app.post(
    "/bookings/:bookingId/assign-driver",
    { preHandler: guards("bookings.assign_driver", true) },
    (request) => controller.assignBooking(request),
  );
  app.post(
    "/bookings/:bookingId/reassign-driver",
    { preHandler: guards("bookings.assign_driver", true) },
    (request) => controller.assignBooking(request, true),
  );
  app.post(
    "/bookings/:bookingId/cancel",
    { preHandler: guards("bookings.cancel", true) },
    controller.cancelBooking,
  );
  app.patch(
    "/bookings/:bookingId/status",
    { preHandler: guards("bookings.update", true) },
    controller.updateBookingStatus,
  );
  app.get(
    "/bookings/:bookingId/location-history",
    { preHandler: guards("bookings.read") },
    controller.bookingLocations,
  );
  app.get(
    "/bookings/:bookingId/payment",
    { preHandler: guards("bookings.read") },
    controller.bookingPayment,
  );

  // New Trip Management Aliases
  app.patch(
    "/trips/:tripId/start",
    { preHandler: guards("trips.update", true) },
    (req) => {
      req.body = { status: "STARTED", reason: "Started via alias" };
      return controller.updateTripStatus(req);
    },
  );
  app.patch(
    "/trips/:tripId/end",
    { preHandler: guards("trips.update", true) },
    (req) => {
      req.body = { status: "COMPLETED", reason: "Ended via alias" };
      return controller.updateTripStatus(req);
    },
  );

  app.get("/trips/live", { preHandler: guards("trips.read") }, (req) => {
    (req.query as any).status = "STARTED";
    return controller.listTrips(req);
  });
  app.get("/trips/history", { preHandler: guards("trips.read") }, (req) => {
    (req.query as any).status = "COMPLETED";
    return controller.listTrips(req);
  });
  app.get("/trips/statistics", { preHandler: guards("reports.read") }, (req) =>
    controller.report(req, "trips"),
  );

  app.get(
    "/trips/location",
    { preHandler: guards("trips.monitor") },
    controller.getGlobalTripLocations,
  );
  app.get(
    "/trips/route",
    { preHandler: guards("trips.monitor") },
    controller.getGlobalTripLocations,
  ); // Handled together

  app.get(
    "/trips/export",
    { preHandler: guards("reports.export", true) },
    (req, res) => {
      req.body = {
        type: "trips",
        format: "CSV",
        dateRange: {
          from: new Date(0).toISOString(),
          to: new Date().toISOString(),
        },
      };
      return controller.createReportExport(req, res);
    },
  );

  app.get("/trips/search", { preHandler: guards("trips.read") }, (req) =>
    controller.listTrips(req),
  );
  app.get("/trips/filter", { preHandler: guards("trips.read") }, (req) =>
    controller.listTrips(req),
  );

  app.get(
    "/trips/:tripId/payment",
    { preHandler: guards("trips.read") },
    controller.tripPayment,
  );

  app.get("/trips/active", { preHandler: guards("trips.monitor") }, (request) =>
    controller.listTrips(request, true),
  );
  app.get("/trips", { preHandler: guards("trips.read") }, (request) =>
    controller.listTrips(request),
  );
  app.get(
    "/trips/:tripId",
    { preHandler: guards("trips.read") },
    controller.getTrip,
  );
  app.get(
    "/trips/:tripId/timeline",
    { preHandler: guards("trips.read") },
    controller.tripTimeline,
  );
  app.get(
    "/trips/:tripId/live-location",
    { preHandler: guards("trips.monitor") },
    controller.tripLiveLocation,
  );
  app.get(
    "/trips/:tripId/location-history",
    { preHandler: guards("trips.read") },
    controller.tripLocationHistory,
  );
  app.patch(
    "/trips/:tripId/status",
    { preHandler: guards("trips.update", true) },
    controller.updateTripStatus,
  );
  app.post(
    "/trips/:tripId/cancel",
    { preHandler: guards("trips.cancel", true) },
    controller.cancelTrip,
  );
  app.post(
    "/trips/:tripId/force-complete",
    { preHandler: guards("trips.force_complete", true) },
    controller.forceCompleteTrip,
  );
  app.post(
    "/trips/:tripId/add-note",
    { preHandler: guards("trips.update", true) },
    controller.addTripNote,
  );
  app.post(
    "/trips/:tripId/report-incident",
    { preHandler: guards("trips.update", true) },
    controller.reportTripIncident,
  );

  app.get("/fares", { preHandler: guards("fares.read") }, controller.listFares);
  app.post(
    "/fares",
    { preHandler: guards("fares.create", true) },
    controller.createFare,
  );
  app.get(
    "/fares/history",
    { preHandler: guards("fares.read") },
    controller.fareHistory,
  );
  app.post(
    "/fares/calculate-preview",
    { preHandler: guards("fares.read", true) },
    controller.farePreview,
  );
  app.get(
    "/fares/:fareId",
    { preHandler: guards("fares.read") },
    controller.getFare,
  );
  app.patch(
    "/fares/:fareId",
    { preHandler: guards("fares.update", true) },
    controller.updateFare,
  );
  app.patch(
    "/fares/:fareId/status",
    { preHandler: guards("fares.activate", true) },
    controller.updateFareStatus,
  );

  app.get(
    "/notifications",
    { preHandler: guards("notifications.read") },
    controller.listNotifications,
  );
  app.post(
    "/notifications/send",
    { preHandler: guards("notifications.send", true) },
    (request, reply) => controller.sendNotification(request, reply, false),
  );
  app.post(
    "/notifications/schedule",
    { preHandler: guards("notifications.schedule", true) },
    (request, reply) => controller.sendNotification(request, reply, true),
  );
  app.get(
    "/notifications/:notificationId",
    { preHandler: guards("notifications.read") },
    controller.getNotification,
  );
  app.post(
    "/notifications/:notificationId/retry",
    { preHandler: guards("notifications.send", true) },
    controller.retryNotification,
  );
  app.delete(
    "/notifications/:notificationId/schedule",
    { preHandler: guards("notifications.schedule", true) },
    controller.cancelNotificationSchedule,
  );
  app.get(
    "/notification-templates",
    { preHandler: guards("notifications.read") },
    controller.notificationTemplates,
  );
  app.post(
    "/notification-templates",
    { preHandler: guards("notifications.send", true) },
    controller.createNotificationTemplate,
  );
  app.patch(
    "/notification-templates/:templateId",
    { preHandler: guards("notifications.send", true) },
    controller.updateNotificationTemplate,
  );

  app.post(
    "/notifications",
    { preHandler: guards("notifications.send", true) },
    (req, res) => controller.sendNotification(req, res, false),
  );
  app.delete(
    "/notifications/:notificationId",
    { preHandler: guards("notifications.manage", true) },
    controller.deleteNotification,
  );
  app.patch(
    "/notifications/read",
    { preHandler: guards("notifications.manage", true) },
    controller.markAllNotificationsRead,
  );
  app.patch(
    "/notifications/unread",
    { preHandler: guards("notifications.manage", true) },
    controller.markAllNotificationsUnread,
  );
  app.post(
    "/notifications/send-all",
    { preHandler: guards("notifications.send", true) },
    (req, res) => {
      req.body = { ...(req.body as any), audience: { type: "ALL_USERS" } };
      return controller.sendNotification(req, res, false);
    },
  );
  app.post(
    "/notifications/send-driver",
    { preHandler: guards("notifications.send", true) },
    (req, res) => {
      req.body = { ...(req.body as any), audience: { type: "ALL_DRIVERS" } };
      return controller.sendNotification(req, res, false);
    },
  );
  app.post(
    "/notifications/send-customer",
    { preHandler: guards("notifications.send", true) },
    (req, res) => {
      req.body = { ...(req.body as any), audience: { type: "ALL_CUSTOMERS" } };
      return controller.sendNotification(req, res, false);
    },
  );
  app.get(
    "/notifications/statistics",
    { preHandler: guards("reports.read") },
    (req) => controller.report(req, "notifications"),
  );
  app.get(
    "/notifications/history",
    { preHandler: guards("notifications.read") },
    (req) => controller.listNotifications(req),
  );
  app.get(
    "/notifications/templates",
    { preHandler: guards("notifications.read") },
    () => controller.notificationTemplates(),
  );

  app.get(
    "/reports/dashboard",

    { preHandler: guards("reports.read") },
    controller.dashboardReport,
  );
  for (const type of [
    "bookings",
    "trips",
    "revenue",
    "customers",
    "drivers",
    "vehicles",
    "cancellations",
    "payments",
    "support",
  ] as const) {
    app.get(
      `/reports/${type}`,
      { preHandler: guards("reports.read") },
      (request) => controller.report(request, type),
    );
  }
  app.post(
    "/reports/export",
    { preHandler: guards("reports.export", true) },
    controller.createReportExport,
  );
  app.get(
    "/reports/exports/:exportId",
    { preHandler: guards("reports.read") },
    controller.getReportExport,
  );

  app.get(
    "/support/categories",
    { preHandler: guards("support.read") },
    controller.supportCategories,
  );
  app.post(
    "/support/categories",
    { preHandler: guards("support.assign", true) },
    controller.createSupportCategory,
  );
  app.patch(
    "/support/categories/:categoryId",
    { preHandler: guards("support.assign", true) },
    controller.updateSupportCategory,
  );

  app.post(
    "/support/tickets",
    { preHandler: guards("support.assign", true) },
    controller.createTicket,
  );
  app.put(
    "/support/tickets/:ticketId",
    { preHandler: guards("support.assign", true) },
    controller.updateTicket,
  );
  app.delete(
    "/support/tickets/:ticketId",
    { preHandler: guards("support.assign", true) },
    controller.deleteTicket,
  );
  app.get(
    "/support/tickets/statistics",
    { preHandler: guards("support.read") },
    controller.ticketStatistics,
  );
  app.get(
    "/support/tickets/export",
    { preHandler: guards("support.read") },
    controller.exportTickets,
  );

  // Aliases for mismatched endpoints (mapped in the route exactly as requested)
  app.get(
    "/tickets",
    { preHandler: guards("support.read") },
    controller.listSupport,
  );
  app.get(
    "/tickets/search",
    { preHandler: guards("support.read") },
    controller.listSupport,
  );
  app.get(
    "/tickets/filter",
    { preHandler: guards("support.read") },
    controller.listSupport,
  );
  app.get(
    "/tickets/export",
    { preHandler: guards("support.read") },
    controller.exportTickets,
  );
  app.get(
    "/tickets/statistics",
    { preHandler: guards("support.read") },
    controller.ticketStatistics,
  );
  app.post(
    "/tickets",
    { preHandler: guards("support.assign", true) },
    controller.createTicket,
  );
  app.get(
    "/tickets/:ticketId",
    { preHandler: guards("support.read") },
    controller.getSupport,
  );
  app.put(
    "/tickets/:ticketId",
    { preHandler: guards("support.assign", true) },
    controller.updateTicket,
  );
  app.delete(
    "/tickets/:ticketId",
    { preHandler: guards("support.assign", true) },
    controller.deleteTicket,
  );
  app.patch(
    "/tickets/:ticketId/close",
    { preHandler: guards("support.close", true) },
    controller.closeTicket,
  );
  app.patch(
    "/tickets/:ticketId/open",
    { preHandler: guards("support.close", true) },
    controller.openTicket,
  );
  app.patch(
    "/tickets/:ticketId/assign",
    { preHandler: guards("support.assign", true) },
    controller.assignSupport,
  );

  app.get(
    "/support/tickets",
    { preHandler: guards("support.read") },
    controller.listSupport,
  );
  app.get(
    "/support/inbox",
    { preHandler: guards("support.read") },
    controller.supportInbox,
  );
  app.get(
    "/support/inbox/unread-count",
    { preHandler: guards("support.read") },
    controller.supportInboxUnreadCount,
  );
  app.patch(
    "/support/inbox/read-all",
    { preHandler: guards("support.read", true) },
    controller.markAllSupportInboxMessagesRead,
  );
  app.patch(
    "/support/inbox/:messageId/read",
    { preHandler: guards("support.read", true) },
    controller.markSupportInboxMessageRead,
  );
  app.get(
    "/support/tickets/:ticketId",
    { preHandler: guards("support.read") },
    controller.getSupport,
  );
  app.post(
    "/support/tickets/:ticketId/reply",
    { preHandler: guards("support.reply", true) },
    controller.replySupport,
  );
  app.patch(
    "/support/tickets/:ticketId/status",
    { preHandler: guards("support.close", true) },
    controller.updateSupportStatus,
  );
  app.patch(
    "/support/tickets/:ticketId/priority",
    { preHandler: guards("support.assign", true) },
    controller.updateSupportPriority,
  );
  app.post(
    "/support/tickets/:ticketId/assign",
    { preHandler: guards("support.assign", true) },
    controller.assignSupport,
  );
  app.post(
    "/support/tickets/:ticketId/escalate",
    { preHandler: guards("support.assign", true) },
    controller.escalateSupport,
  );
  app.post(
    "/support/tickets/:ticketId/internal-note",
    { preHandler: guards("support.reply", true) },
    controller.supportInternalNote,
  );

  app.get(
    "/config",
    { preHandler: guards("config.read") },
    controller.listConfig,
  );
  app.get(
    "/config/history",
    { preHandler: guards("config.read") },
    controller.configHistory,
  );
  app.post(
    "/config/maintenance-mode",
    { preHandler: guards("config.update", true, true) },
    controller.maintenanceMode,
  );
  app.get(
    "/config/:key",
    { preHandler: guards("config.read") },
    controller.getConfig,
  );
  app.patch(
    "/config/:key",
    { preHandler: guards("config.update", true) },
    controller.updateConfig,
  );

  app.get(
    "/dashboard",
    { preHandler: guards("dashboard.read") },
    controller.dashboardCombined,
  );
  app.get(
    "/dashboard/summary",
    { preHandler: guards("dashboard.read") },
    controller.dashboardSummary,
  );
  app.get(
    "/dashboard/booking-overview",
    { preHandler: guards("dashboard.read") },
    controller.dashboardBookingOverview,
  );
  app.get(
    "/dashboard/booking-status",
    { preHandler: guards("dashboard.read") },
    controller.dashboardBookingStatus,
  );
  app.get(
    "/dashboard/top-vehicles",
    { preHandler: guards("dashboard.read") },
    controller.dashboardTopVehicles,
  );
  app.get(
    "/dashboard/revenue-overview",
    { preHandler: guards("dashboard.revenue.read") },
    controller.dashboardRevenueOverview,
  );
  app.get(
    "/dashboard/driver-performance",
    { preHandler: guards("dashboard.read") },
    controller.dashboardDriverPerformance,
  );
  app.get(
    "/dashboard/live-operations",
    { preHandler: guards("dashboard.live_operations.read") },
    controller.liveOperations,
  );
  app.get(
    "/dashboard/recent-bookings",
    { preHandler: guards("dashboard.read") },
    controller.recentBookings,
  );

  app.get(
    "/dashboard/counts",
    { preHandler: guards("dashboard.read") },
    controller.dashboardCounts,
  );
  app.get(
    "/dashboard/revenue",
    { preHandler: guards("dashboard.revenue.read") },
    controller.dashboardRevenueOverview,
  );
  app.get(
    "/dashboard/bookings",
    { preHandler: guards("dashboard.read") },
    controller.dashboardBookingOverview,
  );
  app.get(
    "/dashboard/trips",
    { preHandler: guards("dashboard.read") },
    controller.dashboardTrips,
  );
  app.get(
    "/dashboard/drivers",
    { preHandler: guards("dashboard.read") },
    controller.dashboardDriverPerformance,
  );
  app.get(
    "/dashboard/customers",
    { preHandler: guards("dashboard.read") },
    controller.dashboardCustomers,
  );
  app.get(
    "/dashboard/recent-drivers",
    { preHandler: guards("dashboard.read") },
    controller.recentDrivers,
  );
  app.get(
    "/dashboard/recent-customers",
    { preHandler: guards("dashboard.read") },
    controller.recentCustomers,
  );
  app.get(
    "/dashboard/notifications",
    { preHandler: guards("dashboard.alerts.read") },
    controller.alerts,
  );
  app.get(
    "/dashboard/live-stats",
    { preHandler: guards("dashboard.live_operations.read") },
    controller.liveOperations,
  );

  app.get(
    "/dashboard/alerts",
    { preHandler: guards("dashboard.alerts.read") },
    controller.alerts,
  );

  app.get(
    "/audit-logs",
    { preHandler: guards("audit_logs.read") },
    controller.auditLogs,
  );
  app.get("/sos", { preHandler: guards("safety.manage") }, controller.listSos);
  app.get(
    "/sos/unread-count",
    { preHandler: guards("safety.manage") },
    controller.sosUnreadCount,
  );
  app.get(
    "/sos/emergency-contacts",
    { preHandler: guards("safety.manage") },
    controller.getEmergencyContacts,
  );
  app.get(
    "/sos/incidents",
    { preHandler: guards("safety.manage") },
    controller.getIncidentHistory,
  );
  app.get(
    "/sos/:sosId",
    { preHandler: guards("safety.manage") },
    controller.getSos,
  );
  app.get(
    "/sos/:sosId/messages",
    { preHandler: guards("safety.manage") },
    controller.getSosMessages,
  );
  app.post(
    "/sos/:sosId/messages",
    { preHandler: guards("safety.manage", true) },
    controller.createSosMessage,
  );
  app.patch(
    "/sos/:sosId/messages/read",
    { preHandler: guards("safety.manage", true) },
    controller.markSosMessagesRead,
  );
  app.post(
    "/sos/:sosId/assign",
    { preHandler: guards("safety.manage", true) },
    controller.assignSos,
  );
  app.patch(
    "/sos/:sosId",
    { preHandler: guards("safety.manage", true) },
    controller.updateSos,
  );
  app.get(
    "/compliance/audits",
    { preHandler: guards("safety.manage") },
    controller.complianceAudits,
  );
  app.get(
    "/compliance/inspections",
    { preHandler: guards("safety.manage") },
    controller.vehicleInspections,
  );
  app.get(
    "/compliance/driver-status",
    { preHandler: guards("safety.manage") },
    controller.driverComplianceStatuses,
  );
  app.post(
    "/compliance/issue-warning",
    { preHandler: guards("safety.manage", true) },
    controller.issueComplianceWarning,
  );
  app.patch(
    "/compliance/:complianceId/resolve",
    { preHandler: guards("safety.manage", true) },
    controller.resolveComplianceItem,
  );

  // --- Search ---
  app.get("/search", { preHandler: guards() }, controller.globalSearch);

  // --- Payments ---
  app.get(
    "/payments",
    { preHandler: guards("payments.read") },
    controller.listPayments,
  );
  app.get(
    "/payments/:paymentId",
    { preHandler: guards("payments.read") },
    controller.getPayment,
  );
  app.post(
    "/payments/:paymentId/retry",
    { preHandler: guards("payments.manage", true) },
    controller.retryPayment,
  );
  app.post(
    "/payments/:paymentId/reconcile",
    { preHandler: guards("payments.manage", true) },
    controller.reconcilePayment,
  );
  app.get(
    "/payment-gateway-logs",
    { preHandler: guards("payments.read") },
    controller.paymentGatewayLogs,
  );

  // --- Refunds ---
  app.get(
    "/refunds",
    { preHandler: guards("refunds.read") },
    controller.listRefunds,
  );
  app.get(
    "/refunds/:refundId",
    { preHandler: guards("refunds.read") },
    controller.getRefund,
  );
  app.post(
    "/refunds/:refundId/process",
    { preHandler: guards("refunds.manage", true) },
    controller.processRefund,
  );
  app.post(
    "/refunds/:refundId/reject",
    { preHandler: guards("refunds.manage", true) },
    controller.rejectRefund,
  );

  // --- Wallets ---
  app.get(
    "/wallets/customers",
    { preHandler: guards("payments.read") },
    controller.listCustomerWallets,
  );
  app.get(
    "/wallets/customers/:walletId",
    { preHandler: guards("payments.read") },
    controller.getCustomerWallet,
  );
  app.get(
    "/wallets/drivers",
    { preHandler: guards("payments.read") },
    controller.listDriverWallets,
  );
  app.get(
    "/wallets/drivers/:walletId",
    { preHandler: guards("payments.read") },
    controller.getDriverWallet,
  );

  // --- Payouts ---
  app.get(
    "/payouts",
    { preHandler: guards("payments.read") },
    controller.listSettlements,
  );
  app.post(
    "/payouts/manual",
    { preHandler: guards("payments.manage", true) },
    controller.createManualPayout,
  );
  app.post(
    "/payouts/:settlementId/process",
    { preHandler: guards("payments.manage", true) },
    controller.processSettlement,
  );
  app.post(
    "/payouts/:settlementId/reject",
    { preHandler: guards("payments.manage", true) },
    controller.rejectSettlement,
  );

  // --- Coupons ---
  app.get(
    "/coupons",
    { preHandler: guards("marketing.read") },
    controller.listCoupons,
  );
  app.post(
    "/coupons/bulk-generate",
    { preHandler: guards("marketing.manage", true) },
    controller.bulkGenerateCoupons,
  );
  app.get(
    "/coupons/:couponId/usage",
    { preHandler: guards("marketing.read") },
    controller.getCouponUsageStats,
  );
  app.get(
    "/coupons/:couponId/redemptions",
    { preHandler: guards("marketing.read") },
    controller.getCouponRedemptions,
  );
  app.get(
    "/coupons/:couponId",
    { preHandler: guards("marketing.read") },
    controller.getCoupon,
  );
  app.post(
    "/coupons",
    { preHandler: guards("marketing.manage", true) },
    controller.createCoupon,
  );
  app.patch(
    "/coupons/:couponId",
    { preHandler: guards("marketing.manage", true) },
    controller.updateCoupon,
  );
  app.delete(
    "/coupons/:couponId",
    { preHandler: guards("marketing.manage", true) },
    controller.deleteCoupon,
  );

  // New Coupon Aliases
  app.patch(
    "/coupons/:couponId/activate",
    { preHandler: guards("marketing.manage", true) },
    (req) => {
      req.body = { ...(req.body || {}), isActive: true };
      return controller.updateCoupon(req);
    },
  );
  app.patch(
    "/coupons/:couponId/deactivate",
    { preHandler: guards("marketing.manage", true) },
    (req) => {
      req.body = { ...(req.body || {}), isActive: false };
      return controller.updateCoupon(req);
    },
  );
  app.get(
    "/coupons/statistics",
    { preHandler: guards("reports.read") },
    (req) => controller.report(req, "coupons"),
  );
  app.get("/coupons/search", { preHandler: guards("marketing.read") }, (req) =>
    controller.listCoupons(req),
  );
  app.get("/coupons/filter", { preHandler: guards("marketing.read") }, (req) =>
    controller.listCoupons(req),
  );

  // --- Referrals ---
  app.get(
    "/referrals",
    { preHandler: guards("referrals.read") },
    controller.listReferrals,
  );
  app.get(
    "/referrals/stats",
    { preHandler: guards("referrals.read") },
    controller.getReferralStats,
  );
  app.get(
    "/referrals/:referralId",
    { preHandler: guards("referrals.read") },
    controller.getReferral,
  );

  // --- Reviews ---
  app.get(
    "/reviews",
    { preHandler: guards("reports.read") },
    controller.listReviews,
  );
  app.get("/reviews/search", { preHandler: guards("reports.read") }, (req) =>
    controller.listReviews(req),
  );
  app.get("/reviews/filter", { preHandler: guards("reports.read") }, (req) =>
    controller.listReviews(req),
  );
  app.get(
    "/reviews/statistics",
    { preHandler: guards("reports.read") },
    controller.reviewStatistics,
  );
  app.get(
    "/reviews/:reviewId",
    { preHandler: guards("reports.read") },
    controller.getReview,
  );
  app.delete(
    "/reviews/:reviewId",
    { preHandler: guards("reports.manage", true) },
    controller.deleteReview,
  );
  app.patch(
    "/reviews/:reviewId/hide",
    { preHandler: guards("reports.manage", true) },
    (req) => {
      req.body = { isHidden: true };
      return controller.updateReviewVisibility(req);
    },
  );
  app.patch(
    "/reviews/:reviewId/show",
    { preHandler: guards("reports.manage", true) },
    (req) => {
      req.body = { isHidden: false };
      return controller.updateReviewVisibility(req);
    },
  );

  // --- Incentives ---
  app.get(
    "/incentives",
    { preHandler: guards("marketing.read") },
    controller.listIncentives,
  );
  app.get(
    "/incentives/:incentiveId",
    { preHandler: guards("marketing.read") },
    controller.getIncentive,
  );
  app.post(
    "/incentives",
    { preHandler: guards("marketing.manage", true) },
    controller.createIncentive,
  );
  app.patch(
    "/incentives/:incentiveId",
    { preHandler: guards("marketing.manage", true) },
    controller.updateIncentive,
  );
  app.delete(
    "/incentives/:incentiveId",
    { preHandler: guards("marketing.manage", true) },
    controller.deleteIncentive,
  );

  // --- Dispatch Settings ---
  app.get(
    "/dispatch-settings",
    { preHandler: guards("config.read") },
    controller.getDispatchSettings,
  );
  app.patch(
    "/dispatch-settings",
    { preHandler: guards("config.update", true) },
    controller.updateDispatchSettings,
  );
  app.get(
    "/dispatch/logs",
    { preHandler: guards("config.read") },
    controller.getDispatchLogs,
  );
  app.get(
    "/dispatch-rules",
    { preHandler: guards("config.read") },
    controller.listDispatchRules,
  );
  app.post(
    "/dispatch-rules",
    { preHandler: guards("config.update", true) },
    controller.createDispatchRule,
  );
  app.get(
    "/dispatch-rules/:ruleId",
    { preHandler: guards("config.read") },
    controller.getDispatchRule,
  );
  app.patch(
    "/dispatch-rules/:ruleId",
    { preHandler: guards("config.update", true) },
    controller.updateDispatchRule,
  );
  app.delete(
    "/dispatch-rules/:ruleId",
    { preHandler: guards("config.update", true) },
    controller.deleteDispatchRule,
  );
  app.get(
    "/cancellation-rules",
    { preHandler: guards("config.read") },
    controller.listCancellationRules,
  );
  app.post(
    "/cancellation-rules",
    { preHandler: guards("config.update", true) },
    controller.createCancellationRule,
  );
  app.get(
    "/cancellation-rules/:ruleId",
    { preHandler: guards("config.read") },
    controller.getCancellationRule,
  );
  app.patch(
    "/cancellation-rules/:ruleId",
    { preHandler: guards("config.update", true) },
    controller.updateCancellationRule,
  );
  app.delete(
    "/cancellation-rules/:ruleId",
    { preHandler: guards("config.update", true) },
    controller.deleteCancellationRule,
  );

  // --- Surge ---
  app.get(
    "/surge-rules",
    { preHandler: guards("config.read") },
    controller.listSurgeRules,
  );
  app.get(
    "/surge-rules/:surgeId",
    { preHandler: guards("config.read") },
    controller.getSurgeRule,
  );
  app.post(
    "/surge-rules",
    { preHandler: guards("config.update", true) },
    controller.createSurgeRule,
  );
  app.patch(
    "/surge-rules/:surgeId",
    { preHandler: guards("config.update", true) },
    controller.updateSurgeRule,
  );
  app.delete(
    "/surge-rules/:surgeId",
    { preHandler: guards("config.update", true) },
    controller.deleteSurgeRule,
  );

  // --- Zones ---
  app.get(
    "/service-areas",
    { preHandler: guards("config.read") },
    controller.listServiceAreas,
  );
  app.get(
    "/service-areas/:areaId",
    { preHandler: guards("config.read") },
    controller.getServiceArea,
  );
  app.post(
    "/service-areas",
    { preHandler: guards("config.update", true) },
    controller.createServiceArea,
  );
  app.patch(
    "/service-areas/:areaId",
    { preHandler: guards("config.update", true) },
    controller.updateServiceArea,
  );

  app.get(
    "/service-areas/:areaId/zones",
    { preHandler: guards("config.read") },
    controller.listZones,
  );
  app.get(
    "/zones/:zoneId",
    { preHandler: guards("config.read") },
    controller.getZone,
  );
  app.post(
    "/zones",
    { preHandler: guards("config.update", true) },
    controller.createZone,
  );
  app.patch(
    "/zones/:zoneId",
    { preHandler: guards("config.update", true) },
    controller.updateZone,
  );
};
