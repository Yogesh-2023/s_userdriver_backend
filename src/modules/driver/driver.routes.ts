import type { FastifyPluginAsync } from "fastify";
import { driverController } from "./driver.controller";
import { driverSubscriptionController } from "./driver-subscription.controller";
import { requireSession, requireRoles } from "../../common/auth";
import { driverVerifyOtpRouteSchema } from "./driver-auth.contract";

const guards = (csrf = false) => {
  const middlewares: any[] = [requireSession, requireRoles("DRIVER")];

  return middlewares;
};

export const driverControllerRoutes: FastifyPluginAsync = async (app) => {
  // 1. Authentication
  app.post("/auth/request-otp", driverController.requestOtp);
  app.post("/auth/send-otp", driverController.requestOtp);
  app.post(
    "/auth/verify-otp",
    { schema: driverVerifyOtpRouteSchema },
    driverController.verifyOtp,
  );
  app.post("/auth/resend-otp", driverController.resendOtp);
  app.register(async (childApp) => {
    childApp.removeContentTypeParser("application/json");
    childApp.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (req, body, done) => {
        if (!body) return done(null, {});
        try {
          done(null, JSON.parse(body as string));
        } catch (err: any) {
          err.statusCode = 400;
          done(err, undefined);
        }
      },
    );
    childApp.post(
      "/auth/logout",
      { preHandler: guards(true) },
      driverController.logout,
    );
  });
  app.get("/auth/me", { preHandler: guards() }, driverController.me);
  app.get("/auth/session", { preHandler: guards() }, driverController.me);
  app.get(
    "/auth/sessions",
    { preHandler: guards() },
    driverController.listSessions,
  );
  app.delete(
    "/auth/sessions/:sessionId",
    { preHandler: guards(true) },
    driverController.revokeSession,
  );
  app.delete(
    "/auth/account",
    { preHandler: guards(true) },
    driverController.deleteAccount,
  );

  // 2. Profile & Onboarding
  app.post(
    "/profile",
    { preHandler: guards(true) },
    driverController.createProfile,
  );
  app.get("/profile", { preHandler: guards() }, driverController.getProfile);
  app.patch(
    "/profile",
    { preHandler: guards(true) },
    driverController.updateProfile,
  );
  app.get(
    "/onboarding-status",
    { preHandler: guards() },
    driverController.getOnboardingStatus,
  );
  app.get(
    "/account-info",
    { preHandler: guards() },
    driverController.getAccountInfo,
  );
  app.get(
    "/onboarding/status",
    { preHandler: guards() },
    driverController.getOnboardingStatus,
  );
  app.get(
    "/account/status",
    { preHandler: guards() },
    driverController.getAccountStatus,
  );
  app.post(
    "/profile/image/upload-url",
    { preHandler: guards(true) },
    driverController.createProfileImageUploadUrl,
  );
  app.post(
    "/profile/image",
    { preHandler: guards(true) },
    driverController.createProfileImageUploadUrl,
  );
  app.delete(
    "/profile/image",
    { preHandler: guards(true) },
    driverController.deleteProfileImage,
  );
  app.post(
    "/profile/driving-license",
    { preHandler: guards(true) },
    driverController.submitDrivingLicense,
  );

  // 3. KYC & Documents
  app.get(
    "/kyc/status",
    { preHandler: guards() },
    driverController.getKycStatus,
  );
  app.get(
    "/kyc/details",
    { preHandler: guards() },
    driverController.getKycDetails,
  );
  app.post("/kyc", { preHandler: guards(true) }, driverController.submitKyc);
  app.post(
    "/kyc/upload",
    { preHandler: guards(true) },
    driverController.uploadKycDocuments,
  );
  app.post(
    "/kyc/draft",
    { preHandler: guards(true) },
    driverController.uploadKycDraft,
  );
  app.post(
    "/kyc/submit",
    { preHandler: guards(true) },
    driverController.submitKyc,
  );
  app.post(
    "/kyc/reupload",
    { preHandler: guards(true) },
    driverController.reuploadDocument,
  );
  app.get(
    "/documents",
    { preHandler: guards() },
    driverController.getDocuments,
  );
  app.get(
    "/documents/expiring",
    { preHandler: guards() },
    driverController.getExpiringDocuments,
  );
  app.get(
    "/documents/:documentId",
    { preHandler: guards() },
    driverController.getDocument,
  );
  app.post(
    "/documents/:documentId/reupload",
    { preHandler: guards(true) },
    driverController.reuploadDocument,
  );
  app.post(
    "/documents/upload-url",
    { preHandler: guards(true) },
    driverController.createDocumentUploadUrl,
  );

  // 4. Vehicles & Categories
  app.get(
    "/vehicle-categories",
    { preHandler: guards() },
    driverController.getCategories,
  );
  app.get(
    "/vehicle-categories/:categoryId",
    { preHandler: guards() },
    driverController.getCategory,
  );
  app.get("/vehicles", { preHandler: guards() }, driverController.getVehicles);
  app.get(
    "/vehicle-info",
    { preHandler: guards() },
    driverController.getVehicleInfo,
  );
  app.get(
    "/vehicles/assigned",
    { preHandler: guards() },
    driverController.getAssignedVehicle,
  );
  app.get(
    "/vehicles/:vehicleId",
    { preHandler: guards() },
    driverController.getVehicle,
  );
  app.post("/vehicles", { preHandler: guards(true) }, async (request, reply) =>
    reply.code(201).send(await driverController.createVehicle(request)),
  );
  app.patch(
    "/vehicles/:vehicleId",
    { preHandler: guards(true) },
    driverController.updateVehicle,
  );
  app.delete(
    "/vehicles/:vehicleId",
    { preHandler: guards(true) },
    driverController.deleteVehicle,
  );
  app.post(
    "/vehicles/:vehicleId/documents/upload-url",
    { preHandler: guards(true) },
    driverController.uploadVehicleDocuments,
  );
  app.get(
    "/vehicles/:vehicleId/documents",
    { preHandler: guards() },
    driverController.getVehicleDocuments,
  );
  app.post(
    "/vehicles/:vehicleId/submit",
    { preHandler: guards(true) },
    driverController.submitVehicleForVerification,
  );
  app.get(
    "/vehicles/:vehicleId/verification-status",
    { preHandler: guards() },
    driverController.getVehicleVerificationStatus,
  );
  app.post(
    "/vehicles/:vehicleId/select",
    { preHandler: guards(true) },
    driverController.selectVehicle,
  );

  // Subscriptions
  app.get(
    "/subscriptions/plans",
    { preHandler: guards() },
    driverSubscriptionController.getPlans,
  );
  app.get(
    "/subscriptions/active",
    { preHandler: guards() },
    driverSubscriptionController.getActiveSubscription,
  );
  app.post(
    "/subscriptions/purchase",
    { preHandler: guards(true) },
    driverSubscriptionController.purchasePlan,
  );

  app.get(
    "/subscriptions/plans/:id",
    { preHandler: guards() },
    driverSubscriptionController.getPlan,
  );
  app.get(
    "/subscriptions/history",
    { preHandler: guards() },
    driverSubscriptionController.history,
  );
  app.get(
    "/subscriptions/:id",
    { preHandler: guards() },
    driverSubscriptionController.details,
  );
  app.get(
    "/subscriptions/:id/payment",
    { preHandler: guards() },
    driverSubscriptionController.paymentStatus,
  );

  // 5. Availability
  app.get(
    "/availability",
    { preHandler: guards() },
    driverController.getAvailability,
  );
  app.get(
    "/availability/status",
    { preHandler: guards() },
    driverController.getAvailability,
  );
  app.patch(
    "/availability",
    { preHandler: guards(true) },
    driverController.setAvailability,
  );
  app.post(
    "/availability/online",
    { preHandler: guards(true) },
    driverController.goOnline,
  );
  app.post(
    "/availability/offline",
    { preHandler: guards(true) },
    driverController.goOffline,
  );
  app.post(
    "/availability/pause",
    { preHandler: guards(true) },
    driverController.pauseAvailability,
  );
  app.post(
    "/availability/resume",
    { preHandler: guards(true) },
    driverController.resumeAvailability,
  );

  // 6. Location & Dispatch
  app.get("/heatmap", { preHandler: guards() }, driverController.getHeatmap);
  app.get(
    "/location/current",
    { preHandler: guards() },
    driverController.getCurrentLocation,
  );
  app.get(
    "/location/status",
    { preHandler: guards() },
    driverController.getCurrentLocation,
  );
  app.post(
    "/location",
    { preHandler: guards(true) },
    driverController.updateLocation,
  );

  // 6a. Dashboard & Performance
  app.get(
    "/dashboard",
    { preHandler: guards() },
    driverController.getDashboard,
  );
  app.get(
    "/statistics",
    { preHandler: guards() },
    driverController.getStatistics,
  );
  app.get(
    "/performance",
    { preHandler: guards() },
    driverController.getPerformance,
  );

  app.get(
    "/bookings/active",
    { preHandler: guards() },
    driverController.getActiveBooking,
  );
  app.get(
    "/goods/bookings",
    { preHandler: guards() },
    driverController.getActiveBooking,
  );
  app.get(
    "/driver/goods/bookings",
    { preHandler: guards() },
    driverController.getActiveBooking,
  );
  app.get(
    "/details/ongoing-trips",
    { preHandler: guards() },
    driverController.getActiveBooking,
  );
  app.get(
    "/trips/active",
    { preHandler: guards() },
    driverController.getActiveBooking,
  );
  app.get("/bookings", { preHandler: guards() }, driverController.getBookings);
  app.get(
    "/bookings/:bookingId",
    { preHandler: guards() },
    driverController.getBooking,
  );
  app.get(
    "/bookings/:bookingId/pickup-route",
    { preHandler: guards() },
    driverController.getPickupRoute,
  );
  app.get(
    "/bookings/:bookingId/pickup-eta",
    { preHandler: guards() },
    driverController.getPickupEta,
  );
  app.post(
    "/bookings/:bookingId/navigate",
    { preHandler: guards(true) },
    driverController.navigateToPickup,
  );
  app.get(
    "/bookings/:bookingId/messages",
    { preHandler: guards() },
    driverController.getBookingMessages,
  );
  app.post(
    "/bookings/:bookingId/messages",
    { preHandler: guards(true) },
    driverController.sendBookingMessage,
  );
  app.post(
    "/bookings/:bookingId/call-customer",
    { preHandler: guards(true) },
    driverController.callCustomer,
  );
  app.post(
    "/bookings/:bookingId/accept",
    { preHandler: guards(true) },
    driverController.acceptRide,
  );
  app.post(
    "/goods/:bookingId/accept",
    { preHandler: guards(true) },
    driverController.acceptRide,
  );
  app.post(
    "/bookings/:bookingId/reject",
    { preHandler: guards(true) },
    driverController.rejectRide,
  );
  app.post(
    "/goods/:bookingId/reject",
    { preHandler: guards(true) },
    driverController.rejectRide,
  );
  app.post(
    "/bookings/:bookingId/cancel",
    { preHandler: guards(true) },
    driverController.cancelAssignedRide,
  );
  app.post(
    "/goods/:bookingId/cancel",
    { preHandler: guards(true) },
    driverController.cancelAssignedRide,
  );

  // 7. Trips & Arrival
  app.post(
    "/bookings/:bookingId/arrived",
    { preHandler: guards(true) },
    driverController.reportArrival,
  );
  app.post(
    "/goods/:bookingId/arrived",
    { preHandler: guards(true) },
    driverController.reportArrival,
  );
  app.post(
    "/bookings/:bookingId/arrive",
    { preHandler: guards(true) },
    driverController.reportArrival,
  );
  app.post(
    "/bookings/:bookingId/pickup-otp/verify",
    { preHandler: guards(true) },
    driverController.verifyPickupOtp,
  );
  app.post(
    "/bookings/:bookingId/start",
    { preHandler: guards(true) },
    driverController.startBookingTrip,
  );
  app.post(
    "/goods/:bookingId/start",
    { preHandler: guards(true) },
    driverController.startBookingTrip,
  );
  app.get(
    "/bookings/:bookingId/route",
    { preHandler: guards() },
    driverController.getTripRoute,
  );
  app.get(
    "/bookings/:bookingId/stops",
    { preHandler: guards() },
    driverController.getTripStops,
  );
  app.get(
    "/bookings/:bookingId/live-status",
    { preHandler: guards() },
    driverController.getBookingLiveStatus,
  );
  app.post(
    "/bookings/:bookingId/stops/:stopId/arrive",
    { preHandler: guards(true) },
    driverController.arriveAtTripStop,
  );
  app.post(
    "/bookings/:bookingId/stops/:stopId/complete",
    { preHandler: guards(true) },
    driverController.completeTripStop,
  );
  app.post(
    "/bookings/:bookingId/customer-no-show",
    { preHandler: guards(true) },
    driverController.reportCustomerNoShow,
  );
  app.post(
    "/bookings/:bookingId/complete",
    { preHandler: guards(true) },
    driverController.completeBookingTrip,
  );
  app.post(
    "/goods/:bookingId/complete",
    { preHandler: guards(true) },
    driverController.completeBookingTrip,
  );
  app.post(
    "/bookings/:bookingId/payment/cash-confirm",
    { preHandler: guards(true) },
    driverController.confirmCashPayment,
  );
  app.post(
    "/bookings/:bookingId/add-charges",
    { preHandler: guards(true) },
    driverController.addCharges,
  );
  app.get(
    "/bookings/:bookingId/payment-status",
    { preHandler: guards() },
    driverController.getBookingPaymentStatus,
  );
  app.post(
    "/trips/:tripId/request-start-otp",
    { preHandler: guards(true) },
    driverController.requestStartOtp,
  );
  app.post(
    "/trips/:tripId/start",
    { preHandler: guards(true) },
    driverController.startTrip,
  );
  app.post(
    "/trips/:tripId/complete",
    { preHandler: guards(true) },
    driverController.completeTrip,
  );

  // 8. Financials
  app.get("/earnings", { preHandler: guards() }, driverController.getEarnings);
  app.get(
    "/earnings/summary",
    { preHandler: guards() },
    driverController.getEarningsSummary,
  );
  app.get(
    "/earnings/daily",
    { preHandler: guards() },
    driverController.getDailyEarnings,
  );
  app.get(
    "/earnings/weekly",
    { preHandler: guards() },
    driverController.getWeeklyEarnings,
  );
  app.get(
    "/earnings/monthly",
    { preHandler: guards() },
    driverController.getMonthlyEarnings,
  );
  app.get(
    "/earnings/trips/:bookingId",
    { preHandler: guards() },
    driverController.getBookingEarning,
  );
  app.get(
    "/earnings/:tripId",
    { preHandler: guards() },
    driverController.getEarningDetails,
  );
  app.get("/wallet", { preHandler: guards() }, driverController.getWallet);
  app.get(
    "/wallet/transactions",
    { preHandler: guards() },
    driverController.getWalletTransactions,
  );
  app.post(
    "/wallet/add-money",
    { preHandler: guards(true) },
    driverController.addWalletMoney,
  );
  app.post(
    "/wallet/withdraw",
    { preHandler: guards(true) },
    driverController.withdrawWallet,
  );
  app.get(
    "/wallet/withdrawals",
    { preHandler: guards() },
    driverController.getWithdrawals,
  );
  app.get(
    "/wallet/withdrawals/:withdrawalId",
    { preHandler: guards() },
    driverController.getWithdrawal,
  );
  app.get(
    "/settlements",
    { preHandler: guards() },
    driverController.getSettlements,
  );
  app.get(
    "/payout-accounts",
    { preHandler: guards() },
    driverController.getPayoutAccounts,
  );
  app.post(
    "/payout-accounts",
    { preHandler: guards(true) },
    driverController.addPayoutAccount,
  );
  app.get(
    "/bank-accounts",
    { preHandler: guards() },
    driverController.getPayoutAccounts,
  );
  app.post(
    "/bank-accounts",
    { preHandler: guards(true) },
    driverController.addPayoutAccount,
  );
  app.patch(
    "/bank-accounts/:accountId",
    { preHandler: guards(true) },
    driverController.updatePayoutAccount,
  );
  app.delete(
    "/bank-accounts/:accountId",
    { preHandler: guards(true) },
    driverController.deletePayoutAccount,
  );
  app.patch(
    "/bank-accounts/:accountId/default",
    { preHandler: guards(true) },
    driverController.setDefaultPayoutAccount,
  );
  app.post(
    "/payouts/request",
    { preHandler: guards(true) },
    driverController.requestPayout,
  );
  app.get(
    "/payouts",
    { preHandler: guards() },
    driverController.getSettlements,
  );
  app.get(
    "/payouts/:payoutId",
    { preHandler: guards() },
    driverController.getPayout,
  );

  // 9. Incentives
  app.get(
    "/incentives",
    { preHandler: guards() },
    driverController.getIncentives,
  );
  app.get(
    "/incentives/active",
    { preHandler: guards() },
    driverController.getActiveIncentives,
  );
  app.get(
    "/incentives/history",
    { preHandler: guards() },
    driverController.getIncentiveHistory,
  );
  app.get(
    "/incentives/progress",
    { preHandler: guards() },
    driverController.getIncentiveProgress,
  );

  // 10. Trip History & Ratings
  app.get(
    "/trip-history",
    { preHandler: guards() },
    driverController.getTripHistory,
  );
  app.get(
    "/trip-history/:tripId",
    { preHandler: guards() },
    driverController.getTripDetails,
  );
  app.get(
    "/ratings/summary",
    { preHandler: guards() },
    driverController.getRatingsSummary,
  );
  app.get("/ratings", { preHandler: guards() }, driverController.getRatings);
  app.post(
    "/bookings/:bookingId/customer-rating",
    { preHandler: guards(true) },
    driverController.rateBookingCustomer,
  );
  app.get(
    "/bookings/:bookingId/customer-rating",
    { preHandler: guards() },
    driverController.getBookingCustomerRating,
  );
  app.post(
    "/trips/:tripId/rate-customer",
    { preHandler: guards(true) },
    driverController.rateCustomer,
  );

  // 11. Support & Notifications
  app.get(
    "/notifications",
    { preHandler: guards() },
    driverController.getNotifications,
  );
  app.get(
    "/notifications/unread-count",
    { preHandler: guards() },
    driverController.getUnreadCount,
  );
  app.patch(
    "/notifications/:notificationId/read",
    { preHandler: guards(true) },
    driverController.markNotificationRead,
  );
  app.patch(
    "/notifications/read-all",
    { preHandler: guards(true) },
    driverController.markAllRead,
  );
  app.delete(
    "/notifications/:notificationId",
    { preHandler: guards(true) },
    driverController.deleteNotification,
  );
  app.post(
    "/device-tokens",
    { preHandler: guards(true) },
    driverController.addDeviceToken,
  );
  app.delete(
    "/device-tokens/:token",
    { preHandler: guards(true) },
    driverController.removeDeviceToken,
  );
  app.post(
    "/devices",
    { preHandler: guards(true) },
    driverController.addDevice,
  );
  app.delete(
    "/devices/:deviceId",
    { preHandler: guards(true) },
    driverController.removeDevice,
  );
  app.get(
    "/support/categories",
    { preHandler: guards() },
    driverController.getSupportCategories,
  );
  app.post(
    "/support/tickets",
    { preHandler: guards(true) },
    driverController.createTicket,
  );
  app.get(
    "/support/tickets",
    { preHandler: guards() },
    driverController.getTickets,
  );
  app.get(
    "/support/tickets/:ticketId",
    { preHandler: guards() },
    driverController.getTicket,
  );
  app.get(
    "/support/tickets/:ticketId/messages",
    { preHandler: guards() },
    driverController.getSupportMessages,
  );
  app.patch(
    "/support/tickets/:ticketId/messages/read",
    { preHandler: guards(true) },
    driverController.markSupportMessagesRead,
  );
  app.post(
    "/support/tickets/:ticketId/messages",
    { preHandler: guards(true) },
    driverController.addTicketMessage,
  );
  app.post(
    "/support/attachments",
    { preHandler: guards(true) },
    driverController.uploadSupportAttachment,
  );
  app.post(
    "/support/tickets/:ticketId/close",
    { preHandler: guards(true) },
    driverController.closeSupportTicket,
  );
  app.post(
    "/bookings/:bookingId/report",
    { preHandler: guards(true) },
    driverController.reportBooking,
  );

  // 12. Safety
  app.post(
    "/safety/sos",
    { preHandler: guards(true) },
    driverController.raiseSos,
  );
  app.post(
    "/bookings/:bookingId/sos",
    { preHandler: guards(true) },
    driverController.raiseBookingSos,
  );
  app.post(
    "/bookings/:bookingId/report-safety-issue",
    { preHandler: guards(true) },
    driverController.reportBookingSafetyIssue,
  );
  app.post(
    "/bookings/:bookingId/report-customer",
    { preHandler: guards(true) },
    driverController.reportCustomer,
  );
  app.post(
    "/bookings/:bookingId/report-accident",
    { preHandler: guards(true) },
    driverController.reportAccident,
  );
  app.post(
    "/bookings/:bookingId/report-breakdown",
    { preHandler: guards(true) },
    driverController.reportBreakdown,
  );
  app.get(
    "/safety/sos/:sosId",
    { preHandler: guards() },
    driverController.getSosDetails,
  );
  app.get("/safety/sos", { preHandler: guards() }, driverController.listSos);
  app.get(
    "/safety/sos/active",
    { preHandler: guards() },
    driverController.activeSos,
  );
  app.get(
    "/safety/sos/:sosId/messages",
    { preHandler: guards() },
    driverController.getSosMessages,
  );
  app.post(
    "/safety/sos/:sosId/messages",
    { preHandler: guards(true) },
    driverController.createSosMessage,
  );
  app.patch(
    "/safety/sos/:sosId/messages/read",
    { preHandler: guards(true) },
    driverController.markSosMessagesRead,
  );
  app.post(
    "/safety/sos/:sosId/cancel",
    { preHandler: guards(true) },
    driverController.cancelSos,
  );

  // 13. Account
  app.get(
    "/account/restrictions",
    { preHandler: guards() },
    driverController.getAccountRestrictions,
  );
  app.post(
    "/account/data-export",
    { preHandler: guards(true) },
    driverController.requestDataExport,
  );
  app.post(
    "/account/deletion-request",
    { preHandler: guards(true) },
    driverController.requestAccountDeletion,
  );
};

export { driverControllerRoutes as driverController };
