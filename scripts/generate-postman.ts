import * as fs from "fs";
import * as path from "path";
import { driverVerifyOtpResponseExamples } from "../src/modules/driver/driver-auth.contract";

// ---------------------------------------------------------
// 1. Definition of all routes
// ---------------------------------------------------------
const routes = [
  // 00 Setup & Health
  {
    folder: "00 - Setup & Health",
    name: "Health Live",
    method: "GET",
    path: "/health/live",
  },
  {
    folder: "00 - Setup & Health",
    name: "Health Ready",
    method: "GET",
    path: "/health/ready",
  },

  // 02 Customer Authentication
  {
    folder: "02 - Customer Authentication",
    name: "Send OTP",
    method: "POST",
    path: "/api/v1/customer/auth/send-otp",
    body: { mobile: "{{customerMobile}}" },
  },
  {
    folder: "02 - Customer Authentication",
    name: "Verify OTP",
    method: "POST",
    path: "/api/v1/customer/auth/verify-otp",
    body: { mobile: "{{customerMobile}}", otp: "{{otp}}", deviceId: "123" },
  },
  {
    folder: "02 - Customer Authentication",
    name: "Resend OTP",
    method: "POST",
    path: "/api/v1/customer/auth/resend-otp",
    body: { mobile: "{{customerMobile}}" },
  },
  {
    folder: "02 - Customer Authentication",
    name: "Get Auth Session",
    method: "GET",
    path: "/api/v1/customer/auth/session",
  },
  {
    folder: "02 - Customer Authentication",
    name: "List Sessions",
    method: "GET",
    path: "/api/v1/customer/auth/sessions",
  },
  {
    folder: "02 - Customer Authentication",
    name: "Revoke Session",
    method: "DELETE",
    path: "/api/v1/customer/auth/sessions/{{sessionId}}",
    csrf: "customerCsrfToken",
  },
  {
    folder: "02 - Customer Authentication",
    name: "Logout",
    method: "POST",
    path: "/api/v1/customer/auth/logout",
    csrf: "customerCsrfToken",
    noJsonContentType: true,
  },
  {
    folder: "02 - Customer Authentication",
    name: "Logout All Sessions",
    method: "POST",
    path: "/api/v1/customer/auth/logout-all",
    csrf: "customerCsrfToken",
    noJsonContentType: true,
  },

  // 03 Customer Profile & Onboarding
  {
    folder: "03 - Customer Profile & Onboarding",
    name: "Get Profile",
    method: "GET",
    path: "/api/v1/customer/profile",
  },
  {
    folder: "03 - Customer Profile & Onboarding",
    name: "Create Customer Profile",
    method: "POST",
    path: "/api/v1/customer/profile",
    formData: [
      { key: "fullName", value: "Customer John", type: "text" },
      { key: "email", value: "customer@example.com", type: "text" },
      { key: "dateOfBirth", value: "1998-05-15", type: "text" },
      { key: "gender", value: "MALE", type: "text" },
      { key: "preferredLanguage", value: "en", type: "text" },
      { key: "profileImage", type: "file", src: [] },
    ],
    csrf: "customerCsrfToken",
  },
  {
    folder: "03 - Customer Profile & Onboarding",
    name: "Update Profile",
    method: "PATCH",
    path: "/api/v1/customer/profile",
    body: { fullName: "Customer John", email: "customer@example.com" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "03 - Customer Profile & Onboarding",
    name: "Update Preferences",
    method: "PATCH",
    path: "/api/v1/customer/profile/preferences",
    body: { preferredLanguage: "en" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "03 - Customer Profile & Onboarding",
    name: "Get Profile Image Upload URL",
    method: "GET",
    path: "/api/v1/customer/profile/image/upload-url",
  },
  {
    folder: "03 - Customer Profile & Onboarding",
    name: "Delete Profile Image",
    method: "DELETE",
    path: "/api/v1/customer/profile/image",
    csrf: "customerCsrfToken",
  },
  {
    folder: "03 - Customer Profile & Onboarding",
    name: "Get Onboarding Status",
    method: "GET",
    path: "/api/v1/customer/onboarding-status",
  },

  // 04 Customer Addresses
  {
    folder: "04 - Customer Addresses",
    name: "List Addresses",
    method: "GET",
    path: "/api/v1/customer/addresses",
  },
  {
    folder: "04 - Customer Addresses",
    name: "Create Address",
    method: "POST",
    path: "/api/v1/customer/addresses",
    body: {
      name: "Home",
      address: "123 Main St",
      latitude: 19.0,
      longitude: 72.0,
      isDefault: true,
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "04 - Customer Addresses",
    name: "Get Address Details",
    method: "GET",
    path: "/api/v1/customer/addresses/{{addressId}}",
  },
  {
    folder: "04 - Customer Addresses",
    name: "Update Address",
    method: "PATCH",
    path: "/api/v1/customer/addresses/{{addressId}}",
    body: { name: "Work" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "04 - Customer Addresses",
    name: "Delete Address",
    method: "DELETE",
    path: "/api/v1/customer/addresses/{{addressId}}",
    csrf: "customerCsrfToken",
  },
  {
    folder: "04 - Customer Addresses",
    name: "Set Default Address",
    method: "PATCH",
    path: "/api/v1/customer/addresses/{{addressId}}/default",
    csrf: "customerCsrfToken",
  },
  {
    folder: "04 - Customer Addresses",
    name: "Get Recent Addresses",
    method: "GET",
    path: "/api/v1/customer/addresses/recent",
  },

  // 05 Customer Location & Serviceability
  {
    folder: "05 - Customer Location & Serviceability",
    name: "Search Locations",
    method: "GET",
    path: "/api/v1/customer/locations/search?query=Delhi",
  },
  {
    folder: "05 - Customer Location & Serviceability",
    name: "Reverse Geocode",
    method: "POST",
    path: "/api/v1/customer/locations/reverse-geocode",
    body: { latitude: 19.0, longitude: 72.0 },
    csrf: "customerCsrfToken",
  },
  {
    folder: "05 - Customer Location & Serviceability",
    name: "Check Serviceability",
    method: "POST",
    path: "/api/v1/customer/locations/serviceability",
    body: { latitude: 19.0, longitude: 72.0 },
    csrf: "customerCsrfToken",
  },
  {
    folder: "05 - Customer Location & Serviceability",
    name: "List Service Areas",
    method: "GET",
    path: "/api/v1/customer/service-areas",
  },

  // 06 Customer Vehicle Categories
  {
    folder: "06 - Customer Vehicle Categories",
    name: "List Categories",
    method: "GET",
    path: "/api/v1/customer/vehicle-categories?latitude=19.0&longitude=72.0",
  },
  {
    folder: "06 - Customer Vehicle Categories",
    name: "Get Category Details",
    method: "GET",
    path: "/api/v1/customer/vehicle-categories/{{categoryId}}",
  },

  // 07 Customer Fare Estimate
  {
    folder: "07 - Customer Fare Estimate",
    name: "Estimate Fare",
    method: "POST",
    path: "/api/v1/pricing/estimate",
    body: {
      vehicleCategoryId: "{{categoryId}}",
      distanceMeters: 5000,
      durationSeconds: 600,
    },
    csrf: "customerCsrfToken",
  },

  // 08 Customer Immediate Booking
  {
    folder: "08 - Customer Immediate Booking",
    name: "Create Booking",
    method: "POST",
    path: "/api/v1/bookings",
    body: {
      vehicleCategoryId: "{{categoryId}}",
      type: "IMMEDIATE",
      rideType: "CITY",
      pickup: { address: "Delhi St", latitude: 19.0, longitude: 72.0 },
      drop: { address: "Noida St", latitude: 19.1, longitude: 72.1 },
    },
    csrf: "customerCsrfToken",
  },

  // 09 - Customer Scheduled Booking
  {
    folder: "09 - Customer Scheduled Booking",
    name: "Create Scheduled Booking",
    method: "POST",
    path: "/api/v1/bookings",
    body: {
      vehicleCategoryId: "{{categoryId}}",
      type: "SCHEDULED",
      rideType: "CITY",
      pickup: { address: "Delhi St", latitude: 19.0, longitude: 72.0 },
      drop: { address: "Noida St", latitude: 19.1, longitude: 72.1 },
      scheduledAt: "{{scheduledAt}}",
    },
    csrf: "customerCsrfToken",
    preRequest:
      'const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000); pm.variables.set("scheduledAt", scheduledAt.toISOString());',
  },
  {
    folder: "09 - Customer Scheduled Booking",
    name: "Reschedule Booking",
    method: "PATCH",
    path: "/api/v1/bookings/{{bookingId}}/reschedule",
    body: { scheduledAt: "{{scheduledAt}}" },
    csrf: "customerCsrfToken",
    preRequest:
      'const scheduledAt = new Date(Date.now() + 3 * 60 * 60 * 1000); pm.variables.set("scheduledAt", scheduledAt.toISOString());',
  },

  // 10 Customer Active Booking
  {
    folder: "10 - Customer Active Booking",
    name: "Get Active Booking",
    method: "GET",
    path: "/api/v1/bookings/active",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Details",
    method: "GET",
    path: "/api/v1/bookings/{{bookingId}}",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking List",
    method: "GET",
    path: "/api/v1/bookings?page=1&limit=10",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Timeline",
    method: "GET",
    path: "/api/v1/bookings/{{bookingId}}/timeline",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Driver Details",
    method: "GET",
    path: "/api/v1/bookings/{{bookingId}}/driver",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Fare Details",
    method: "GET",
    path: "/api/v1/bookings/{{bookingId}}/fare",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Payment Details",
    method: "GET",
    path: "/api/v1/bookings/{{bookingId}}/payment",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Live Driver Location",
    method: "GET",
    path: "/api/v1/bookings/{{bookingId}}/live-driver-location",
  },

  // 11 Customer Trips & Tracking
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Get Trip OTP Status",
    method: "GET",
    path: "/api/v1/customer/trips/{{tripId}}/start-otp-status",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "List Customer Trips",
    method: "GET",
    path: "/api/v1/customer/trips",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Get Active Trip",
    method: "GET",
    path: "/api/v1/customer/trips/active",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Get Trip Details",
    method: "GET",
    path: "/api/v1/customer/trips/{{tripId}}",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Get Trip Live Location",
    method: "GET",
    path: "/api/v1/customer/trips/{{tripId}}/live-location",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Get Trip Timeline",
    method: "GET",
    path: "/api/v1/customer/trips/{{tripId}}/timeline",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Get Trip Invoice",
    method: "GET",
    path: "/api/v1/customer/trips/{{tripId}}/invoice",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Create Trip Share Link",
    method: "POST",
    path: "/api/v1/customer/trips/{{tripId}}/share",
    csrf: "customerCsrfToken",
  },

  // 12 Customer Cancellation
  {
    folder: "12 - Customer Cancellation",
    name: "Cancel Booking",
    method: "POST",
    path: "/api/v1/bookings/{{bookingId}}/cancel",
    body: { reasonCode: "DRIVER_DELAYED", reason: "Driver took too long" },
    csrf: "customerCsrfToken",
  },

  // 13 Customer Payments
  {
    folder: "13 - Customer Payments",
    name: "Get Payment Options",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/payment-options",
  },
  {
    folder: "13 - Customer Payments",
    name: "Create Payment Order",
    method: "POST",
    path: "/api/v1/payments/create-order",
    body: { bookingId: "{{bookingId}}", method: "CREDIT_CARD" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "13 - Customer Payments",
    name: "Verify Payment",
    method: "POST",
    path: "/api/v1/payments/verify",
    body: {
      paymentId: "{{paymentId}}",
      providerPaymentId: "dummy_pay_123",
      signature: "dummy_sig_123",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "13 - Customer Payments",
    name: "Change Payment Method",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/change-payment-method",
    body: { method: "CASH" },
    csrf: "customerCsrfToken",
  },

  // 14 Customer Wallet
  {
    folder: "14 - Customer Wallet",
    name: "Get Wallet Balance",
    method: "GET",
    path: "/api/v1/customer/wallet",
  },
  {
    folder: "14 - Customer Wallet",
    name: "Add Money",
    method: "POST",
    path: "/api/v1/customer/wallet/add-money",
    body: { amount: 500 },
    csrf: "customerCsrfToken",
  },
  {
    folder: "14 - Customer Wallet",
    name: "Verify Wallet Topup",
    method: "POST",
    path: "/api/v1/customer/wallet/verify",
    body: {
      paymentId: "{{paymentId}}",
      providerPaymentId: "dummy_topup_123",
      signature: "dummy_topup_sig_123",
    },
    csrf: "customerCsrfToken",
  },

  // 15 Customer Coupons & Offers
  {
    folder: "15 - Customer Coupons & Offers",
    name: "List Offers",
    method: "GET",
    path: "/api/v1/customer/offers",
  },
  {
    folder: "15 - Customer Coupons & Offers",
    name: "List Available Coupons",
    method: "GET",
    path: "/api/v1/customer/coupons/available",
  },
  {
    folder: "15 - Customer Coupons & Offers",
    name: "Validate Coupon",
    method: "POST",
    path: "/api/v1/customer/coupons/validate",
    body: { couponCode: "DISCOUNT50" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "15 - Customer Coupons & Offers",
    name: "Get Coupon History",
    method: "GET",
    path: "/api/v1/customer/coupons/history",
  },

  // 16 Customer Referrals
  {
    folder: "16 - Customer Referrals",
    name: "Get Referral Code",
    method: "GET",
    path: "/api/v1/customer/referrals/code",
  },
  {
    folder: "16 - Customer Referrals",
    name: "Apply Referral Code",
    method: "POST",
    path: "/api/v1/customer/referrals/apply",
    body: { referralCode: "REF12345" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "16 - Customer Referrals",
    name: "List Referrals",
    method: "GET",
    path: "/api/v1/customer/referrals",
  },
  {
    folder: "16 - Customer Referrals",
    name: "List Rewards",
    method: "GET",
    path: "/api/v1/customer/referrals/rewards",
  },

  // 17 Customer Ratings
  {
    folder: "17 - Customer Ratings",
    name: "Submit Rating",
    method: "POST",
    path: "/api/v1/customer/trips/{{tripId}}/rating",
    body: {
      subjectUserId: "{{driverId}}",
      subjectType: "DRIVER",
      score: 5,
      comment: "Excellent ride!",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "17 - Customer Ratings",
    name: "List Ratings",
    method: "GET",
    path: "/api/v1/customer/ratings",
  },
  {
    folder: "17 - Customer Ratings",
    name: "Update Rating",
    method: "PATCH",
    path: "/api/v1/customer/ratings/{{ratingId}}",
    body: { score: 4 },
    csrf: "customerCsrfToken",
  },

  // 18 Customer Notifications
  {
    folder: "18 - Customer Notifications",
    name: "List Notifications",
    method: "GET",
    path: "/api/v1/customer/notifications",
  },
  {
    folder: "18 - Customer Notifications",
    name: "Get Unread Count",
    method: "GET",
    path: "/api/v1/customer/notifications/unread-count",
  },
  {
    folder: "18 - Customer Notifications",
    name: "Mark Notification Read",
    method: "PATCH",
    path: "/api/v1/customer/notifications/{{notificationId}}/read",
    csrf: "customerCsrfToken",
  },
  {
    folder: "18 - Customer Notifications",
    name: "Mark All Notifications Read",
    method: "PATCH",
    path: "/api/v1/customer/notifications/read-all",
    csrf: "customerCsrfToken",
  },
  {
    folder: "18 - Customer Notifications",
    name: "Delete Notification",
    method: "DELETE",
    path: "/api/v1/customer/notifications/{{notificationId}}",
    csrf: "customerCsrfToken",
  },
  {
    folder: "18 - Customer Notifications",
    name: "Register Device Token",
    method: "POST",
    path: "/api/v1/customer/device-tokens",
    body: { token: "dummy_token_123", platform: "ANDROID" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "18 - Customer Notifications",
    name: "Delete Device Token",
    method: "DELETE",
    path: "/api/v1/customer/device-tokens/{{deviceTokenId}}",
    csrf: "customerCsrfToken",
  },

  // 19 Customer Support
  {
    folder: "19 - Customer Support",
    name: "List Categories",
    method: "GET",
    path: "/api/v1/customer/support/categories",
  },
  {
    folder: "19 - Customer Support",
    name: "Create Support Ticket",
    method: "POST",
    path: "/api/v1/customer/support/tickets",
    body: {
      categoryId: "{{supportCategoryId}}",
      subject: "Fare Issue",
      message: "The calculated fare was higher than estimated.",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "19 - Customer Support",
    name: "List Support Tickets",
    method: "GET",
    path: "/api/v1/customer/support/tickets",
  },
  {
    folder: "19 - Customer Support",
    name: "Get Support Ticket Details",
    method: "GET",
    path: "/api/v1/customer/support/tickets/{{ticketId}}",
  },
  {
    folder: "19 - Customer Support",
    name: "Send Support Message",
    method: "POST",
    path: "/api/v1/customer/support/tickets/{{ticketId}}/messages",
    body: { message: "I would like to update my ticket description." },
    csrf: "customerCsrfToken",
  },
  {
    folder: "19 - Customer Support",
    name: "Close Support Ticket",
    method: "POST",
    path: "/api/v1/customer/support/tickets/{{ticketId}}/close",
    csrf: "customerCsrfToken",
  },

  // 20 Customer Safety & SOS
  {
    folder: "20 - Customer Safety & SOS",
    name: "Create SOS",
    method: "POST",
    path: "/api/v1/customer/safety/sos",
    body: {
      bookingId: "{{bookingId}}",
      latitude: 19.0,
      longitude: 72.0,
      message: "Emergency situation!",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "Get SOS Details",
    method: "GET",
    path: "/api/v1/customer/safety/sos/{{sosId}}",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "Cancel SOS",
    method: "POST",
    path: "/api/v1/customer/safety/sos/{{sosId}}/cancel",
    csrf: "customerCsrfToken",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "Report Incident",
    method: "POST",
    path: "/api/v1/customer/safety/incidents",
    body: {
      bookingId: "{{bookingId}}",
      type: "ACCIDENT",
      description: "Minor collision.",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "List Emergency Contacts",
    method: "GET",
    path: "/api/v1/customer/emergency-contacts",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "Create Emergency Contact",
    method: "POST",
    path: "/api/v1/customer/emergency-contacts",
    body: {
      name: "Emergency Person",
      phone: "+919999999999",
      relationship: "SPOUSE",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "Update Emergency Contact",
    method: "PATCH",
    path: "/api/v1/customer/emergency-contacts/{{contactId}}",
    body: { relationship: "PARENT" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "Delete Emergency Contact",
    method: "DELETE",
    path: "/api/v1/customer/emergency-contacts/{{contactId}}",
    csrf: "customerCsrfToken",
  },

  // 21 Customer Settings & Account
  {
    folder: "21 - Customer Settings & Account",
    name: "Get Settings",
    method: "GET",
    path: "/api/v1/customer/settings",
  },
  {
    folder: "21 - Customer Settings & Account",
    name: "Update Settings",
    method: "PATCH",
    path: "/api/v1/customer/settings",
    body: { preferredLanguage: "hi" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "21 - Customer Settings & Account",
    name: "Request Account Deletion",
    method: "POST",
    path: "/api/v1/customer/account/deletion-request",
    csrf: "customerCsrfToken",
  },
  {
    folder: "21 - Customer Settings & Account",
    name: "Cancel Deletion Request",
    method: "POST",
    path: "/api/v1/customer/account/deletion-request/cancel",
    csrf: "customerCsrfToken",
  },
  {
    folder: "21 - Customer Settings & Account",
    name: "Request Data Export",
    method: "POST",
    path: "/api/v1/customer/account/data-export",
    csrf: "customerCsrfToken",
  },
  {
    folder: "21 - Customer Settings & Account",
    name: "Get Data Export Status",
    method: "GET",
    path: "/api/v1/customer/account/data-exports/{{exportId}}",
  },

  // 30 Driver Authentication
  {
    folder: "30 - Driver Authentication",
    name: "Request OTP",
    method: "POST",
    path: "/api/v1/driver/auth/request-otp",
    body: { mobile: "{{driverMobile}}" },
  },
  {
    folder: "30 - Driver Authentication",
    name: "Send OTP (Canonical)",
    method: "POST",
    path: "/api/v1/driver/auth/send-otp",
    body: { mobile: "{{driverMobile}}" },
  },
  {
    folder: "30 - Driver Authentication",
    name: "Verify OTP",
    method: "POST",
    path: "/api/v1/driver/auth/verify-otp",
    body: { mobile: "{{driverMobile}}", otp: "{{otp}}", deviceId: "456" },
    responses: [
      {
        name: "First-time driver",
        body: driverVerifyOtpResponseExamples.firstTimeDriver,
      },
      {
        name: "Returning driver with saved profile",
        body: driverVerifyOtpResponseExamples.returningDriver,
      },
    ],
  },
  {
    folder: "30 - Driver Authentication",
    name: "Resend OTP",
    method: "POST",
    path: "/api/v1/driver/auth/resend-otp",
    body: { mobile: "{{driverMobile}}" },
  },
  {
    folder: "30 - Driver Authentication",
    name: "Get Session Me",
    method: "GET",
    path: "/api/v1/driver/auth/me",
  },
  {
    folder: "30 - Driver Authentication",
    name: "Get Auth Session (Canonical)",
    method: "GET",
    path: "/api/v1/driver/auth/session",
  },
  {
    folder: "30 - Driver Authentication",
    name: "List Sessions",
    method: "GET",
    path: "/api/v1/driver/auth/sessions",
  },
  {
    folder: "30 - Driver Authentication",
    name: "Revoke Session",
    method: "DELETE",
    path: "/api/v1/driver/auth/sessions/{{sessionId}}",
    csrf: "driverCsrfToken",
  },
  {
    folder: "30 - Driver Authentication",
    name: "Delete Driver Account (Canonical)",
    method: "DELETE",
    path: "/api/v1/driver/auth/account",
    csrf: "driverCsrfToken",
  },
  {
    folder: "30 - Driver Authentication",
    name: "Logout",
    method: "POST",
    path: "/api/v1/driver/auth/logout",
    csrf: "driverCsrfToken",
  },
  {
    folder: "30 - Driver Authentication",
    name: "Logout All Sessions",
    method: "POST",
    path: "/api/v1/driver/auth/logout-all",
    csrf: "driverCsrfToken",
  },

  // 31 Driver Profile & Onboarding
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Create or Complete Driver Profile",
    method: "POST",
    path: "/api/v1/driver/profile",
    body: {
      fullName: "Driver Bob",
      email: "driverbob@example.com",
      dateOfBirth: "1990-01-01",
      gender: "MALE",
      profileImageUrl: "https://cdn.example.com/driver/profile.jpg",
      addressLine1: "Main St",
      city: "Delhi",
      state: "Delhi",
      postalCode: "110001",
      country: "India",
      drivingLicenseNumber: "DL999999",
      drivingLicenseIssueDate: "2015-01-01",
      drivingLicenseExpiryDate: "2035-01-01",
      drivingExperienceYears: 8,
      emergencyContactName: "Brother",
      emergencyContactPhone: "+919999999998",
      emergencyContactRelation: "SIBLING",
    },
    csrf: "driverCsrfToken",
  },
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Get Driver Profile",
    method: "GET",
    path: "/api/v1/driver/profile",
  },
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Update Driver Profile",
    method: "PATCH",
    path: "/api/v1/driver/profile",
    body: { fullName: "Driver Bob Updated" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Get Onboarding Status",
    method: "GET",
    path: "/api/v1/driver/onboarding-status",
  },
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Get Onboarding Status (Canonical)",
    method: "GET",
    path: "/api/v1/driver/onboarding/status",
  },
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Get Account Status",
    method: "GET",
    path: "/api/v1/driver/account/status",
  },
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Get Profile Image Upload URL",
    method: "POST",
    path: "/api/v1/driver/profile/image/upload-url",
    formData: [{ key: "profileImage", type: "file", src: [] }],
    csrf: "driverCsrfToken",
  },
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Get Profile Image Upload URL (Canonical)",
    method: "POST",
    path: "/api/v1/driver/profile/image",
    formData: [{ key: "profileImage", type: "file", src: [] }],
    csrf: "driverCsrfToken",
  },
  {
    folder: "31 - Driver Profile & Onboarding",
    name: "Delete Profile Image",
    method: "DELETE",
    path: "/api/v1/driver/profile/image",
    csrf: "driverCsrfToken",
  },

  // 32 Driver KYC
  {
    folder: "32 - Driver KYC",
    name: "Get KYC Status",
    method: "GET",
    path: "/api/v1/driver/kyc/status",
  },
  {
    folder: "32 - Driver KYC",
    name: "Get KYC Details",
    method: "GET",
    path: "/api/v1/driver/kyc/details",
  },
  {
    folder: "32 - Driver KYC",
    name: "Submit KYC (Canonical)",
    method: "POST",
    path: "/api/v1/driver/kyc",
    csrf: "driverCsrfToken",
  },
  {
    folder: "32 - Driver KYC",
    name: "Submit KYC",
    method: "POST",
    path: "/api/v1/driver/kyc/submit",
    csrf: "driverCsrfToken",
  },
  {
    folder: "32 - Driver KYC",
    name: "Reupload Rejected KYC Document",
    method: "POST",
    path: "/api/v1/driver/kyc/reupload",
    body: {
      documentId: "{{driverDocumentId}}",
      contentType: "image/jpeg",
      sizeBytes: 500000,
    },
    csrf: "driverCsrfToken",
  },

  // 33 Driver Documents
  {
    folder: "33 - Driver Documents",
    name: "List Documents",
    method: "GET",
    path: "/api/v1/driver/documents",
  },
  {
    folder: "33 - Driver Documents",
    name: "List Expiring Documents",
    method: "GET",
    path: "/api/v1/driver/documents/expiring?withinDays=30",
  },
  {
    folder: "33 - Driver Documents",
    name: "Get Document",
    method: "GET",
    path: "/api/v1/driver/documents/{{driverDocumentId}}",
  },
  {
    folder: "33 - Driver Documents",
    name: "Upload KYC Document",
    method: "POST",
    path: "/api/v1/driver/documents/upload-url",
    formData: [
      { key: "DRIVING_LICENSE", type: "file", src: [] },
      { key: "AADHAAR_FRONT", type: "file", src: [] },
      { key: "AADHAAR_BACK", type: "file", src: [] },
      { key: "PAN", type: "file", src: [] },
      { key: "PROFILE_PHOTO", type: "file", src: [] },
      { key: "aadharNumber", value: "123412341234", type: "text" },
      { key: "panNumber", value: "ABCDE1234F", type: "text" },
      {
        key: "bankAccountNumber",
        value: "1234567890",
        type: "text",
        disabled: true,
      },
      {
        key: "ifscCode",
        value: "ABCD0123456",
        type: "text",
        disabled: true,
      },
      {
        key: "confirmIfscCode",
        value: "ABCD0123456",
        type: "text",
        disabled: true,
      },
      { key: "PASSBOOK_IMAGE", type: "file", src: [], disabled: true },
    ],
    csrf: "driverCsrfToken",
  },
  {
    folder: "33 - Driver Documents",
    name: "Reupload Document",
    method: "POST",
    path: "/api/v1/driver/documents/{{driverDocumentId}}/reupload",
    body: { contentType: "application/pdf", sizeBytes: 500000 },
    csrf: "driverCsrfToken",
  },

  // 34 Driver Vehicle Categories
  {
    folder: "34 - Driver Vehicle Categories",
    name: "List Categories",
    method: "GET",
    path: "/api/v1/driver/vehicle-categories",
  },
  {
    folder: "34 - Driver Vehicle Categories",
    name: "Get Category Details",
    method: "GET",
    path: "/api/v1/driver/vehicle-categories/{{categoryId}}",
  },

  // 35 Driver Vehicles
  {
    folder: "35 - Driver Vehicles",
    name: "List Vehicles",
    method: "GET",
    path: "/api/v1/driver/vehicles",
  },
  {
    folder: "35 - Driver Vehicles",
    name: "Get Assigned Vehicle",
    method: "GET",
    path: "/api/v1/driver/vehicles/assigned",
  },
  {
    folder: "35 - Driver Vehicles",
    name: "Create Vehicle",
    method: "POST",
    path: "/api/v1/driver/vehicles",
    body: {
      categoryId: "{{categoryId}}",
      make: "Honda",
      model: "City",
      registrationNo: "UP14TEST1234",
      year: 2021,
      color: "White",
      fuelType: "PETROL",
      seatingCapacity: 4,
    },
    csrf: "driverCsrfToken",
  },
  {
    folder: "35 - Driver Vehicles",
    name: "Get Vehicle Details",
    method: "GET",
    path: "/api/v1/driver/vehicles/{{vehicleId}}",
  },
  {
    folder: "35 - Driver Vehicles",
    name: "Update Vehicle",
    method: "PATCH",
    path: "/api/v1/driver/vehicles/{{vehicleId}}",
    body: { color: "Black" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "35 - Driver Vehicles",
    name: "Delete Vehicle",
    method: "DELETE",
    path: "/api/v1/driver/vehicles/{{vehicleId}}",
    csrf: "driverCsrfToken",
  },

  // 36 Driver Vehicle Documents
  {
    folder: "36 - Driver Vehicle Documents",
    name: "Get Vehicle Document Upload URL",
    method: "POST",
    path: "/api/v1/driver/vehicles/{{vehicleId}}/documents/upload-url",
    body: {
      type: "REGISTRATION_CERTIFICATE",
      contentType: "application/pdf",
      sizeBytes: 500000,
    },
    csrf: "driverCsrfToken",
  },
  {
    folder: "36 - Driver Vehicle Documents",
    name: "List Vehicle Documents",
    method: "GET",
    path: "/api/v1/driver/vehicles/{{vehicleId}}/documents",
  },
  {
    folder: "36 - Driver Vehicle Documents",
    name: "Submit Vehicle for Verification",
    method: "POST",
    path: "/api/v1/driver/vehicles/{{vehicleId}}/submit",
    csrf: "driverCsrfToken",
  },
  {
    folder: "36 - Driver Vehicle Documents",
    name: "Get Vehicle Verification Status",
    method: "GET",
    path: "/api/v1/driver/vehicles/{{vehicleId}}/verification-status",
  },
  {
    folder: "36 - Driver Vehicle Documents",
    name: "Select Active Vehicle",
    method: "POST",
    path: "/api/v1/driver/vehicles/{{vehicleId}}/select",
    csrf: "driverCsrfToken",
  },

  // 37 Driver Availability
  {
    folder: "37 - Driver Availability",
    name: "Get Availability",
    method: "GET",
    path: "/api/v1/driver/availability",
  },
  {
    folder: "37 - Driver Availability",
    name: "Get Availability Status",
    method: "GET",
    path: "/api/v1/driver/availability/status",
  },
  {
    folder: "37 - Driver Availability",
    name: "Set Availability Status",
    method: "PATCH",
    path: "/api/v1/driver/availability",
    body: { availability: "ONLINE" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "37 - Driver Availability",
    name: "Go Online",
    method: "POST",
    path: "/api/v1/driver/availability/online",
    csrf: "driverCsrfToken",
  },
  {
    folder: "37 - Driver Availability",
    name: "Go Offline",
    method: "POST",
    path: "/api/v1/driver/availability/offline",
    csrf: "driverCsrfToken",
  },
  {
    folder: "37 - Driver Availability",
    name: "Pause Availability",
    method: "POST",
    path: "/api/v1/driver/availability/pause",
    csrf: "driverCsrfToken",
  },
  {
    folder: "37 - Driver Availability",
    name: "Resume Availability",
    method: "POST",
    path: "/api/v1/driver/availability/resume",
    csrf: "driverCsrfToken",
  },

  // 38 Driver Location
  {
    folder: "38 - Driver Location",
    name: "Get Current Location",
    method: "GET",
    path: "/api/v1/driver/location/current",
  },
  {
    folder: "38 - Driver Location",
    name: "Get Location Status",
    method: "GET",
    path: "/api/v1/driver/location/status",
  },
  {
    folder: "38 - Driver Location",
    name: "Update Location",
    method: "POST",
    path: "/api/v1/driver/location",
    body: {
      latitude: 19.0,
      longitude: 72.0,
      heading: 180,
      speed: 40,
      accuracy: 5,
      timestamp: "{{$isoTimestamp}}",
    },
    csrf: "driverCsrfToken",
  },

  // 38A Driver Dashboard & Performance
  {
    folder: "38A - Driver Dashboard",
    name: "Get Dashboard",
    method: "GET",
    path: "/api/v1/driver/dashboard",
  },
  {
    folder: "38A - Driver Dashboard",
    name: "Get Statistics",
    method: "GET",
    path: "/api/v1/driver/statistics?startDate=2026-01-01&endDate=2026-12-31",
  },
  {
    folder: "38A - Driver Dashboard",
    name: "Get Performance",
    method: "GET",
    path: "/api/v1/driver/performance",
  },

  // 39 Driver Ride Offers
  {
    folder: "39 - Driver Ride Offers",
    name: "Get Offered Booking",
    method: "GET",
    path: "/api/v1/driver/bookings/active",
  },
  {
    folder: "39 - Driver Ride Offers",
    name: "Accept Ride Offer",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/accept",
    body: { requestId: "{{dispatchOfferId}}" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "39 - Driver Ride Offers",
    name: "Reject Ride Offer",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/reject",
    body: { requestId: "{{dispatchOfferId}}", reasonCode: "TOO_FAR" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "39 - Driver Ride Offers",
    name: "Legacy Accept Offer",
    method: "POST",
    path: "/api/v1/dispatch/accept",
    body: { assignmentId: "{{dispatchOfferId}}" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "39 - Driver Ride Offers",
    name: "Legacy Reject Offer",
    method: "POST",
    path: "/api/v1/dispatch/reject",
    body: { assignmentId: "{{dispatchOfferId}}" },
    csrf: "driverCsrfToken",
  },

  // 40 Driver Active Booking
  {
    folder: "40 - Driver Active Booking",
    name: "List Driver Bookings",
    method: "GET",
    path: "/api/v1/driver/bookings?limit=20&offset=0",
  },
  {
    folder: "40 - Driver Active Booking",
    name: "Get Booking Details",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}",
  },
  {
    folder: "40 - Driver Active Booking",
    name: "Get Pickup Route",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}/pickup-route",
  },
  {
    folder: "40 - Driver Active Booking",
    name: "Get Pickup ETA",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}/pickup-eta",
  },
  {
    folder: "40 - Driver Active Booking",
    name: "Cancel Assigned Ride",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/cancel",
    body: { reason: "Vehicle mechanical failure" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "40 - Driver Active Booking",
    name: "Report Customer No-show",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/customer-no-show",
    body: { note: "Waited at pickup and attempted contact." },
    csrf: "driverCsrfToken",
  },

  // 41 Driver Pickup & Arrival
  {
    folder: "41 - Driver Pickup & Arrival",
    name: "Navigate to Pickup",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/navigate",
    csrf: "driverCsrfToken",
  },
  {
    folder: "41 - Driver Pickup & Arrival",
    name: "Arrived",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/arrived",
    csrf: "driverCsrfToken",
  },
  {
    folder: "41 - Driver Pickup & Arrival",
    name: "Arrive (Canonical)",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/arrive",
    csrf: "driverCsrfToken",
  },

  // 41A Driver Communication
  {
    folder: "41A - Driver Communication",
    name: "Get Booking Messages",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}/messages",
  },
  {
    folder: "41A - Driver Communication",
    name: "Send Booking Message",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/messages",
    body: { message: "I have reached the pickup point." },
    csrf: "driverCsrfToken",
  },
  {
    folder: "41A - Driver Communication",
    name: "Request Masked Customer Call",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/call-customer",
    csrf: "driverCsrfToken",
  },

  // 42 Driver Trip OTP
  {
    folder: "42 - Driver Trip OTP",
    name: "Request Start OTP",
    method: "POST",
    path: "/api/v1/driver/trips/{{tripId}}/request-start-otp",
    csrf: "driverCsrfToken",
  },
  {
    folder: "42 - Driver Trip OTP",
    name: "Verify Pickup OTP",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/pickup-otp/verify",
    body: { otp: "{{tripOtp}}" },
    csrf: "driverCsrfToken",
  },

  // 43 Driver Active Trip
  {
    folder: "43 - Driver Active Trip",
    name: "Start Trip",
    method: "POST",
    path: "/api/v1/driver/trips/{{tripId}}/start",
    body: { otp: "{{tripOtp}}" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "43 - Driver Active Trip",
    name: "Start Trip by Booking",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/start",
    csrf: "driverCsrfToken",
  },
  {
    folder: "43 - Driver Active Trip",
    name: "Get Trip Route",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}/route",
  },
  {
    folder: "43 - Driver Active Trip",
    name: "Get Trip Stops",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}/stops",
  },
  {
    folder: "43 - Driver Active Trip",
    name: "Get Live Trip Status",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}/live-status",
  },
  {
    folder: "43 - Driver Active Trip",
    name: "Arrive at Trip Stop",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/stops/{{tripStopId}}/arrive",
    csrf: "driverCsrfToken",
  },
  {
    folder: "43 - Driver Active Trip",
    name: "Complete Trip Stop",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/stops/{{tripStopId}}/complete",
    csrf: "driverCsrfToken",
  },
  {
    folder: "43 - Driver Active Trip",
    name: "Complete Trip",
    method: "POST",
    path: "/api/v1/driver/trips/{{tripId}}/complete",
    csrf: "driverCsrfToken",
  },
  {
    folder: "43 - Driver Active Trip",
    name: "Complete Trip by Booking",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/complete",
    csrf: "driverCsrfToken",
  },

  // 44 Driver Trip History
  {
    folder: "44 - Driver Trip History",
    name: "List Trip History",
    method: "GET",
    path: "/api/v1/driver/trip-history?limit=10",
  },
  {
    folder: "44 - Driver Trip History",
    name: "Get Trip Details",
    method: "GET",
    path: "/api/v1/driver/trip-history/{{tripId}}",
  },

  // 45 Driver Earnings
  {
    folder: "45 - Driver Earnings",
    name: "List Earnings",
    method: "GET",
    path: "/api/v1/driver/earnings?limit=20&offset=0",
  },
  {
    folder: "45 - Driver Earnings",
    name: "Get Earnings Summary",
    method: "GET",
    path: "/api/v1/driver/earnings/summary",
  },
  {
    folder: "45 - Driver Earnings",
    name: "Get Daily Earnings",
    method: "GET",
    path: "/api/v1/driver/earnings/daily",
  },
  {
    folder: "45 - Driver Earnings",
    name: "Get Weekly Earnings",
    method: "GET",
    path: "/api/v1/driver/earnings/weekly",
  },
  {
    folder: "45 - Driver Earnings",
    name: "Get Monthly Earnings",
    method: "GET",
    path: "/api/v1/driver/earnings/monthly",
  },
  {
    folder: "45 - Driver Earnings",
    name: "Get Booking Earning",
    method: "GET",
    path: "/api/v1/driver/earnings/trips/{{bookingId}}",
  },
  {
    folder: "45 - Driver Earnings",
    name: "Get Trip Earning Details",
    method: "GET",
    path: "/api/v1/driver/earnings/{{tripId}}",
  },

  // Driver subscription checkout (cookie session, manual renewal).
  {
    folder: "45 - Driver Subscriptions",
    name: "List Subscription Plans",
    method: "GET",
    path: "/api/v1/driver/subscriptions/plans",
  },
  {
    folder: "45 - Driver Subscriptions",
    name: "Subscription Plan Details",
    method: "GET",
    path: "/api/v1/driver/subscriptions/plans/{{subscriptionPlanId}}",
  },
  {
    folder: "45 - Driver Subscriptions",
    name: "Active Subscription",
    method: "GET",
    path: "/api/v1/driver/subscriptions/active",
  },
  {
    folder: "45 - Driver Subscriptions",
    name: "Purchase Subscription",
    method: "POST",
    path: "/api/v1/driver/subscriptions/purchase",
    body: { planId: "{{subscriptionPlanId}}" },
    headers: [
      { key: "x-idempotency-key", value: "{{subscriptionIdempotencyKey}}" },
    ],
  },
  {
    folder: "45 - Driver Subscriptions",
    name: "Subscription History",
    method: "GET",
    path: "/api/v1/driver/subscriptions/history?page=1&limit=20",
  },
  {
    folder: "45 - Driver Subscriptions",
    name: "Subscription Details",
    method: "GET",
    path: "/api/v1/driver/subscriptions/{{subscriptionId}}",
  },
  {
    folder: "45 - Driver Subscriptions",
    name: "Subscription Payment Status",
    method: "GET",
    path: "/api/v1/driver/subscriptions/{{subscriptionId}}/payment?reconcile=true",
  },
  {
    folder: "45 - Driver Subscriptions",
    name: "Verify Subscription Payment",
    method: "POST",
    path: "/api/v1/payments/verify",
    body: {
      paymentId: "{{subscriptionPaymentId}}",
      providerPaymentId: "{{subscriptionProviderPaymentId}}",
      signature: "{{subscriptionSignature}}",
    },
  },

  // 46 Driver Wallet & Settlements
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "Get Wallet Balance",
    method: "GET",
    path: "/api/v1/driver/wallet",
  },
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "Get Wallet Transactions",
    method: "GET",
    path: "/api/v1/driver/wallet/transactions?limit=20",
  },
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "Create Wallet Top-up Order",
    method: "POST",
    path: "/api/v1/driver/wallet/add-money",
    body: { amount: 500 },
    csrf: "driverCsrfToken",
    idempotency: true,
  },
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "Withdraw Wallet Balance",
    method: "POST",
    path: "/api/v1/driver/wallet/withdraw",
    body: { amount: 500, payoutAccountId: "{{driverBankAccountId}}" },
    csrf: "driverCsrfToken",
    idempotency: true,
  },
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "List Withdrawals",
    method: "GET",
    path: "/api/v1/driver/wallet/withdrawals",
  },
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "Get Withdrawal",
    method: "GET",
    path: "/api/v1/driver/wallet/withdrawals/{{driverPayoutId}}",
  },
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "Get Settlements History",
    method: "GET",
    path: "/api/v1/driver/settlements",
  },
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "Get Payout Accounts",
    method: "GET",
    path: "/api/v1/driver/payout-accounts",
  },
  {
    folder: "46 - Driver Wallet & Settlements",
    name: "Add Payout Account",
    method: "POST",
    path: "/api/v1/driver/payout-accounts",
    body: {
      accountName: "Driver Bob",
      accountNumber: "1234567890",
      bankCode: "IFSC0001234",
      bankName: "Test Bank",
    },
    csrf: "driverCsrfToken",
  },

  // 46A Driver Bank Accounts & Payouts
  {
    folder: "46A - Driver Bank Accounts",
    name: "List Bank Accounts",
    method: "GET",
    path: "/api/v1/driver/bank-accounts",
  },
  {
    folder: "46A - Driver Bank Accounts",
    name: "Add Bank Account",
    method: "POST",
    path: "/api/v1/driver/bank-accounts",
    body: {
      accountName: "Driver Bob",
      accountNumber: "1234567890",
      confirmAccountNumber: "1234567890",
      bankCode: "IFSC0001234",
      bankName: "Test Bank",
    },
    csrf: "driverCsrfToken",
  },
  {
    folder: "46A - Driver Bank Accounts",
    name: "Update Bank Account",
    method: "PATCH",
    path: "/api/v1/driver/bank-accounts/{{driverBankAccountId}}",
    body: { bankName: "Updated Bank" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "46A - Driver Bank Accounts",
    name: "Delete Bank Account",
    method: "DELETE",
    path: "/api/v1/driver/bank-accounts/{{driverBankAccountId}}",
    csrf: "driverCsrfToken",
  },
  {
    folder: "46A - Driver Bank Accounts",
    name: "Set Default Bank Account",
    method: "PATCH",
    path: "/api/v1/driver/bank-accounts/{{driverBankAccountId}}/default",
    csrf: "driverCsrfToken",
  },
  {
    folder: "46B - Driver Payouts",
    name: "Request Payout",
    method: "POST",
    path: "/api/v1/driver/payouts/request",
    body: { amount: 500, payoutAccountId: "{{driverBankAccountId}}" },
    csrf: "driverCsrfToken",
    idempotency: true,
  },
  {
    folder: "46B - Driver Payouts",
    name: "List Payouts",
    method: "GET",
    path: "/api/v1/driver/payouts",
  },
  {
    folder: "46B - Driver Payouts",
    name: "Get Payout",
    method: "GET",
    path: "/api/v1/driver/payouts/{{driverPayoutId}}",
  },

  // 46C Driver Payment
  {
    folder: "46C - Driver Payment",
    name: "Confirm Cash Payment",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/payment/cash-confirm",
    csrf: "driverCsrfToken",
    idempotency: true,
  },
  {
    folder: "46C - Driver Payment",
    name: "Get Booking Payment Status",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}/payment-status",
  },

  // 47 Driver Incentives
  {
    folder: "47 - Driver Incentives",
    name: "Get Incentives",
    method: "GET",
    path: "/api/v1/driver/incentives",
  },
  {
    folder: "47 - Driver Incentives",
    name: "Get Active Incentives",
    method: "GET",
    path: "/api/v1/driver/incentives/active",
  },
  {
    folder: "47 - Driver Incentives",
    name: "Get Incentive Progress",
    method: "GET",
    path: "/api/v1/driver/incentives/progress",
  },
  {
    folder: "47 - Driver Incentives",
    name: "Get Incentives History",
    method: "GET",
    path: "/api/v1/driver/incentives/history",
  },

  // 48 Driver Ratings
  {
    folder: "48 - Driver Ratings",
    name: "List Driver Ratings",
    method: "GET",
    path: "/api/v1/driver/ratings?limit=20&offset=0",
  },
  {
    folder: "48 - Driver Ratings",
    name: "Get Ratings Summary",
    method: "GET",
    path: "/api/v1/driver/ratings/summary",
  },
  {
    folder: "48 - Driver Ratings",
    name: "Rate Customer",
    method: "POST",
    path: "/api/v1/driver/trips/{{tripId}}/rate-customer",
    body: { rating: 5, comment: "Polite customer." },
    csrf: "driverCsrfToken",
  },
  {
    folder: "48 - Driver Ratings",
    name: "Rate Booking Customer",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/customer-rating",
    body: { rating: 5, comment: "Polite customer." },
    csrf: "driverCsrfToken",
  },
  {
    folder: "48 - Driver Ratings",
    name: "Get Booking Customer Rating",
    method: "GET",
    path: "/api/v1/driver/bookings/{{bookingId}}/customer-rating",
  },

  // 49 Driver Notifications
  {
    folder: "49 - Driver Notifications",
    name: "List Notifications",
    method: "GET",
    path: "/api/v1/driver/notifications",
  },
  {
    folder: "49 - Driver Notifications",
    name: "Get Unread Count",
    method: "GET",
    path: "/api/v1/driver/notifications/unread-count",
  },
  {
    folder: "49 - Driver Notifications",
    name: "Mark Notification Read",
    method: "PATCH",
    path: "/api/v1/driver/notifications/{{notificationId}}/read",
    csrf: "driverCsrfToken",
  },
  {
    folder: "49 - Driver Notifications",
    name: "Mark All Read",
    method: "PATCH",
    path: "/api/v1/driver/notifications/read-all",
    csrf: "driverCsrfToken",
  },
  {
    folder: "49 - Driver Notifications",
    name: "Delete Notification",
    method: "DELETE",
    path: "/api/v1/driver/notifications/{{notificationId}}",
    csrf: "driverCsrfToken",
  },
  {
    folder: "49 - Driver Notifications",
    name: "Register Device Token",
    method: "POST",
    path: "/api/v1/driver/device-tokens",
    body: { token: "driver_device_token_123", platform: "ANDROID" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "49 - Driver Notifications",
    name: "Delete Device Token",
    method: "DELETE",
    path: "/api/v1/driver/device-tokens/{{driverDeviceToken}}",
    csrf: "driverCsrfToken",
  },
  {
    folder: "49 - Driver Notifications",
    name: "Register Device",
    method: "POST",
    path: "/api/v1/driver/devices",
    body: { token: "driver_device_token_456", platform: "ANDROID" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "49 - Driver Notifications",
    name: "Delete Device",
    method: "DELETE",
    path: "/api/v1/driver/devices/{{driverDeviceId}}",
    csrf: "driverCsrfToken",
  },

  // 50 Driver Support
  {
    folder: "50 - Driver Support",
    name: "Get Support Categories",
    method: "GET",
    path: "/api/v1/driver/support/categories",
  },
  {
    folder: "50 - Driver Support",
    name: "Create Ticket",
    method: "POST",
    path: "/api/v1/driver/support/tickets",
    body: {
      subject: "App Crash",
      description: "The app crashed during navigation.",
    },
    csrf: "driverCsrfToken",
  },
  {
    folder: "50 - Driver Support",
    name: "Get Support Tickets",
    method: "GET",
    path: "/api/v1/driver/support/tickets",
  },
  {
    folder: "50 - Driver Support",
    name: "Get Support Ticket",
    method: "GET",
    path: "/api/v1/driver/support/tickets/{{ticketId}}",
  },
  {
    folder: "50 - Driver Support",
    name: "Send Support Message",
    method: "POST",
    path: "/api/v1/driver/support/tickets/{{ticketId}}/messages",
    body: { message: "Please share an update on this issue." },
    csrf: "driverCsrfToken",
  },
  {
    folder: "50 - Driver Support",
    name: "Report Booking",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/report",
    body: {
      category: "CUSTOMER_BEHAVIOUR",
      description: "Customer behaviour issue during the trip.",
    },
    csrf: "driverCsrfToken",
  },

  // 51 Driver Safety & SOS
  {
    folder: "51 - Driver Safety & SOS",
    name: "Raise SOS",
    method: "POST",
    path: "/api/v1/driver/safety/sos",
    body: {
      tripId: "{{tripId}}",
      latitude: 19.0,
      longitude: 72.0,
      message: "SOS Emergency!",
    },
    csrf: "driverCsrfToken",
  },
  {
    folder: "51 - Driver Safety & SOS",
    name: "Raise Booking SOS",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/sos",
    body: { latitude: 19.0, longitude: 72.0, message: "SOS Emergency!" },
    csrf: "driverCsrfToken",
  },
  {
    folder: "51 - Driver Safety & SOS",
    name: "Report Safety Issue",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/report-safety-issue",
    body: {
      type: "ROUTE_SAFETY",
      description: "Unsafe obstruction on the route.",
    },
    csrf: "driverCsrfToken",
  },
  {
    folder: "51 - Driver Safety & SOS",
    name: "Report Customer",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/report-customer",
    body: { description: "Customer misconduct during the trip." },
    csrf: "driverCsrfToken",
  },
  {
    folder: "51 - Driver Safety & SOS",
    name: "Report Accident",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/report-accident",
    body: { description: "Minor collision requiring safety review." },
    csrf: "driverCsrfToken",
  },
  {
    folder: "51 - Driver Safety & SOS",
    name: "Report Breakdown",
    method: "POST",
    path: "/api/v1/driver/bookings/{{bookingId}}/report-breakdown",
    body: { description: "Vehicle engine stopped during the trip." },
    csrf: "driverCsrfToken",
  },
  {
    folder: "51 - Driver Safety & SOS",
    name: "Get SOS Details",
    method: "GET",
    path: "/api/v1/driver/safety/sos/{{sosId}}",
  },
  {
    folder: "51 - Driver Safety & SOS",
    name: "Cancel SOS",
    method: "POST",
    path: "/api/v1/driver/safety/sos/{{sosId}}/cancel",
    csrf: "driverCsrfToken",
  },

  // 52 Driver Settings & Account
  {
    folder: "52 - Driver Settings & Account",
    name: "Get Restrictions",
    method: "GET",
    path: "/api/v1/driver/account/restrictions",
  },
  {
    folder: "52 - Driver Settings & Account",
    name: "Request Data Export",
    method: "POST",
    path: "/api/v1/driver/account/data-export",
    csrf: "driverCsrfToken",
  },
  {
    folder: "52 - Driver Settings & Account",
    name: "Request Account Deletion",
    method: "POST",
    path: "/api/v1/driver/account/deletion-request",
    csrf: "driverCsrfToken",
  },

  // 60 Admin Authentication
  {
    folder: "60 - Admin Authentication",
    name: "Login",
    method: "POST",
    path: "/api/v1/admin/auth/login",
    body: { email: "{{adminEmail}}", password: "{{adminPassword}}" },
  },
  {
    folder: "60 - Admin Authentication",
    name: "Get Session Me",
    method: "GET",
    path: "/api/v1/admin/auth/me",
  },
  {
    folder: "60 - Admin Authentication",
    name: "List Sessions",
    method: "GET",
    path: "/api/v1/admin/auth/sessions",
  },
  {
    folder: "60 - Admin Authentication",
    name: "Revoke Session",
    method: "DELETE",
    path: "/api/v1/admin/auth/sessions/{{sessionId}}",
    csrf: "adminCsrfToken",
  },
  {
    folder: "60 - Admin Authentication",
    name: "Logout",
    method: "POST",
    path: "/api/v1/admin/auth/logout",
    csrf: "adminCsrfToken",
  },
  {
    folder: "60 - Admin Authentication",
    name: "Logout All Sessions",
    method: "POST",
    path: "/api/v1/admin/auth/logout-all",
    csrf: "adminCsrfToken",
  },

  // 61 Admin Dashboard
  {
    folder: "61 - Admin Dashboard",
    name: "Get Combined Dashboard",
    method: "GET",
    path: "/api/v1/admin/dashboard",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Summary Metrics",
    method: "GET",
    path: "/api/v1/admin/dashboard/summary",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Booking Overview",
    method: "GET",
    path: "/api/v1/admin/dashboard/booking-overview",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Booking Status",
    method: "GET",
    path: "/api/v1/admin/dashboard/booking-status",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Top Vehicles",
    method: "GET",
    path: "/api/v1/admin/dashboard/top-vehicles",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Revenue Overview",
    method: "GET",
    path: "/api/v1/admin/dashboard/revenue-overview",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Driver Performance",
    method: "GET",
    path: "/api/v1/admin/dashboard/driver-performance",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Live Operations",
    method: "GET",
    path: "/api/v1/admin/dashboard/live-operations",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Recent Bookings",
    method: "GET",
    path: "/api/v1/admin/dashboard/recent-bookings",
  },
  {
    folder: "61 - Admin Dashboard",
    name: "Get Alerts",
    method: "GET",
    path: "/api/v1/admin/dashboard/alerts",
  },

  // 62 Admin Accounts
  {
    folder: "62 - Admin Accounts",
    name: "List Admins",
    method: "GET",
    path: "/api/v1/admin/admins",
  },
  {
    folder: "62 - Admin Accounts",
    name: "Create Admin",
    method: "POST",
    path: "/api/v1/admin/admins",
    body: {
      email: "newadmin@example.com",
      password: "AdminPassword123!",
      name: "New Admin",
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "62 - Admin Accounts",
    name: "Get Admin Details",
    method: "GET",
    path: "/api/v1/admin/admins/{{adminId}}",
  },
  {
    folder: "62 - Admin Accounts",
    name: "Update Admin Details",
    method: "PATCH",
    path: "/api/v1/admin/admins/{{adminId}}",
    body: { name: "New Admin Updated" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "62 - Admin Accounts",
    name: "Update Admin Password",
    method: "PATCH",
    path: "/api/v1/admin/admins/{{adminId}}/password",
    body: { password: "NewAdminPassword123!" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "62 - Admin Accounts",
    name: "Update Admin Status",
    method: "PATCH",
    path: "/api/v1/admin/admins/{{adminId}}/status",
    body: { isActive: false },
    csrf: "adminCsrfToken",
  },
  {
    folder: "62 - Admin Accounts",
    name: "List Admin Sessions",
    method: "GET",
    path: "/api/v1/admin/admins/{{adminId}}/sessions",
  },
  {
    folder: "62 - Admin Accounts",
    name: "Revoke Admin Session",
    method: "DELETE",
    path: "/api/v1/admin/admins/{{adminId}}/sessions/{{sessionId}}",
    csrf: "adminCsrfToken",
  },
  {
    folder: "62 - Admin Accounts",
    name: "Logout All Admin Sessions",
    method: "POST",
    path: "/api/v1/admin/admins/{{adminId}}/logout-all",
    csrf: "adminCsrfToken",
  },

  // 63 Admin Roles & Permissions
  {
    folder: "63 - Admin Roles & Permissions",
    name: "Get Permission Matrix",
    method: "GET",
    path: "/api/v1/admin/permissions",
  },
  {
    folder: "63 - Admin Roles & Permissions",
    name: "List Roles",
    method: "GET",
    path: "/api/v1/admin/roles",
  },
  {
    folder: "63 - Admin Roles & Permissions",
    name: "Assign Role to Admin",
    method: "POST",
    path: "/api/v1/admin/admins/{{adminId}}/roles",
    body: { roleId: "{{roleId}}" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "63 - Admin Roles & Permissions",
    name: "Remove Role from Admin",
    method: "DELETE",
    path: "/api/v1/admin/admins/{{adminId}}/roles/{{roleId}}",
    csrf: "adminCsrfToken",
  },

  // 64 Admin Customer Management
  {
    folder: "64 - Admin Customer Management",
    name: "List Customers",
    method: "GET",
    path: "/api/v1/admin/customers",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Get Customer Details",
    method: "GET",
    path: "/api/v1/admin/customers/{{customerId}}",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Update Customer Details",
    method: "PATCH",
    path: "/api/v1/admin/customers/{{customerId}}",
    body: { displayName: "John Doe" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Update Customer Status",
    method: "PATCH",
    path: "/api/v1/admin/customers/{{customerId}}/status",
    body: { status: "SUSPENDED", reason: "Violation" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "List Customer Sessions",
    method: "GET",
    path: "/api/v1/admin/customers/{{customerId}}/sessions",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Revoke Customer Session",
    method: "DELETE",
    path: "/api/v1/admin/customers/{{customerId}}/sessions/{{sessionId}}",
    csrf: "adminCsrfToken",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Logout All Customer Sessions",
    method: "POST",
    path: "/api/v1/admin/customers/{{customerId}}/logout-all",
    csrf: "adminCsrfToken",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Get Customer Bookings",
    method: "GET",
    path: "/api/v1/admin/customers/{{customerId}}/bookings",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Get Customer Trips",
    method: "GET",
    path: "/api/v1/admin/customers/{{customerId}}/trips",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Get Customer Payments",
    method: "GET",
    path: "/api/v1/admin/customers/{{customerId}}/payments",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Get Customer Support Tickets",
    method: "GET",
    path: "/api/v1/admin/customers/{{customerId}}/support-tickets",
  },

  // 65 Admin Driver Management
  {
    folder: "65 - Admin Driver Management",
    name: "List Drivers",
    method: "GET",
    path: "/api/v1/admin/drivers",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Get Driver Details",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Update Driver Details",
    method: "PATCH",
    path: "/api/v1/admin/drivers/{{driverId}}",
    body: { fullName: "Driver Bob" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Update Driver Status",
    method: "PATCH",
    path: "/api/v1/admin/drivers/{{driverId}}/status",
    body: { status: "SUSPENDED" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Verify Driver Profile",
    method: "PATCH",
    path: "/api/v1/admin/drivers/{{driverId}}/verification",
    body: { verificationStatus: "VERIFIED" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Force Driver Offline",
    method: "POST",
    path: "/api/v1/admin/drivers/{{driverId}}/force-offline",
    csrf: "adminCsrfToken",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Get Driver Availability",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/availability",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Get Driver Live Location",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/live-location",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Get Driver Current Trip",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/current-trip",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "List Driver Sessions",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/sessions",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Logout All Driver Sessions",
    method: "POST",
    path: "/api/v1/admin/drivers/{{driverId}}/logout-all",
    csrf: "adminCsrfToken",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Assign Vehicle",
    method: "POST",
    path: "/api/v1/admin/drivers/{{driverId}}/assign-vehicle",
    body: { vehicleId: "{{vehicleId}}" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Unassign Vehicle",
    method: "POST",
    path: "/api/v1/admin/drivers/{{driverId}}/unassign-vehicle",
    csrf: "adminCsrfToken",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Get Driver Trips",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/trips",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Get Driver Earnings",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/earnings",
  },

  // 66 Admin Driver KYC & Documents
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "List Driver KYC Submissions",
    method: "GET",
    path: "/api/v1/admin/drivers/kyc?status=PENDING&page=1&limit=20",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Get Latest Driver KYC",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/kyc",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Get KYC Submission",
    method: "GET",
    path: "/api/v1/admin/drivers/kyc/{{kycId}}",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Start KYC Review",
    method: "PATCH",
    path: "/api/v1/admin/drivers/kyc/{{kycId}}/review",
    csrf: "adminCsrfToken",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Approve KYC by Submission",
    method: "PATCH",
    path: "/api/v1/admin/drivers/kyc/{{kycId}}/approve",
    body: { reason: "All mandatory documents verified" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Reject KYC by Submission",
    method: "PATCH",
    path: "/api/v1/admin/drivers/kyc/{{kycId}}/reject",
    body: {
      reason: "Driving licence image is unclear",
      documents: [
        { documentType: "DRIVING_LICENSE", reason: "Image is blurred" },
      ],
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Suspend Approved KYC",
    method: "PATCH",
    path: "/api/v1/admin/drivers/kyc/{{kycId}}/suspend",
    body: { reason: "Compliance investigation opened" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Get KYC Audit Logs",
    method: "GET",
    path: "/api/v1/admin/drivers/kyc/{{kycId}}/logs",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Review KYC Submission",
    method: "POST",
    path: "/api/v1/admin/drivers/{{driverId}}/kyc/review",
    body: { notes: "Documents check" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Approve KYC Submission",
    method: "POST",
    path: "/api/v1/admin/drivers/{{driverId}}/kyc/approve",
    csrf: "adminCsrfToken",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Reject KYC Submission",
    method: "POST",
    path: "/api/v1/admin/drivers/{{driverId}}/kyc/reject",
    body: { rejectionReason: "Invalid license image" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Get Driver Documents",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/documents",
  },
  {
    folder: "66 - Admin Driver KYC & Documents",
    name: "Verify Driver Document",
    method: "PATCH",
    path: "/api/v1/admin/driver-documents/{{driverDocumentId}}/verification",
    body: { status: "VERIFIED" },
    csrf: "adminCsrfToken",
  },

  // 67 Admin Vehicle Categories
  {
    folder: "67 - Admin Vehicle Categories",
    name: "Create Category",
    method: "POST",
    path: "/api/v1/admin/vehicle-categories",
    body: {
      name: "Test Category",
      slug: "test-category",
      minPassengers: 1,
      maxPassengers: 4,
      allowedFuelTypes: ["PETROL", "CNG"],
      displayOrder: 10,
      isActive: true,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "67 - Admin Vehicle Categories",
    name: "List Categories",
    method: "GET",
    path: "/api/v1/admin/vehicle-categories",
  },
  {
    folder: "67 - Admin Vehicle Categories",
    name: "Get Category",
    method: "GET",
    path: "/api/v1/admin/vehicle-categories/{{categoryId}}",
  },
  {
    folder: "67 - Admin Vehicle Categories",
    name: "Update Category",
    method: "PATCH",
    path: "/api/v1/admin/vehicle-categories/{{categoryId}}",
    body: { name: "Test Category Updated" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "67 - Admin Vehicle Categories",
    name: "Update Category Status",
    method: "PATCH",
    path: "/api/v1/admin/vehicle-categories/{{categoryId}}/status",
    body: { isActive: true },
    csrf: "adminCsrfToken",
  },
  {
    folder: "67 - Admin Vehicle Categories",
    name: "Delete Category",
    method: "DELETE",
    path: "/api/v1/admin/vehicle-categories/{{categoryId}}",
    csrf: "adminCsrfToken",
  },

  // 68 Admin Vehicle Management
  {
    folder: "68 - Admin Vehicle Management",
    name: "List Vehicles",
    method: "GET",
    path: "/api/v1/admin/vehicles",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Create Vehicle",
    method: "POST",
    path: "/api/v1/admin/vehicles",
    body: {
      categoryId: "{{categoryId}}",
      registrationNo: "UP16XX8888",
      make: "Hyundai",
      model: "Verna",
      color: "Black",
      year: 2022,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Get Vehicle Details",
    method: "GET",
    path: "/api/v1/admin/vehicles/{{vehicleId}}",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Update Vehicle Details",
    method: "PATCH",
    path: "/api/v1/admin/vehicles/{{vehicleId}}",
    body: { color: "Dark Blue" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Update Vehicle Status",
    method: "PATCH",
    path: "/api/v1/admin/vehicles/{{vehicleId}}/status",
    body: { status: "ACTIVE" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Verify Vehicle Profile",
    method: "PATCH",
    path: "/api/v1/admin/vehicles/{{vehicleId}}/verification",
    body: { status: "APPROVED", reason: "Verification checked" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Assign Driver",
    method: "POST",
    path: "/api/v1/admin/vehicles/{{vehicleId}}/assign-driver",
    body: { driverId: "{{driverId}}" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Unassign Driver",
    method: "POST",
    path: "/api/v1/admin/vehicles/{{vehicleId}}/unassign-driver",
    csrf: "adminCsrfToken",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Get Vehicle Documents",
    method: "GET",
    path: "/api/v1/admin/vehicles/{{vehicleId}}/documents",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Verify Vehicle Document",
    method: "PATCH",
    path: "/api/v1/admin/vehicle-documents/{{vehicleDocumentId}}/verification",
    body: { status: "VERIFIED" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "68 - Admin Vehicle Management",
    name: "Get Vehicle Trips History",
    method: "GET",
    path: "/api/v1/admin/vehicles/{{vehicleId}}/trips",
  },

  // 69 Admin Compliance
  {
    folder: "69 - Admin Compliance",
    name: "Get Vehicle Compliance Report",
    method: "GET",
    path: "/api/v1/admin/vehicles/{{vehicleId}}/compliance",
  },

  // 70 Admin Booking Management
  {
    folder: "70 - Admin Booking Management",
    name: "List Bookings",
    method: "GET",
    path: "/api/v1/admin/bookings",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Get Booking Details",
    method: "GET",
    path: "/api/v1/admin/bookings/{{bookingId}}",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Get Booking Timeline",
    method: "GET",
    path: "/api/v1/admin/bookings/{{bookingId}}/timeline",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Get Matching Logs",
    method: "GET",
    path: "/api/v1/admin/bookings/{{bookingId}}/matching-logs",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Manually Assign Driver",
    method: "POST",
    path: "/api/v1/admin/bookings/{{bookingId}}/assign-driver",
    body: { driverId: "{{driverId}}" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Reassign Driver",
    method: "POST",
    path: "/api/v1/admin/bookings/{{bookingId}}/reassign-driver",
    body: { driverId: "{{driverId}}" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Cancel Booking",
    method: "POST",
    path: "/api/v1/admin/bookings/{{bookingId}}/cancel",
    body: { reason: "Admin cancel" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Update Booking Status",
    method: "PATCH",
    path: "/api/v1/admin/bookings/{{bookingId}}/status",
    body: { status: "CANCELLED" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Get Location History Logs",
    method: "GET",
    path: "/api/v1/admin/bookings/{{bookingId}}/location-history",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Get Booking Payment Details",
    method: "GET",
    path: "/api/v1/admin/bookings/{{bookingId}}/payment",
  },

  // 71 Admin Scheduled Rides
  {
    folder: "71 - Admin Scheduled Rides",
    name: "List Scheduled Bookings",
    method: "GET",
    path: "/api/v1/admin/scheduled-bookings",
  },
  {
    folder: "71 - Admin Scheduled Rides",
    name: "Get Scheduled Booking Details",
    method: "GET",
    path: "/api/v1/admin/scheduled-bookings/{{scheduledBookingId}}",
  },
  {
    folder: "71 - Admin Scheduled Rides",
    name: "Update Scheduled Booking Status",
    method: "PATCH",
    path: "/api/v1/admin/scheduled-bookings/{{scheduledBookingId}}/status",
    body: { status: "CANCELLED" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "71 - Admin Scheduled Rides",
    name: "Assign Driver to Scheduled Ride",
    method: "POST",
    path: "/api/v1/admin/scheduled-bookings/{{scheduledBookingId}}/assign-driver",
    body: { driverId: "{{driverId}}" },
    csrf: "adminCsrfToken",
  },

  // 72 Admin Trip Management
  {
    folder: "72 - Admin Trip Management",
    name: "List Trips",
    method: "GET",
    path: "/api/v1/admin/trips",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Monitor Active Trips",
    method: "GET",
    path: "/api/v1/admin/trips/active",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Get Trip Details",
    method: "GET",
    path: "/api/v1/admin/trips/{{tripId}}",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Get Trip Timeline",
    method: "GET",
    path: "/api/v1/admin/trips/{{tripId}}/timeline",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Get Live Location",
    method: "GET",
    path: "/api/v1/admin/trips/{{tripId}}/live-location",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Get Trip Location History",
    method: "GET",
    path: "/api/v1/admin/trips/{{tripId}}/location-history",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Update Trip Status",
    method: "PATCH",
    path: "/api/v1/admin/trips/{{tripId}}/status",
    body: { status: "COMPLETED" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Cancel Active Trip",
    method: "POST",
    path: "/api/v1/admin/trips/{{tripId}}/cancel",
    csrf: "adminCsrfToken",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Force Complete Trip",
    method: "POST",
    path: "/api/v1/admin/trips/{{tripId}}/force-complete",
    csrf: "adminCsrfToken",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Add Internal Trip Note",
    method: "POST",
    path: "/api/v1/admin/trips/{{tripId}}/add-note",
    body: { note: "Important note" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "72 - Admin Trip Management",
    name: "Report Trip Incident",
    method: "POST",
    path: "/api/v1/admin/trips/{{tripId}}/report-incident",
    body: { type: "ACCIDENT", description: "Crash details" },
    csrf: "adminCsrfToken",
  },

  // 73 Admin Fare Management
  {
    folder: "73 - Admin Fare Management",
    name: "List Fare Rules",
    method: "GET",
    path: "/api/v1/admin/fares",
  },
  {
    folder: "73 - Admin Fare Management",
    name: "Create Fare Rule",
    method: "POST",
    path: "/api/v1/admin/fares",
    body: {
      vehicleCategoryId: "{{categoryId}}",
      baseFare: 50.0,
      perKmCharge: 12.0,
      perMinuteCharge: 1.5,
      minimumFare: 100.0,
      serviceAreaId: "{{serviceAreaId}}",
      isActive: true,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "73 - Admin Fare Management",
    name: "Get Fare History",
    method: "GET",
    path: "/api/v1/admin/fares/history",
  },
  {
    folder: "73 - Admin Fare Management",
    name: "Calculate Fare Preview",
    method: "POST",
    path: "/api/v1/admin/fares/calculate-preview",
    body: {
      vehicleCategoryId: "{{categoryId}}",
      distanceMeters: 5000,
      durationSeconds: 600,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "73 - Admin Fare Management",
    name: "Get Fare Rule Details",
    method: "GET",
    path: "/api/v1/admin/fares/{{fareId}}",
  },
  {
    folder: "73 - Admin Fare Management",
    name: "Update Fare Rule",
    method: "PATCH",
    path: "/api/v1/admin/fares/{{fareId}}",
    body: { baseFare: 60.0 },
    csrf: "adminCsrfToken",
  },
  {
    folder: "73 - Admin Fare Management",
    name: "Update Fare Rule Status",
    method: "PATCH",
    path: "/api/v1/admin/fares/{{fareId}}/status",
    body: { isActive: true },
    csrf: "adminCsrfToken",
  },

  // 74 Admin Payment Management
  {
    folder: "74 - Admin Payment Management",
    name: "Adjust Wallet Balance",
    method: "POST",
    path: "/api/v1/wallets/admin/adjust",
    body: {
      userId: "{{customerId}}",
      amount: 100,
      type: "CREDIT",
      description: "Customer promotion bonus",
    },
    csrf: "adminCsrfToken",
  },

  // 78 Admin Notification Management
  {
    folder: "78 - Admin Notification Management",
    name: "List Sent Notifications",
    method: "GET",
    path: "/api/v1/admin/notifications",
  },
  {
    folder: "78 - Admin Notification Management",
    name: "Send Immediate Notification",
    method: "POST",
    path: "/api/v1/admin/notifications/send",
    body: {
      userId: "{{customerId}}",
      title: "Welcome",
      body: "Thank you for joining our platform!",
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "78 - Admin Notification Management",
    name: "Schedule Notification",
    method: "POST",
    path: "/api/v1/admin/notifications/schedule",
    body: {
      userId: "{{customerId}}",
      title: "Scheduled Alert",
      body: "This notification is scheduled.",
      scheduledAt: "{{scheduledAt}}",
    },
    csrf: "adminCsrfToken",
    preRequest:
      'const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000); pm.variables.set("scheduledAt", scheduledAt.toISOString());',
  },
  {
    folder: "78 - Admin Notification Management",
    name: "Get Notification Details",
    method: "GET",
    path: "/api/v1/admin/notifications/{{notificationId}}",
  },
  {
    folder: "78 - Admin Notification Management",
    name: "Retry Notification",
    method: "POST",
    path: "/api/v1/admin/notifications/{{notificationId}}/retry",
    csrf: "adminCsrfToken",
  },
  {
    folder: "78 - Admin Notification Management",
    name: "Cancel Scheduled Notification",
    method: "DELETE",
    path: "/api/v1/admin/notifications/{{notificationId}}/schedule",
    csrf: "adminCsrfToken",
  },
  {
    folder: "78 - Admin Notification Management",
    name: "List Notification Templates",
    method: "GET",
    path: "/api/v1/admin/notification-templates",
  },
  {
    folder: "78 - Admin Notification Management",
    name: "Create Notification Template",
    method: "POST",
    path: "/api/v1/admin/notification-templates",
    body: {
      name: "Welcome SMS",
      channel: "SMS",
      content: "Welcome to TukTuk!",
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "78 - Admin Notification Management",
    name: "Update Notification Template",
    method: "PATCH",
    path: "/api/v1/admin/notification-templates/{{templateId}}",
    body: { content: "Welcome updated content." },
    csrf: "adminCsrfToken",
  },

  // 79 Admin Support Management
  {
    folder: "79 - Admin Support Management",
    name: "List Support Categories",
    method: "GET",
    path: "/api/v1/admin/support/categories",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Create Support Category",
    method: "POST",
    path: "/api/v1/admin/support/categories",
    body: {
      name: "Billing Issues",
      description: "Category for billing disputes",
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Update Support Category",
    method: "PATCH",
    path: "/api/v1/admin/support/categories/{{supportCategoryId}}",
    body: { name: "Billing disputes" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "79 - Admin Support Management",
    name: "List Support Tickets",
    method: "GET",
    path: "/api/v1/admin/support/tickets",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Get Ticket Details",
    method: "GET",
    path: "/api/v1/admin/support/tickets/{{ticketId}}",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Reply to Support Ticket",
    method: "POST",
    path: "/api/v1/admin/support/tickets/{{ticketId}}/reply",
    body: { message: "We are resolving this issue now." },
    csrf: "adminCsrfToken",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Update Ticket Status",
    method: "PATCH",
    path: "/api/v1/admin/support/tickets/{{ticketId}}/status",
    body: { status: "RESOLVED" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Update Ticket Priority",
    method: "PATCH",
    path: "/api/v1/admin/support/tickets/{{ticketId}}/priority",
    body: { priority: "HIGH" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Assign Ticket",
    method: "POST",
    path: "/api/v1/admin/support/tickets/{{ticketId}}/assign",
    body: { adminId: "{{adminId}}" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Add Internal Admin Note",
    method: "POST",
    path: "/api/v1/admin/support/tickets/{{ticketId}}/internal-note",
    body: { message: "Internal note: check payment reference." },
    csrf: "adminCsrfToken",
  },

  // 80 Admin Safety & SOS
  {
    folder: "80 - Admin Safety & SOS",
    name: "Resolve SOS Request",
    method: "PATCH",
    path: "/api/v1/admin/sos/{{sosId}}",
    body: {
      status: "RESOLVED",
      remarks: "Police dispatched and passenger safe.",
    },
    csrf: "adminCsrfToken",
  },

  // 82 Admin Reports & Analytics
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Dashboard Report",
    method: "GET",
    path: "/api/v1/admin/reports/dashboard",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Bookings Report",
    method: "GET",
    path: "/api/v1/admin/reports/bookings",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Trips Report",
    method: "GET",
    path: "/api/v1/admin/reports/trips",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Revenue Report",
    method: "GET",
    path: "/api/v1/admin/reports/revenue",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Customers Report",
    method: "GET",
    path: "/api/v1/admin/reports/customers",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Drivers Report",
    method: "GET",
    path: "/api/v1/admin/reports/drivers",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Vehicles Report",
    method: "GET",
    path: "/api/v1/admin/reports/vehicles",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Cancellations Report",
    method: "GET",
    path: "/api/v1/admin/reports/cancellations",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Payments Report",
    method: "GET",
    path: "/api/v1/admin/reports/payments",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Support Tickets Report",
    method: "GET",
    path: "/api/v1/admin/reports/support",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Create Report Export Job",
    method: "POST",
    path: "/api/v1/admin/reports/export",
    body: { type: "REVENUE", format: "CSV" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "82 - Admin Reports & Analytics",
    name: "Get Export Status",
    method: "GET",
    path: "/api/v1/admin/reports/exports/{{reportExportId}}",
  },

  // 83 Admin Platform Configuration
  {
    folder: "83 - Admin Platform Configuration",
    name: "List Configurations",
    method: "GET",
    path: "/api/v1/admin/config",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Get Config Change History",
    method: "GET",
    path: "/api/v1/admin/config/history",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Enable Maintenance Mode",
    method: "POST",
    path: "/api/v1/admin/config/maintenance-mode",
    body: { enabled: false },
    csrf: "adminCsrfToken",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Get Config Value",
    method: "GET",
    path: "/api/v1/admin/config/{{platformConfigKey}}",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Update Config Value",
    method: "PATCH",
    path: "/api/v1/admin/config/{{platformConfigKey}}",
    body: { value: "1.25" },
    csrf: "adminCsrfToken",
  },

  // 84 Admin Audit Logs
  {
    folder: "84 - Admin Audit Logs",
    name: "List Admin Audit Logs",
    method: "GET",
    path: "/api/v1/admin/audit-logs",
  },
  {
    folder: "84 - Admin Audit Logs",
    name: "List Global Audit Logs",
    method: "GET",
    path: "/api/v1/audit-logs",
  },

  // 91 Payment Webhooks
  {
    folder: "91 - Payment Webhooks",
    name: "Razorpay Webhook Callback",
    method: "POST",
    path: "/api/v1/webhooks/razorpay",
    body: {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_123",
            amount: 10000,
            currency: "INR",
            status: "captured",
            order_id: "order_123",
          },
        },
      },
    },
    headers: [{ key: "x-razorpay-signature", value: "dummy_webhook_sig_123" }],
  },
];

const coverageRoutes: any[] = [
  // Missing Customer authentication, profile, fare, and booking APIs
  {
    folder: "02 - Customer Authentication",
    name: "Delete Customer Account",
    method: "DELETE",
    path: "/api/v1/customer/auth/account",
    csrf: "customerCsrfToken",
    noJsonContentType: true,
  },
  {
    folder: "03 - Customer Profile & Onboarding",
    name: "Create Profile Image Upload URL",
    method: "POST",
    path: "/api/v1/customer/profile/image",
    body: { contentType: "image/jpeg", sizeBytes: 102400 },
    csrf: "customerCsrfToken",
  },
  {
    folder: "07 - Customer Fare Estimate",
    name: "Estimate Fare (Customer API)",
    method: "POST",
    path: "/api/v1/customer/fares/estimate",
    body: {
      pickup: {
        latitude: 28.6139,
        longitude: 77.209,
        address: "Connaught Place, New Delhi",
      },
      drop: {
        latitude: 28.4595,
        longitude: 77.0266,
        address: "Cyber City, Gurugram",
      },
      categoryId: "{{categoryId}}",
      couponCode: "DISCOUNT50",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "08 - Customer Immediate Booking",
    name: "Create Immediate Booking (Customer API)",
    method: "POST",
    path: "/api/v1/customer/bookings",
    body: {
      pickup: {
        latitude: 28.6139,
        longitude: 77.209,
        address: "Connaught Place, New Delhi",
      },
      drop: {
        latitude: 28.4595,
        longitude: 77.0266,
        address: "Cyber City, Gurugram",
      },
      categoryId: "{{categoryId}}",
      fareEstimateId: "{{fareEstimateId}}",
      paymentMethod: "CASH",
      notes: "Please call on arrival",
      idempotencyKey: "{{$guid}}",
    },
    csrf: "customerCsrfToken",
    idempotency: true,
  },
  {
    folder: "09 - Customer Scheduled Booking",
    name: "Create Scheduled Booking (Customer API)",
    method: "POST",
    path: "/api/v1/customer/bookings/scheduled",
    body: {
      pickup: {
        latitude: 28.6139,
        longitude: 77.209,
        address: "Connaught Place, New Delhi",
      },
      drop: {
        latitude: 28.4595,
        longitude: 77.0266,
        address: "Cyber City, Gurugram",
      },
      categoryId: "{{categoryId}}",
      fareEstimateId: "{{fareEstimateId}}",
      paymentMethod: "CASH",
      scheduledAt: "{{scheduledAt}}",
      idempotencyKey: "{{$guid}}",
    },
    csrf: "customerCsrfToken",
    idempotency: true,
    preRequest:
      'const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000); pm.variables.set("scheduledAt", scheduledAt.toISOString());',
  },
  {
    folder: "09 - Customer Scheduled Booking",
    name: "Reschedule Booking (Customer API)",
    method: "PATCH",
    path: "/api/v1/customer/bookings/{{bookingId}}/reschedule",
    body: { scheduledAt: "{{scheduledAt}}" },
    csrf: "customerCsrfToken",
    preRequest:
      'const scheduledAt = new Date(Date.now() + 3 * 60 * 60 * 1000); pm.variables.set("scheduledAt", scheduledAt.toISOString());',
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Active Booking (Customer API)",
    method: "GET",
    path: "/api/v1/customer/bookings/active",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Timeline (Customer API)",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/timeline",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Driver (Customer API)",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/driver",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Fare (Customer API)",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/fare",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Payment (Customer API)",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/payment",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Live Driver Location (Customer API)",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/live-driver-location",
  },
  {
    folder: "12 - Customer Cancellation",
    name: "Cancel Booking (Customer API)",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/cancel",
    body: { reasonCode: "DRIVER_DELAYED", reason: "Driver took too long" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "13 - Customer Payments",
    name: "Create Payment Order (Customer API)",
    method: "POST",
    path: "/api/v1/customer/payments/create-order",
    body: { bookingId: "{{bookingId}}", purpose: "BOOKING" },
    csrf: "customerCsrfToken",
    idempotency: true,
  },
  {
    folder: "13 - Customer Payments",
    name: "Verify Payment (Customer API)",
    method: "POST",
    path: "/api/v1/customer/payments/verify",
    body: {
      paymentId: "{{paymentId}}",
      providerPaymentId: "pay_test_123456",
      signature: "test_signature_1234567890",
    },
    csrf: "customerCsrfToken",
  },

  // Missing Customer home, tracking, payment, rating, refund, and support APIs
  {
    folder: "10 - Customer Active Booking",
    name: "Get Home",
    method: "GET",
    path: "/api/v1/customer/home",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Nearby Vehicles",
    method: "GET",
    path: "/api/v1/customer/nearby-vehicles?latitude=28.6139&longitude=77.209",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "List Bookings (Customer API)",
    method: "GET",
    path: "/api/v1/customer/bookings?page=1&limit=20",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Details (Customer API)",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Status",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/status",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Vehicle",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/vehicle",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Driver Location",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/driver-location",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Pickup ETA",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/pickup-eta",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Retry Driver Search",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/retry-search",
    csrf: "customerCsrfToken",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Pickup OTP Status",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/pickup-otp",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Send Pickup OTP",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/pickup-otp/send",
    csrf: "customerCsrfToken",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Track Booking",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/tracking",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Get Booking Route",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/route",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Get Booking Live Status",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/live",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "Create Booking Share",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/share",
    body: {
      recipientName: "Emergency Contact",
      recipientPhone: "+919999999999",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "11 - Customer Trips & Tracking",
    name: "List Booking Shares",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/share",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "Create Booking SOS",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/sos",
    body: {
      latitude: 28.6139,
      longitude: 77.209,
      message: "Emergency assistance required",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "20 - Customer Safety & SOS",
    name: "Report Booking Safety Issue",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/safety-report",
    body: {
      type: "ROUTE_SAFETY",
      description: "Unsafe obstruction on the route",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "19 - Customer Support",
    name: "List Booking Messages",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/messages",
  },
  {
    folder: "19 - Customer Support",
    name: "Send Booking Message",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/messages",
    body: { message: "I am waiting at the pickup point" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Fare Breakdown",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/fare-breakdown",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Get Booking Invoice",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/invoice",
  },
  {
    folder: "10 - Customer Active Booking",
    name: "Download Booking Invoice",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/invoice/download",
  },
  {
    folder: "13 - Customer Payments",
    name: "Pay for Booking",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/pay",
    body: { bookingId: "{{bookingId}}", purpose: "BOOKING" },
    csrf: "customerCsrfToken",
    idempotency: true,
  },
  {
    folder: "13 - Customer Payments",
    name: "Get Booking Payment Status",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/payment-status",
  },
  {
    folder: "13 - Customer Payments",
    name: "Retry Booking Payment",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/retry-payment",
    csrf: "customerCsrfToken",
    idempotency: true,
  },
  {
    folder: "17 - Customer Ratings",
    name: "Get Booking Rating",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/rating",
  },
  {
    folder: "17 - Customer Ratings",
    name: "Rate Booking",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/rating",
    body: { score: 5, comment: "Excellent ride" },
    csrf: "customerCsrfToken",
  },
  {
    folder: "17 - Customer Ratings",
    name: "Add Driver Tip",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/tip",
    body: { amount: 50 },
    csrf: "customerCsrfToken",
  },
  {
    folder: "13 - Customer Payments",
    name: "Request Booking Refund",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/refund",
    body: { reason: "Payment charged incorrectly", amount: 100 },
    csrf: "customerCsrfToken",
  },
  {
    folder: "13 - Customer Payments",
    name: "Get Booking Refund Status",
    method: "GET",
    path: "/api/v1/customer/bookings/{{bookingId}}/refund",
  },
  {
    folder: "19 - Customer Support",
    name: "Report Booking Issue",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/report",
    body: {
      categoryId: "{{supportCategoryId}}",
      subject: "Booking issue",
      description: "Please review this booking",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "19 - Customer Support",
    name: "Report Lost Item",
    method: "POST",
    path: "/api/v1/customer/bookings/{{bookingId}}/lost-item",
    body: {
      categoryId: "{{supportCategoryId}}",
      description: "I left an item in the vehicle",
    },
    csrf: "customerCsrfToken",
  },
  {
    folder: "09 - Customer Scheduled Booking",
    name: "List Scheduled Rides",
    method: "GET",
    path: "/api/v1/customer/scheduled-rides",
  },
  {
    folder: "09 - Customer Scheduled Booking",
    name: "Get Scheduled Ride",
    method: "GET",
    path: "/api/v1/customer/scheduled-rides/{{scheduledBookingId}}",
  },
  {
    folder: "09 - Customer Scheduled Booking",
    name: "Update Scheduled Ride",
    method: "PATCH",
    path: "/api/v1/customer/scheduled-rides/{{scheduledBookingId}}",
    body: { scheduledAt: "{{scheduledAt}}" },
    csrf: "customerCsrfToken",
    preRequest:
      'const scheduledAt = new Date(Date.now() + 3 * 60 * 60 * 1000); pm.variables.set("scheduledAt", scheduledAt.toISOString());',
  },
  {
    folder: "09 - Customer Scheduled Booking",
    name: "Cancel Scheduled Ride",
    method: "DELETE",
    path: "/api/v1/customer/scheduled-rides/{{scheduledBookingId}}",
    csrf: "customerCsrfToken",
  },

  // Missing Admin authentication, profile, booking, support, and search APIs
  {
    folder: "60 - Admin Authentication",
    name: "Forgot Admin Password",
    method: "POST",
    path: "/api/v1/admin/auth/forgot-password",
    body: { email: "{{adminEmail}}" },
  },
  {
    folder: "60 - Admin Authentication",
    name: "Verify Admin Reset OTP",
    method: "POST",
    path: "/api/v1/admin/auth/verify-otp",
    body: { email: "{{adminEmail}}", otp: "123456" },
  },
  {
    folder: "60 - Admin Authentication",
    name: "Reset Admin Password",
    method: "POST",
    path: "/api/v1/admin/auth/reset-password",
    body: {
      email: "{{adminEmail}}",
      resetToken: "{{resetToken}}",
      newPassword: "New-Admin-Password-123!",
    },
  },
  {
    folder: "60 - Admin Authentication",
    name: "Change Admin Password",
    method: "POST",
    path: "/api/v1/admin/auth/change-password",
    body: {
      oldPassword: "{{adminPassword}}",
      newPassword: "New-Admin-Password-123!",
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "60 - Admin Authentication",
    name: "Update Admin Profile",
    method: "PATCH",
    path: "/api/v1/admin/profile",
    body: { displayName: "Fleet Administrator", title: "Operations Manager" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "60 - Admin Authentication",
    name: "Update Admin Profile Image",
    method: "POST",
    path: "/api/v1/admin/profile/image",
    body: { fileKey: "admins/profile/avatar.jpg" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Get Booking Status History",
    method: "GET",
    path: "/api/v1/admin/bookings/{{bookingId}}/status-history",
  },
  {
    folder: "70 - Admin Booking Management",
    name: "Get Booking Bids",
    method: "GET",
    path: "/api/v1/admin/bookings/{{bookingId}}/bids",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Escalate Support Ticket",
    method: "POST",
    path: "/api/v1/admin/support/tickets/{{ticketId}}/escalate",
    body: { reason: "Requires senior support review" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "85 - Admin Search",
    name: "Global Search",
    method: "GET",
    path: "/api/v1/admin/search?query=driver&limit=10",
  },

  // Missing Admin payment, refund, wallet, and payout APIs
  {
    folder: "74 - Admin Payment Management",
    name: "List Payments",
    method: "GET",
    path: "/api/v1/admin/payments?page=1&limit=20",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Get Payment",
    method: "GET",
    path: "/api/v1/admin/payments/{{paymentId}}",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Retry Payment",
    method: "POST",
    path: "/api/v1/admin/payments/{{paymentId}}/retry",
    csrf: "adminCsrfToken",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Reconcile Payment",
    method: "POST",
    path: "/api/v1/admin/payments/{{paymentId}}/reconcile",
    csrf: "adminCsrfToken",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "List Refunds",
    method: "GET",
    path: "/api/v1/admin/refunds?page=1&limit=20",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Get Refund",
    method: "GET",
    path: "/api/v1/admin/refunds/{{refundId}}",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Process Refund",
    method: "POST",
    path: "/api/v1/admin/refunds/{{refundId}}/process",
    csrf: "adminCsrfToken",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Reject Refund",
    method: "POST",
    path: "/api/v1/admin/refunds/{{refundId}}/reject",
    body: { note: "Refund request does not meet policy requirements" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "List Customer Wallets",
    method: "GET",
    path: "/api/v1/admin/wallets/customers?page=1&limit=20",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Get Customer Wallet",
    method: "GET",
    path: "/api/v1/admin/wallets/customers/{{walletId}}",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "List Driver Wallets",
    method: "GET",
    path: "/api/v1/admin/wallets/drivers?page=1&limit=20",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Get Driver Wallet",
    method: "GET",
    path: "/api/v1/admin/wallets/drivers/{{walletId}}",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "List Payout Settlements",
    method: "GET",
    path: "/api/v1/admin/payouts?page=1&limit=20",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Process Payout Settlement",
    method: "POST",
    path: "/api/v1/admin/payouts/{{settlementId}}/process",
    csrf: "adminCsrfToken",
  },
  {
    folder: "74 - Admin Payment Management",
    name: "Reject Payout Settlement",
    method: "POST",
    path: "/api/v1/admin/payouts/{{settlementId}}/reject",
    csrf: "adminCsrfToken",
  },

  // Missing Admin coupon, incentive, dispatch, surge, and cancellation APIs
  {
    folder: "75 - Admin Coupon Management",
    name: "List Coupons",
    method: "GET",
    path: "/api/v1/admin/coupons?page=1&limit=20",
  },
  {
    folder: "75 - Admin Coupon Management",
    name: "Get Coupon",
    method: "GET",
    path: "/api/v1/admin/coupons/{{couponId}}",
  },
  {
    folder: "75 - Admin Coupon Management",
    name: "Create Coupon",
    method: "POST",
    path: "/api/v1/admin/coupons",
    body: {
      code: "WELCOME20",
      discountType: "PERCENTAGE",
      discountValue: 20,
      maxDiscount: 100,
      minimumFare: 200,
      maxUses: 1000,
      maxUsesPerUser: 1,
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      newUsersOnly: true,
      isActive: true,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "75 - Admin Coupon Management",
    name: "Update Coupon",
    method: "PATCH",
    path: "/api/v1/admin/coupons/{{couponId}}",
    body: { discountValue: 25, isActive: true },
    csrf: "adminCsrfToken",
  },
  {
    folder: "75 - Admin Coupon Management",
    name: "Delete Coupon",
    method: "DELETE",
    path: "/api/v1/admin/coupons/{{couponId}}",
    csrf: "adminCsrfToken",
  },
  {
    folder: "76 - Admin Incentive Management",
    name: "List Incentives",
    method: "GET",
    path: "/api/v1/admin/incentives?page=1&limit=20",
  },
  {
    folder: "76 - Admin Incentive Management",
    name: "Get Incentive",
    method: "GET",
    path: "/api/v1/admin/incentives/{{incentiveId}}",
  },
  {
    folder: "76 - Admin Incentive Management",
    name: "Create Incentive",
    method: "POST",
    path: "/api/v1/admin/incentives",
    body: {
      name: "Complete 20 Trips",
      description: "Complete 20 trips during the offer period",
      type: "TRIP_COUNT",
      target: 20,
      reward: 500,
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      isActive: true,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "76 - Admin Incentive Management",
    name: "Update Incentive",
    method: "PATCH",
    path: "/api/v1/admin/incentives/{{incentiveId}}",
    body: { reward: 600, isActive: true },
    csrf: "adminCsrfToken",
  },
  {
    folder: "76 - Admin Incentive Management",
    name: "Delete Incentive",
    method: "DELETE",
    path: "/api/v1/admin/incentives/{{incentiveId}}",
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Get Dispatch Settings",
    method: "GET",
    path: "/api/v1/admin/dispatch-settings",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Update Dispatch Settings",
    method: "PATCH",
    path: "/api/v1/admin/dispatch-settings",
    body: { radiusMeters: 5000, maxAttempts: 3, timeoutSeconds: 30 },
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "List Surge Rules",
    method: "GET",
    path: "/api/v1/admin/surge-rules?page=1&limit=20",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Get Surge Rule",
    method: "GET",
    path: "/api/v1/admin/surge-rules/{{surgeId}}",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Create Surge Rule",
    method: "POST",
    path: "/api/v1/admin/surge-rules",
    body: {
      vehicleCategoryId: "{{categoryId}}",
      name: "Peak Hour Surge",
      multiplier: 1.5,
      startsAt: "2026-12-01T17:00:00.000Z",
      endsAt: "2026-12-01T21:00:00.000Z",
      isActive: true,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Update Surge Rule",
    method: "PATCH",
    path: "/api/v1/admin/surge-rules/{{surgeId}}",
    body: { multiplier: 1.75, isActive: true },
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Delete Surge Rule",
    method: "DELETE",
    path: "/api/v1/admin/surge-rules/{{surgeId}}",
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "List Cancellation Reasons",
    method: "GET",
    path: "/api/v1/admin/cancellation-reasons",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Get Cancellation Reason",
    method: "GET",
    path: "/api/v1/admin/cancellation-reasons/{{cancellationReasonId}}",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Create Cancellation Reason",
    method: "POST",
    path: "/api/v1/admin/cancellation-reasons",
    body: {
      code: "DRIVER_DELAYED",
      description: "Driver arrival was delayed",
      type: "CUSTOMER",
      isActive: true,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Update Cancellation Reason",
    method: "PATCH",
    path: "/api/v1/admin/cancellation-reasons/{{cancellationReasonId}}",
    body: { description: "Driver arrival exceeded the expected time" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Delete Cancellation Reason",
    method: "DELETE",
    path: "/api/v1/admin/cancellation-reasons/{{cancellationReasonId}}",
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "List Cancellation Rules",
    method: "GET",
    path: "/api/v1/admin/cancellation-rules",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Get Cancellation Rule",
    method: "GET",
    path: "/api/v1/admin/cancellation-rules/{{cancellationRuleId}}",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Create Cancellation Rule",
    method: "POST",
    path: "/api/v1/admin/cancellation-rules",
    body: {
      name: "Standard Cancellation Rule",
      description: "Standard cancellation policy",
      vehicleCategoryId: "{{categoryId}}",
      serviceAreaId: "{{serviceAreaId}}",
      freeWindowMinutes: 5,
      chargeAmount: 50,
      driverCompensation: 25,
      isActive: true,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Update Cancellation Rule",
    method: "PATCH",
    path: "/api/v1/admin/cancellation-rules/{{cancellationRuleId}}",
    body: { freeWindowMinutes: 10, chargeAmount: 75 },
    csrf: "adminCsrfToken",
  },
  {
    folder: "77 - Admin Dispatch & Rules",
    name: "Delete Cancellation Rule",
    method: "DELETE",
    path: "/api/v1/admin/cancellation-rules/{{cancellationRuleId}}",
    csrf: "adminCsrfToken",
  },

  // Missing Admin disputes, service areas, zones, and rating lookups
  {
    folder: "79 - Admin Support Management",
    name: "List Disputes",
    method: "GET",
    path: "/api/v1/admin/disputes?page=1&limit=20",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Get Dispute",
    method: "GET",
    path: "/api/v1/admin/disputes/{{disputeId}}",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Resolve Dispute",
    method: "POST",
    path: "/api/v1/admin/disputes/{{disputeId}}/resolve",
    body: { note: "Dispute resolved after reviewing payment evidence" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "79 - Admin Support Management",
    name: "Reject Dispute",
    method: "POST",
    path: "/api/v1/admin/disputes/{{disputeId}}/reject",
    body: { note: "Dispute rejected after reviewing payment evidence" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "List Service Areas",
    method: "GET",
    path: "/api/v1/admin/service-areas",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Get Service Area",
    method: "GET",
    path: "/api/v1/admin/service-areas/{{serviceAreaId}}",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Create Service Area",
    method: "POST",
    path: "/api/v1/admin/service-areas",
    body: {
      name: "Delhi NCR",
      city: "New Delhi",
      state: "Delhi",
      country: "India",
      timezone: "Asia/Kolkata",
      boundaryPolygon: {
        type: "Polygon",
        coordinates: [
          [
            [77.0, 28.4],
            [77.4, 28.4],
            [77.4, 28.8],
            [77.0, 28.8],
            [77.0, 28.4],
          ],
        ],
      },
      centerLatitude: 28.6139,
      centerLongitude: 77.209,
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Update Service Area",
    method: "PATCH",
    path: "/api/v1/admin/service-areas/{{serviceAreaId}}",
    body: { city: "New Delhi", timezone: "Asia/Kolkata" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "List Service Area Zones",
    method: "GET",
    path: "/api/v1/admin/service-areas/{{serviceAreaId}}/zones",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Get Zone",
    method: "GET",
    path: "/api/v1/admin/zones/{{zoneId}}",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Create Zone",
    method: "POST",
    path: "/api/v1/admin/zones",
    body: {
      serviceAreaId: "{{serviceAreaId}}",
      name: "Central Delhi",
      type: "OPERATING",
      polygon: {
        type: "Polygon",
        coordinates: [
          [
            [77.1, 28.5],
            [77.3, 28.5],
            [77.3, 28.7],
            [77.1, 28.7],
            [77.1, 28.5],
          ],
        ],
      },
    },
    csrf: "adminCsrfToken",
  },
  {
    folder: "83 - Admin Platform Configuration",
    name: "Update Zone",
    method: "PATCH",
    path: "/api/v1/admin/zones/{{zoneId}}",
    body: { name: "Central Delhi Updated", type: "OPERATING" },
    csrf: "adminCsrfToken",
  },
  {
    folder: "64 - Admin Customer Management",
    name: "Get Customer Ratings",
    method: "GET",
    path: "/api/v1/admin/customers/{{customerId}}/ratings",
  },
  {
    folder: "65 - Admin Driver Management",
    name: "Get Driver Ratings",
    method: "GET",
    path: "/api/v1/admin/drivers/{{driverId}}/ratings",
  },
];

routes.push(...coverageRoutes);

// ---------------------------------------------------------
// 2. Collection Builder
// ---------------------------------------------------------
const collection: any = {
  info: {
    name: "Fleet Management - All APIs",
    description:
      "Consolidated API collection for Taxi Operations & Endpoints. Includes the complete cookie-session Driver API flow and admin-side Driver/KYC operations.",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [] as any[],
  event: [
    {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          'pm.test("Sensitive check: No secrets leakage", function () {',
          "  const txt = pm.response.text();",
          "  const sensitive = ['sessionSecret', 'gatewaySecret', 'privateKey', 'awsSecretAccessKey', 'cvv', 'upiPin'];",
          "  sensitive.forEach(key => {",
          "    pm.expect(txt).to.not.include(key);",
          "  });",
          "});",
        ],
      },
    },
  ],
};

const folders = new Map<string, any>();

for (const route of routes) {
  if (!folders.has(route.folder)) {
    folders.set(route.folder, { name: route.folder, item: [] });
  }

  const requestHeaders =
    ("formData" in route && route.formData) ||
    ("noJsonContentType" in route && route.noJsonContentType)
      ? []
      : [{ key: "Content-Type", value: "application/json" }];
  if (route.csrf) {
    requestHeaders.push({ key: "x-csrf-token", value: `{{${route.csrf}}}` });
  }
  if ("idempotency" in route && route.idempotency) {
    requestHeaders.push({
      key: "x-idempotency-key",
      value: "{{idempotencyKey}}",
    });
  }
  if (route.headers) {
    requestHeaders.push(...route.headers);
  }

  const events: any[] = [];

  // Test script for assertions and dynamic variable extraction
  const execLines = [
    `pm.test("Response is JSON", function () { pm.response.to.be.json; });`,
    `pm.test("Successful status code", function () { pm.expect(pm.response.code).to.be.oneOf([200, 201, 202, 204]); });`,
    `pm.test("No internal stack trace", function () { const txt = pm.response.text(); pm.expect(txt).to.not.include("PrismaClient"); pm.expect(txt).to.not.include("stack"); });`,
    `const json = pm.response.json();`,
    `const data = json?.data;`,
    `if (data && pm.response.code >= 200 && pm.response.code < 300) {`,
    `  if (data.id) {`,
    `    const folder = '${route.folder}';`,
    `    const name = '${route.name}';`,
    `    if (folder.includes('Customer Immediate Booking') && name === 'Create Booking') pm.environment.set("bookingId", data.id);`,
    `    if (folder.includes('Customer Immediate Booking') && name === 'Create Immediate Booking (Customer API)') pm.environment.set("bookingId", data.id);`,
    `    if (folder.includes('Customer Scheduled Booking') && name === 'Create Scheduled Booking') pm.environment.set("scheduledBookingId", data.id);`,
    `    if (folder.includes('Customer Scheduled Booking') && name === 'Create Scheduled Booking (Customer API)') { pm.environment.set("bookingId", data.id); pm.environment.set("scheduledBookingId", data.id); }`,
    `    if (folder.includes('Customer Fare Estimate') && name === 'Estimate Fare') pm.environment.set("fareEstimateId", data.id);`,
    `    if (folder.includes('Admin Vehicle Categories') && name === 'Create Category') pm.environment.set("categoryId", data.id);`,
    `    if (folder.includes('Driver Vehicles') && name === 'Create Vehicle') pm.environment.set("vehicleId", data.id);`,
    `    if (folder.includes('Driver Bank Accounts') && name === 'Add Bank Account') pm.environment.set("driverBankAccountId", data.id);`,
    `    if (folder.includes('Driver Payouts') && name === 'Request Payout') pm.environment.set("driverPayoutId", data.id);`,
    `    if (folder.includes('Driver Notifications') && name === 'Register Device') pm.environment.set("driverDeviceId", data.id);`,
    `    if (folder.includes('Driver KYC') && name.includes('Submit KYC')) pm.environment.set("kycId", data.id);`,
    `    if (folder.includes('Customer Addresses') && name === 'Create Address') pm.environment.set("addressId", data.id);`,
    `    if (folder.includes('Customer Safety & SOS') && name === 'Create SOS') pm.environment.set("sosId", data.id);`,
    `    if (folder.includes('Driver Safety & SOS') && name === 'Raise SOS') pm.environment.set("sosId", data.id);`,
    `    if (folder.includes('Customer Support') && name === 'Create Support Ticket') pm.environment.set("ticketId", data.id);`,
    `    if (folder.includes('Driver Support') && name === 'Create Ticket') pm.environment.set("ticketId", data.id);`,
    `    if (folder.includes('Admin Support Management') && name === 'Create Support Category') pm.environment.set("supportCategoryId", data.id);`,
    `    if (folder.includes('Admin Reports & Analytics') && name === 'Create Report Export Job') pm.environment.set("reportExportId", data.id);`,
    `    if (folder.includes('Admin Coupon Management') && name === 'Create Coupon') pm.environment.set("couponId", data.id);`,
    `    if (folder.includes('Admin Incentive Management') && name === 'Create Incentive') pm.environment.set("incentiveId", data.id);`,
    `    if (folder.includes('Admin Dispatch & Rules') && name === 'Create Surge Rule') pm.environment.set("surgeId", data.id);`,
    `    if (folder.includes('Admin Dispatch & Rules') && name === 'Create Cancellation Reason') pm.environment.set("cancellationReasonId", data.id);`,
    `    if (folder.includes('Admin Dispatch & Rules') && name === 'Create Cancellation Rule') pm.environment.set("cancellationRuleId", data.id);`,
    `    if (folder.includes('Admin Platform Configuration') && name === 'Create Service Area') pm.environment.set("serviceAreaId", data.id);`,
    `    if (folder.includes('Admin Platform Configuration') && name === 'Create Zone') pm.environment.set("zoneId", data.id);`,
    `  }`,
    `  if (data.bookingId) pm.environment.set("bookingId", data.bookingId);`,
    `  if (data.customer?.id) pm.environment.set("customerId", data.customer.id);`,
    `  if (data.estimateId) pm.environment.set("fareEstimateId", data.estimateId);`,
    `  if (data.driverId) pm.environment.set("driverId", data.driverId);`,
    `  if (data.driver?.id) pm.environment.set("driverId", data.driver.id);`,
    `  if (data.tripId) pm.environment.set("tripId", data.tripId);`,
    `  if (data.vehicleId) pm.environment.set("vehicleId", data.vehicleId);`,
    `  if (data.paymentId) pm.environment.set("paymentId", data.paymentId);`,
    `  if (data.refundId) pm.environment.set("refundId", data.refundId);`,
    `  if (data.invoiceId) pm.environment.set("invoiceId", data.invoiceId);`,
    `  if (data.sosId) pm.environment.set("sosId", data.sosId);`,
    `  if (data.resetToken) pm.environment.set("resetToken", data.resetToken);`,
    `  if (Array.isArray(data) && data[0]?.id) {`,
    `    const folder = '${route.folder}';`,
    `    if (folder.includes('Driver Documents')) pm.environment.set("driverDocumentId", data[0].id);`,
    `    if (folder.includes('Driver Vehicles')) pm.environment.set("vehicleId", data[0].id);`,
    `  }`,
    `  if (data.csrfToken) {`,
    `    const url = pm.request.url.toString();`,
    `    if (url.includes("customer")) pm.environment.set("customerCsrfToken", data.csrfToken);`,
    `    else if (url.includes("driver")) pm.environment.set("driverCsrfToken", data.csrfToken);`,
    `    else if (url.includes("admin")) pm.environment.set("adminCsrfToken", data.csrfToken);`,
    `  }`,
    `  const csrf = pm.response.headers.get("x-csrf-token");`,
    `  if (csrf) {`,
    `    const url = pm.request.url.toString();`,
    `    if (url.includes("customer")) pm.environment.set("customerCsrfToken", csrf);`,
    `    else if (url.includes("driver")) pm.environment.set("driverCsrfToken", csrf);`,
    `    else if (url.includes("admin")) pm.environment.set("adminCsrfToken", csrf);`,
    `  }`,
    `}`,
  ];

  if (route.folder === "45 - Driver Subscriptions") {
    execLines.push(
      "if (json.success && data) {",
      '  if (Array.isArray(data) && data[0]) pm.environment.set("subscriptionPlanId", data[0].id);',
      '  if (data.subscription) pm.environment.set("subscriptionId", data.subscription.id);',
      '  if (data.paymentId) pm.environment.set("subscriptionPaymentId", data.paymentId);',
      "}",
    );
  }

  events.push({
    listen: "test",
    script: {
      type: "text/javascript",
      exec: execLines,
    },
  });

  if (route.preRequest) {
    events.push({
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [route.preRequest],
      },
    });
  }

  const pathPart = route.path ? route.path.split("?")[0] : "";
  const request: any = {
    method: route.method,
    header: requestHeaders,
    url: {
      raw: `{{BASE_URL}}${route.path}`,
      host: ["{{BASE_URL}}"],
      path: pathPart ? pathPart.split("/").filter((p) => p) : [],
    },
  };

  if (route.path && route.path.includes("?")) {
    const queryString = route.path.split("?")[1];
    if (queryString) {
      request.url.query = queryString.split("&").map((pair) => {
        const parts = pair.split("=");
        return { key: parts[0] || "", value: parts[1] || "" };
      });
    }
  }

  if ("formData" in route && route.formData) {
    request.body = {
      mode: "formdata",
      formdata: route.formData,
    };
  } else if (route.body) {
    request.body = {
      mode: "raw",
      raw: JSON.stringify(route.body, null, 2),
    };
  }

  const pathVariables = Array.from(
    route.path.matchAll(/\{\{([^}]+)\}\}/g),
    (match) => match[1],
  ).filter((name) => name !== "BASE_URL");
  const queryParameters = request.url.query ?? [];
  const headerLines = requestHeaders.length
    ? requestHeaders
        .map((header: any) => `${header.key}: ${header.value}`)
        .join("\n")
    : "None";
  const curlLines = [
    `curl --location --request ${route.method} '{{BASE_URL}}${route.path}'`,
  ];
  for (const header of requestHeaders) {
    curlLines.push(`--header '${header.key}: ${header.value}'`);
  }
  if (request.body?.mode === "raw") {
    curlLines.push(`--data '${request.body.raw}'`);
  } else if (request.body?.mode === "formdata") {
    for (const field of request.body.formdata) {
      const value =
        field.type === "file" ? `@${field.src || "<file>"}` : field.value;
      curlLines.push(`--form '${field.key}=${value}'`);
    }
  }
  request.description = [
    `## ${route.name}`,
    "",
    `**Method:** ${route.method}`,
    `**Endpoint:** \`${route.path}\``,
    `**Full URL:** \`{{BASE_URL}}${route.path}\``,
    "**Authentication:** Cookie session where required by the backend route guard; public/protected classification is UNVERIFIED in this generated metadata.",
    "**Roles/Permissions:** UNVERIFIED here; inspect the route guard and admin permission middleware.",
    "",
    "**Headers**",
    "```text",
    headerLines,
    "```",
    `**Path Parameters:** ${pathVariables.length ? pathVariables.join(", ") : "None"}`,
    `**Query Parameters:** ${queryParameters.length ? queryParameters.map((query: any) => `${query.key}=${query.value}`).join(", ") : "None"}`,
    "**Request Body:** See the Postman Body tab; no body means `No Request Body`.",
    "",
    "**cURL**",
    "```bash",
    curlLines.join(" \\\n"),
    "```",
    "**Success Response:** UNVERIFIED unless a saved example appears in the Examples tab.",
    "**Error Responses:** Uses the global `{ success: false, message, error: { code, details?, requestId } }` envelope.",
    "**Frontend Usage:** UNVERIFIED at request level; see `docs/COMPLETE-API-AUDIT.md` section P.",
    "**Backend Implementation:** Registered Fastify route; source mapping is documented by module in the audit.",
    "**Database Model:** UNVERIFIED at request level.",
    "**Status:** EXISTING in the generated backend contract; runtime data response remains UNVERIFIED.",
  ].join("\n");

  const responseExamples =
    "responses" in route && route.responses
      ? route.responses.map((example) => ({
          name: example.name,
          originalRequest: JSON.parse(JSON.stringify(request)),
          status: "OK",
          code: 200,
          _postman_previewlanguage: "json",
          header: [
            {
              key: "Content-Type",
              value: "application/json; charset=utf-8",
            },
          ],
          cookie: [],
          body: JSON.stringify(example.body, null, 2),
        }))
      : [];

  folders.get(route.folder)!.item.push({
    name: route.name,
    event: events,
    request: request,
    response: responseExamples,
  });
}

// Add folders sorted by name prefix
Array.from(folders.values())
  .sort((a, b) => a.name.localeCompare(b.name))
  .forEach((folder) => collection.item.push(folder));

// ---------------------------------------------------------
// 3. Variables Definition
// ---------------------------------------------------------
collection.variable = [
  { key: "BASE_URL", value: "http://localhost:5000", type: "string" },
  { key: "apiPrefix", value: "/api/v1", type: "string" },
  { key: "SOCKET_URL", value: "ws://localhost:5000", type: "string" },
  { key: "customerMobile", value: "+919900000001", type: "string" },
  { key: "driverMobile", value: "+919900000002", type: "string" },
  { key: "adminEmail", value: "admin@example.com", type: "string" },
  { key: "adminPassword", value: "Admin-Password-Change-Me!", type: "string" },
  { key: "otp", value: "1234", type: "string" },
  { key: "customerCsrfToken", value: "", type: "string" },
  { key: "driverCsrfToken", value: "", type: "string" },
  { key: "adminCsrfToken", value: "", type: "string" },
  { key: "customerId", value: "", type: "string" },
  { key: "driverId", value: "", type: "string" },
  { key: "adminId", value: "", type: "string" },
  { key: "customerProfileId", value: "", type: "string" },
  { key: "driverProfileId", value: "", type: "string" },
  { key: "categoryId", value: "", type: "string" },
  { key: "vehicleId", value: "", type: "string" },
  { key: "driverDocumentId", value: "", type: "string" },
  { key: "vehicleDocumentId", value: "", type: "string" },
  { key: "kycId", value: "", type: "string" },
  { key: "addressId", value: "", type: "string" },
  { key: "serviceAreaId", value: "", type: "string" },
  { key: "fareEstimateId", value: "", type: "string" },
  { key: "bookingId", value: "", type: "string" },
  { key: "scheduledBookingId", value: "", type: "string" },
  { key: "dispatchOfferId", value: "", type: "string" },
  { key: "tripId", value: "", type: "string" },
  { key: "tripStopId", value: "destination", type: "string" },
  { key: "tripOtp", value: "", type: "string" },
  { key: "paymentId", value: "", type: "string" },
  { key: "subscriptionPlanId", value: "", type: "string" },
  { key: "subscriptionId", value: "", type: "string" },
  { key: "subscriptionPaymentId", value: "", type: "string" },
  { key: "subscriptionProviderPaymentId", value: "", type: "string" },
  { key: "subscriptionSignature", value: "", type: "string" },
  {
    key: "subscriptionIdempotencyKey",
    value: "subscription-attempt-1",
    type: "string",
  },
  { key: "refundId", value: "", type: "string" },
  { key: "invoiceId", value: "", type: "string" },
  { key: "notificationId", value: "", type: "string" },
  { key: "deviceTokenId", value: "", type: "string" },
  {
    key: "driverDeviceToken",
    value: "driver_device_token_123",
    type: "string",
  },
  { key: "driverDeviceId", value: "", type: "string" },
  { key: "driverBankAccountId", value: "", type: "string" },
  { key: "driverPayoutId", value: "", type: "string" },
  {
    key: "idempotencyKey",
    value: "driver-postman-idempotency-1",
    type: "string",
  },
  { key: "ratingId", value: "", type: "string" },
  { key: "supportCategoryId", value: "", type: "string" },
  { key: "ticketId", value: "", type: "string" },
  { key: "sosId", value: "", type: "string" },
  { key: "reportExportId", value: "", type: "string" },
  { key: "platformConfigKey", value: "", type: "string" },
  { key: "resetToken", value: "", type: "string" },
  { key: "walletId", value: "", type: "string" },
  { key: "settlementId", value: "", type: "string" },
  { key: "couponId", value: "", type: "string" },
  { key: "incentiveId", value: "", type: "string" },
  { key: "surgeId", value: "", type: "string" },
  { key: "cancellationReasonId", value: "", type: "string" },
  { key: "cancellationRuleId", value: "", type: "string" },
  { key: "disputeId", value: "", type: "string" },
  { key: "zoneId", value: "", type: "string" },
  { key: "contactId", value: "", type: "string" },
  { key: "exportId", value: "", type: "string" },
  { key: "fareId", value: "", type: "string" },
  { key: "roleId", value: "", type: "string" },
  { key: "sessionId", value: "", type: "string" },
  { key: "templateId", value: "", type: "string" },
] as any[];

// ---------------------------------------------------------
// 4. Environments Definition & Write Outputs
// ---------------------------------------------------------
const createEnv = (name: string, baseUrl: string, socketUrl: string) => {
  return {
    id: `env-${name.toLowerCase()}-${Date.now()}`,
    name: name,
    values: collection.variable.map((v: any) => {
      let val = v.value;
      if (v.key === "BASE_URL") val = baseUrl;
      if (v.key === "SOCKET_URL") val = socketUrl;
      return {
        key: v.key,
        value: val,
        type: "default",
        enabled: true,
      };
    }),
    _postman_variable_scope: "environment",
  };
};

const localEnv = createEnv(
  "Fleet-Management-Local",
  "http://localhost:5000",
  "ws://localhost:5000",
);
const stagingEnv = createEnv(
  "Fleet-Management-Staging",
  "https://staging.fleet-taxi.com",
  "wss://staging.fleet-taxi.com",
);

const baseDir = path.resolve(__dirname, "../docs/postman");
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

// Write Collection All APIs
const outCollectionPath = path.join(
  baseDir,
  "Fleet-Management-All-APIs.postman_collection.json",
);
fs.writeFileSync(
  outCollectionPath,
  JSON.stringify(collection, null, 2),
  "utf8",
);
console.log(
  `Successfully generated Postman collection at: ${outCollectionPath}`,
);

// Mobile handoff collection: health plus canonical Customer and Driver flows.
const flutterMobileCollection = JSON.parse(JSON.stringify(collection));
flutterMobileCollection.info.name = "Fleet Management - Flutter Mobile APIs";
flutterMobileCollection.info.description =
  "Flutter handoff collection containing health checks and the canonical Customer and Driver REST flows. Authentication uses the signed cookie jar plus CSRF tokens captured by login/OTP requests.";
flutterMobileCollection.item = flutterMobileCollection.item.filter(
  (folder: any) => {
    const prefix = Number.parseInt(folder.name.split(" - ")[0], 10);
    return prefix === 0 || (prefix >= 2 && prefix <= 52);
  },
);
const removeAdminScriptLines = (items: any[]) => {
  for (const item of items) {
    for (const event of item.event ?? []) {
      if (Array.isArray(event.script?.exec)) {
        event.script.exec = event.script.exec.filter(
          (line: string) =>
            !line.includes('url.includes("admin")') &&
            !line.includes("adminCsrfToken"),
        );
      }
    }
    if (item.item) removeAdminScriptLines(item.item);
  }
};
removeAdminScriptLines(flutterMobileCollection.item);
const flutterItemsJson = JSON.stringify(flutterMobileCollection.item);
flutterMobileCollection.variable = flutterMobileCollection.variable.filter(
  (variable: any) =>
    ["BASE_URL", "SOCKET_URL"].includes(variable.key) ||
    flutterItemsJson.includes(`{{${variable.key}}}`),
);
const outFlutterCollectionPath = path.join(
  baseDir,
  "Fleet-Management-Flutter-Mobile.postman_collection.json",
);
fs.writeFileSync(
  outFlutterCollectionPath,
  JSON.stringify(flutterMobileCollection, null, 2),
  "utf8",
);
console.log(
  `Successfully generated Flutter mobile Postman collection at: ${outFlutterCollectionPath}`,
);

// Write duplicate fallback compatibility file
const outLegacyCollectionPath = path.join(
  baseDir,
  "Fleet-Management-API.postman_collection.json",
);
fs.writeFileSync(
  outLegacyCollectionPath,
  JSON.stringify(collection, null, 2),
  "utf8",
);

// Write Local Environment
const outLocalEnvPath = path.join(
  baseDir,
  "Fleet-Management-Local.postman_environment.json",
);
fs.writeFileSync(outLocalEnvPath, JSON.stringify(localEnv, null, 2), "utf8");
console.log(`Successfully generated Local environment at: ${outLocalEnvPath}`);

// Write Staging Environment
const outStagingEnvPath = path.join(
  baseDir,
  "Fleet-Management-Staging.postman_environment.json",
);
fs.writeFileSync(
  outStagingEnvPath,
  JSON.stringify(stagingEnv, null, 2),
  "utf8",
);
console.log(
  `Successfully generated Staging environment at: ${outStagingEnvPath}`,
);

const createFlutterEnv = (source: any, name: string) => ({
  ...source,
  id: `env-${name.toLowerCase()}-${Date.now()}`,
  name,
  values: source.values.filter((value: any) =>
    flutterMobileCollection.variable.some(
      (variable: any) => variable.key === value.key,
    ),
  ),
});
const flutterLocalEnv = createFlutterEnv(
  localEnv,
  "Fleet-Management-Flutter-Local",
);
const flutterStagingEnv = createFlutterEnv(
  stagingEnv,
  "Fleet-Management-Flutter-Staging",
);
for (const [filename, environment] of [
  ["Fleet-Management-Flutter-Local.postman_environment.json", flutterLocalEnv],
  [
    "Fleet-Management-Flutter-Staging.postman_environment.json",
    flutterStagingEnv,
  ],
] as const) {
  fs.writeFileSync(
    path.join(baseDir, filename),
    JSON.stringify(environment, null, 2),
    "utf8",
  );
}

// Write a human-readable Driver API inventory from the same source used to
// build the collection. This keeps the reported count and endpoint list in
// lockstep with Postman.
const driverRoutes = routes.filter((route) =>
  route.path.startsWith("/api/v1/driver/"),
);
const legacyDriverRoutes = routes.filter(
  (route) =>
    route.folder.startsWith("39 - Driver Ride Offers") &&
    !route.path.startsWith("/api/v1/driver/"),
);
const adminDriverRoutes = routes.filter(
  (route) =>
    route.folder.startsWith("65 - Admin Driver Management") ||
    route.folder.startsWith("66 - Admin Driver KYC"),
);

const inventoryLines = [
  "# Driver API Inventory",
  "",
  "This file is generated by `npm run postman:generate`. Do not edit it manually.",
  "",
  `- Driver REST APIs: **${driverRoutes.length}**`,
  `- Legacy dispatch compatibility APIs: **${legacyDriverRoutes.length}**`,
  `- Admin Driver/KYC APIs: **${adminDriverRoutes.length}**`,
  `- Driver-domain Postman requests: **${driverRoutes.length + legacyDriverRoutes.length + adminDriverRoutes.length}**`,
  "",
  "All protected Driver requests use the existing cookie session. State-changing requests also send `x-csrf-token`; no Bearer/JWT authentication is used.",
  "",
  "## Driver REST APIs",
  "",
];

const groupedDriverRoutes = new Map<string, typeof routes>();
for (const route of driverRoutes) {
  const list = groupedDriverRoutes.get(route.folder) ?? [];
  list.push(route);
  groupedDriverRoutes.set(route.folder, list);
}

for (const [folder, folderRoutes] of groupedDriverRoutes) {
  inventoryLines.push(
    `### ${folder.replace(/^\d+\s+-\s+/, "")} (${folderRoutes.length})`,
  );
  inventoryLines.push("");
  inventoryLines.push("| # | Method | Endpoint |");
  inventoryLines.push("| ---: | :---: | :--- |");
  folderRoutes.forEach((route, index) => {
    inventoryLines.push(
      `| ${index + 1} | ${route.method} | \`${route.path}\` |`,
    );
  });
  inventoryLines.push("");
}

inventoryLines.push("## Legacy Driver Dispatch Compatibility APIs");
inventoryLines.push("");
legacyDriverRoutes.forEach((route, index) => {
  inventoryLines.push(`${index + 1}. \`${route.method} ${route.path}\``);
});
inventoryLines.push("");
inventoryLines.push("## Admin Driver Management and KYC APIs");
inventoryLines.push("");
adminDriverRoutes.forEach((route, index) => {
  inventoryLines.push(`${index + 1}. \`${route.method} ${route.path}\``);
});
inventoryLines.push("");

const outDriverInventoryPath = path.join(baseDir, "driver-api-inventory.md");
fs.writeFileSync(
  outDriverInventoryPath,
  `${inventoryLines.join("\n")}\n`,
  "utf8",
);
console.log(
  `Successfully generated Driver API inventory (${driverRoutes.length} APIs) at: ${outDriverInventoryPath}`,
);
