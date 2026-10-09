import type { FastifyPluginAsync } from "fastify";
import { customerController } from "./customer.controller";
import { requireSession, requireRoles } from "../../common/auth";

const guards = (csrf = false) => {
  const middlewares: any[] = [requireSession, requireRoles("CUSTOMER")];

  return middlewares;
};

export const customerControllerRoutes: FastifyPluginAsync = async (app) => {
  // 1. Authentication
  app.post("/auth/send-otp", customerController.requestOtp);
  app.post("/auth/verify-otp", customerController.verifyOtp);
  app.post("/auth/resend-otp", customerController.resendOtp);
  app.post(
    "/auth/logout",
    { preHandler: guards(true) },
    customerController.logout,
  );
  app.post(
    "/auth/logout-all",
    { preHandler: guards(true) },
    customerController.logoutAll,
  );
  app.get("/auth/session", { preHandler: guards() }, customerController.me);
  app.delete(
    "/auth/account",
    { preHandler: guards(true) },
    customerController.requestDeletion,
  );
  app.get(
    "/auth/sessions",
    { preHandler: guards() },
    customerController.listSessions,
  );
  app.delete(
    "/auth/sessions/:sessionId",
    { preHandler: guards(true) },
    customerController.revokeSession,
  );

  // 2. Profile & Onboarding
  app.post(
    "/profile",
    { preHandler: guards(true) },
    customerController.createProfile,
  );
  app.get("/profile", { preHandler: guards() }, customerController.getProfile);
  app.patch(
    "/profile",
    { preHandler: guards(true) },
    customerController.updateProfile,
  );
  app.put(
    "/profile",
    { preHandler: guards(true) },
    customerController.updateProfile,
  );
  app.patch(
    "/profile/preferences",
    { preHandler: guards(true) },
    customerController.updatePreferences,
  );
  app.post(
    "/profile/image",
    { preHandler: guards(true) },
    customerController.uploadProfileImage,
  );
  app.put(
    "/profile/image",
    { preHandler: guards(true) },
    customerController.uploadProfileImage,
  );

  app.delete(
    "/profile/image",
    { preHandler: guards(true) },
    customerController.deleteProfileImage,
  );
  app.get(
    "/onboarding-status",
    { preHandler: guards() },
    customerController.getOnboardingStatus,
  );

  // 3. Saved & Recent Addresses
  app.get(
    "/addresses/recent",
    { preHandler: guards() },
    customerController.recentAddresses,
  );
  app.post(
    "/addresses/recent",
    { preHandler: guards(true) },
    customerController.saveRecentAddress,
  );
  app.get(
    "/addresses",
    { preHandler: guards() },
    customerController.listAddresses,
  );
  app.post(
    "/addresses",
    { preHandler: guards(true) },
    customerController.createAddress,
  );
  app.get(
    "/addresses/:addressId",
    { preHandler: guards() },
    customerController.getAddress,
  );
  app.patch(
    "/addresses/:addressId",
    { preHandler: guards(true) },
    customerController.updateAddress,
  );
  app.delete(
    "/addresses/:addressId",
    { preHandler: guards(true) },
    customerController.deleteAddress,
  );
  app.patch(
    "/addresses/:addressId/default",
    { preHandler: guards(true) },
    customerController.setDefaultAddress,
  );

  // 4. Location Search & Serviceability
  app.get(
    "/locations/search",
    { preHandler: guards() },
    customerController.searchLocation,
  );
  app.post(
    "/locations/reverse-geocode",
    { preHandler: guards(true) },
    customerController.reverseGeocode,
  );
  app.post(
    "/locations/serviceability",
    { preHandler: guards(true) },
    customerController.checkServiceability,
  );
  app.get(
    "/service-areas",
    { preHandler: guards() },
    customerController.listServiceAreas,
  );

  // 5. Vehicle Categories & Fare Estimate
  app.get(
    "/vehicle-categories",
    { preHandler: guards() },
    customerController.listCategories,
  );
  app.get(
    "/vehicle-categories/:categoryId",
    { preHandler: guards() },
    customerController.getCategoryDetails,
  );
  app.post(
    "/fares/estimate",
    { preHandler: guards(true) },
    customerController.estimateFare,
  );

  // 6. Bookings
  app.post(
    "/bookings",
    { preHandler: guards(true) },
    customerController.createBookingImmediate,
  );
  app.post(
    "/bookings/scheduled",
    { preHandler: guards(true) },
    customerController.createBookingScheduled,
  );
  app.patch(
    "/bookings/:bookingId/reschedule",
    { preHandler: guards(true) },
    customerController.rescheduleBooking,
  );
  app.get(
    "/bookings/active",
    { preHandler: guards() },
    customerController.getActiveBooking,
  );
  app.get(
    "/bookings/:bookingId/timeline",
    { preHandler: guards() },
    customerController.getTimeline,
  );
  app.get(
    "/bookings/:bookingId/driver",
    { preHandler: guards() },
    customerController.getDriverDetails,
  );
  app.get(
    "/bookings/:bookingId/fare",
    { preHandler: guards() },
    customerController.getFareDetails,
  );
  app.get(
    "/bookings/:bookingId/payment",
    { preHandler: guards() },
    customerController.getPaymentDetails,
  );
  app.get(
    "/bookings/:bookingId/live-driver-location",
    { preHandler: guards() },
    customerController.getLiveDriverLocation,
  );
  app.get(
    "/bookings/:bookingId/nearby-drivers",
    { preHandler: guards() },
    customerController.getNearbyDriversForBooking,
  );
  app.post(
    "/bookings/:bookingId/cancel",
    { preHandler: guards(true) },
    customerController.cancelBooking,
  );

  // 7. Trips & Realtime
  app.get(
    "/trips/:tripId/start-otp-status",
    { preHandler: guards() },
    customerController.getTripOtpStatus,
  );
  app.get("/trips", { preHandler: guards() }, customerController.listTrips);
  app.get(
    "/trips/active",
    { preHandler: guards() },
    customerController.getActiveTrip,
  );
  app.get(
    "/trips/:tripId",
    { preHandler: guards() },
    customerController.getTripDetails,
  );
  app.get(
    "/trips/:tripId/live-location",
    { preHandler: guards() },
    customerController.getTripLiveLocation,
  );
  app.get(
    "/trips/:tripId/timeline",
    { preHandler: guards() },
    customerController.getTripTimeline,
  );
  app.get(
    "/trips/:tripId/invoice",
    { preHandler: guards() },
    customerController.getTripInvoice,
  );
  app.post(
    "/trips/:tripId/share",
    { preHandler: guards(true) },
    customerController.createTripShare,
  );

  // 8. Payments & Wallet
  app.get(
    "/bookings/:bookingId/payment-options",
    { preHandler: guards() },
    customerController.getPaymentOptions,
  );
  app.post(
    "/payments/create-order",
    { preHandler: guards(true) },
    customerController.createBookingOrder,
  );
  app.post(
    "/payments/verify",
    { preHandler: guards(true) },
    customerController.verifyBookingPayment,
  );
  app.get("/wallet", { preHandler: guards() }, customerController.getWallet);
  app.post(
    "/wallet/add-money",
    { preHandler: guards(true) },
    customerController.addWalletMoney,
  );
  app.post(
    "/wallet/verify",
    { preHandler: guards(true) },
    customerController.verifyWalletTopup,
  );
  app.post(
    "/bookings/:bookingId/change-payment-method",
    { preHandler: guards(true) },
    customerController.changePaymentMethod,
  );

  // 9. Coupons & Marketing
  app.get("/offers", { preHandler: guards() }, customerController.listOffers);
  app.get(
    "/coupons/available",
    { preHandler: guards() },
    customerController.listAvailableCoupons,
  );
  app.post(
    "/coupons/validate",
    { preHandler: guards(true) },
    customerController.validateCoupon,
  );
  app.get(
    "/coupons/history",
    { preHandler: guards() },
    customerController.getCouponHistory,
  );
  app.get(
    "/referrals/code",
    { preHandler: guards() },
    customerController.getReferralCode,
  );
  app.post(
    "/referrals/apply",
    { preHandler: guards(true) },
    customerController.applyReferralCode,
  );
  app.get(
    "/referrals",
    { preHandler: guards() },
    customerController.listReferrals,
  );
  app.get(
    "/referrals/rewards",
    { preHandler: guards() },
    customerController.listRewards,
  );

  // 10. Ratings
  app.post(
    "/trips/:tripId/rating",
    { preHandler: guards(true) },
    customerController.createRating,
  );
  app.get("/ratings", { preHandler: guards() }, customerController.listRatings);
  app.patch(
    "/ratings/:ratingId",
    { preHandler: guards(true) },
    customerController.updateRating,
  );

  // 11. Notifications
  app.get(
    "/notifications",
    { preHandler: guards() },
    customerController.listNotifications,
  );
  app.get(
    "/notifications/unread-count",
    { preHandler: guards() },
    customerController.getUnreadNotificationsCount,
  );
  app.patch(
    "/notifications/:notificationId/read",
    { preHandler: guards(true) },
    customerController.markNotificationRead,
  );
  app.patch(
    "/notifications/read-all",
    { preHandler: guards(true) },
    customerController.markAllNotificationsRead,
  );
  app.delete(
    "/notifications/:notificationId",
    { preHandler: guards(true) },
    customerController.deleteNotification,
  );
  app.post(
    "/device-tokens",
    { preHandler: guards(true) },
    customerController.registerDeviceToken,
  );
  app.delete(
    "/device-tokens/:tokenId",
    { preHandler: guards(true) },
    customerController.deleteDeviceToken,
  );

  // 12. Support
  app.get(
    "/support/categories",
    { preHandler: guards() },
    customerController.listSupportCategories,
  );
  app.post(
    "/support/tickets",
    { preHandler: guards(true) },
    customerController.createSupportTicket,
  );
  app.get(
    "/support/tickets",
    { preHandler: guards() },
    customerController.listSupportTickets,
  );
  app.post(
    "/support/attachments",
    { preHandler: guards(true) },
    customerController.uploadSupportAttachment,
  );
  app.get(
    "/support/tickets/:ticketId",
    { preHandler: guards() },
    customerController.getSupportTicket,
  );
  app.get(
    "/support/tickets/:ticketId/messages",
    { preHandler: guards() },
    customerController.getSupportMessages,
  );
  app.patch(
    "/support/tickets/:ticketId/messages/read",
    { preHandler: guards(true) },
    customerController.markSupportMessagesRead,
  );
  app.post(
    "/support/tickets/:ticketId/messages",
    { preHandler: guards(true) },
    customerController.createSupportMessage,
  );
  app.post(
    "/support/tickets/:ticketId/close",
    { preHandler: guards(true) },
    customerController.closeSupportTicket,
  );

  // 13. Safety & SOS
  app.post(
    "/safety/sos",
    { preHandler: guards(true) },
    customerController.createSos,
  );
  app.get(
    "/safety/sos",
    { preHandler: guards() },
    customerController.listSos,
  );
  app.get(
    "/safety/sos/active",
    { preHandler: guards() },
    customerController.activeSos,
  );
  app.get(
    "/safety/sos/:sosId",
    { preHandler: guards() },
    customerController.getSos,
  );
  app.get(
    "/safety/sos/:sosId/messages",
    { preHandler: guards() },
    customerController.getSosMessages,
  );
  app.post(
    "/safety/sos/:sosId/messages",
    { preHandler: guards(true) },
    customerController.createSosMessage,
  );
  app.patch(
    "/safety/sos/:sosId/messages/read",
    { preHandler: guards(true) },
    customerController.markSosMessagesRead,
  );
  app.post(
    "/safety/sos/:sosId/cancel",
    { preHandler: guards(true) },
    customerController.cancelSos,
  );
  app.post(
    "/safety/incidents",
    { preHandler: guards(true) },
    customerController.reportIncident,
  );
  app.get(
    "/emergency-contacts",
    { preHandler: guards() },
    customerController.listEmergencyContacts,
  );
  app.post(
    "/emergency-contacts",
    { preHandler: guards(true) },
    customerController.createEmergencyContact,
  );
  app.patch(
    "/emergency-contacts/:contactId",
    { preHandler: guards(true) },
    customerController.updateEmergencyContact,
  );
  app.delete(
    "/emergency-contacts/:contactId",
    { preHandler: guards(true) },
    customerController.deleteEmergencyContact,
  );

  // 14. Settings
  app.get(
    "/settings",
    { preHandler: guards() },
    customerController.getSettings,
  );
  app.patch(
    "/settings",
    { preHandler: guards(true) },
    customerController.updateSettings,
  );

  // 15. Account Deletion & Data Export
  app.post(
    "/account/deletion-request",
    { preHandler: guards(true) },
    customerController.requestDeletion,
  );
  app.post(
    "/account/deletion-request/cancel",
    { preHandler: guards(true) },
    customerController.cancelDeletion,
  );
  app.post(
    "/account/data-export",
    { preHandler: guards(true) },
    customerController.requestDataExport,
  );
  app.get(
    "/account/data-exports/:exportId",
    { preHandler: guards() },
    customerController.getDataExport,
  );

  // 16. Home Screen
  app.get("/home", { preHandler: guards() }, customerController.getHome);
  app.get(
    "/nearby-vehicles",
    { preHandler: guards() },
    customerController.getNearbyVehicles,
  );

  // 17. Booking Details, Status, Tracking
  app.get(
    "/bookings",
    { preHandler: guards() },
    customerController.getBookingList,
  );
  app.get(
    "/bookings/:bookingId",
    { preHandler: guards() },
    customerController.getBookingDetails,
  );
  app.get(
    "/bookings/:bookingId/status",
    { preHandler: guards() },
    customerController.getBookingStatus,
  );
  app.get(
    "/bookings/:bookingId/vehicle",
    { preHandler: guards() },
    customerController.getBookingVehicle,
  );
  app.get(
    "/bookings/:bookingId/driver-location",
    { preHandler: guards() },
    customerController.getDriverLocation,
  );
  app.get(
    "/bookings/:bookingId/pickup-eta",
    { preHandler: guards() },
    customerController.getPickupEta,
  );
  app.post(
    "/bookings/:bookingId/retry-search",
    { preHandler: guards(true) },
    customerController.retryDriverSearch,
  );

  // 18. Pickup OTP
  app.get(
    "/bookings/:bookingId/pickup-otp",
    { preHandler: guards() },
    customerController.getPickupOtpStatus,
  );
  app.post(
    "/bookings/:bookingId/pickup-otp/send",
    { preHandler: guards(true) },
    customerController.sendPickupOtp,
  );

  // 19. Booking Tracking Routes
  app.get(
    "/bookings/:bookingId/tracking",
    { preHandler: guards() },
    customerController.getBookingTracking,
  );
  app.get(
    "/bookings/:bookingId/route",
    { preHandler: guards() },
    customerController.getBookingRoute,
  );
  app.get(
    "/bookings/:bookingId/live",
    { preHandler: guards() },
    customerController.getBookingLiveStatus,
  );

  // 20. Trip Share & Booking Safety
  app.post(
    "/bookings/:bookingId/share",
    { preHandler: guards(true) },
    customerController.shareTrip,
  );
  app.get(
    "/bookings/:bookingId/share",
    { preHandler: guards() },
    customerController.getTripShare,
  );
  app.post(
    "/bookings/:bookingId/sos",
    { preHandler: guards(true) },
    customerController.createSosForBooking,
  );
  app.post(
    "/bookings/:bookingId/safety-report",
    { preHandler: guards(true) },
    customerController.reportSafetyIssue,
  );

  // 21. Booking Messages
  app.get(
    "/bookings/:bookingId/messages",
    { preHandler: guards() },
    customerController.getBookingMessages,
  );
  app.post(
    "/bookings/:bookingId/messages",
    { preHandler: guards(true) },
    customerController.sendBookingMessage,
  );

  // 22. Fare Breakdown & Invoice
  app.get(
    "/bookings/:bookingId/fare-breakdown",
    { preHandler: guards() },
    customerController.getFareBreakdown,
  );
  app.get(
    "/bookings/:bookingId/invoice",
    { preHandler: guards() },
    customerController.getInvoice,
  );
  app.get(
    "/bookings/:bookingId/invoice/download",
    { preHandler: guards() },
    customerController.downloadInvoice,
  );

  // 23. Booking Payment
  app.post(
    "/bookings/:bookingId/pay",
    { preHandler: guards(true) },
    customerController.processPayment,
  );
  app.get(
    "/bookings/:bookingId/payment-status",
    { preHandler: guards() },
    customerController.getPaymentStatus,
  );
  app.post(
    "/bookings/:bookingId/retry-payment",
    { preHandler: guards(true) },
    customerController.retryPayment,
  );

  // 24. Booking Rating
  app.get(
    "/bookings/:bookingId/rating",
    { preHandler: guards() },
    customerController.getBookingRating,
  );
  app.post(
    "/bookings/:bookingId/rating",
    { preHandler: guards(true) },
    customerController.createBookingRating,
  );
  app.post(
    "/bookings/:bookingId/tip",
    { preHandler: guards(true) },
    customerController.addTip,
  );

  // 25. Refund
  app.post(
    "/bookings/:bookingId/refund",
    { preHandler: guards(true) },
    customerController.requestRefund,
  );
  app.get(
    "/bookings/:bookingId/refund",
    { preHandler: guards() },
    customerController.getRefundStatus,
  );

  // 26. Booking-level Support
  app.post(
    "/bookings/:bookingId/report",
    { preHandler: guards(true) },
    customerController.reportBooking,
  );
  app.post(
    "/bookings/:bookingId/lost-item",
    { preHandler: guards(true) },
    customerController.reportLostItem,
  );

  // 27. Scheduled Rides
  app.get(
    "/scheduled-rides",
    { preHandler: guards() },
    customerController.listScheduledRides,
  );
  app.get(
    "/scheduled-rides/:scheduleId",
    { preHandler: guards() },
    customerController.getScheduledRide,
  );
  app.patch(
    "/scheduled-rides/:scheduleId",
    { preHandler: guards(true) },
    customerController.updateScheduledRide,
  );
  app.delete(
    "/scheduled-rides/:scheduleId",
    { preHandler: guards(true) },
    customerController.cancelScheduledRide,
  );
  // 24. Rentals and Outstation
  app.get(
    "/rental-packages",
    { preHandler: guards() },
    customerController.getRentalPackages,
  );
  app.get(
    "/outstation-pricing",
    { preHandler: guards() },
    customerController.getOutstationPricing,
  );
};

export { customerControllerRoutes as customerController };
