import { z } from "zod";

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().trim().min(3).max(500),
  placeId: z.string().trim().max(100).optional(),
});

export const requestOtp = z
  .object({
    mobile: z
      .string()
      .regex(/^(?:\+91|91)?[6-9]\d{9}$/, "Invalid Indian mobile number")
      .transform((val) => val.replace(/\D/g, ""))
      .optional(),
    email: z
      .string()
      .email()
      .max(320)
      .endsWith("@gmail.com", "Only Gmail addresses are allowed")
      .optional(),
  })
  .refine((data) => data.mobile || data.email, {
    message: "Either mobile or email must be provided",
  });

export const verifyOtp = z
  .object({
    mobile: z
      .string()
      .regex(/^(?:\+91|91)?[6-9]\d{9}$/, "Invalid Indian mobile number")
      .transform((val) => val.replace(/\D/g, ""))
      .optional(),
    email: z
      .string()
      .email()
      .max(320)
      .endsWith("@gmail.com", "Only Gmail addresses are allowed")
      .optional(),
    otp: z.string().length(4),
    deviceId: z.string().max(255).optional(),
  })
  .refine((data) => data.mobile || data.email, {
    message: "Either mobile or email must be provided",
  });

const emptyStringToUndefined = (value: unknown) =>
  value === "" ? undefined : value;

export const profileCreate = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(320),
  gender: z.preprocess(
    emptyStringToUndefined,
    z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]).optional(),
  ),
  preferredLanguage: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(2).max(10).optional(),
  ),
});

export const profileUpdate = z
  .object({
    fullName: z.string().min(2).max(100).optional(),
    email: z.string().email().optional().nullable(),
    gender: z
      .enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"])
      .optional()
      .nullable(),
    preferredLanguage: z.string().max(10).optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "No data provided for update",
  );

export const preferencesUpdate = z
  .object({
    preferredLanguage: z.string().max(10).optional(),
    pushNotificationsEnabled: z.boolean().optional(),
    smsNotificationsEnabled: z.boolean().optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    promotionalEnabled: z.boolean().optional(),
    rideSafetyAlerts: z.boolean().optional(),
    locationSharing: z.boolean().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "No data provided for update",
  );

export const addressCreate = z.object({
  label: z.string().min(1).max(50),
  addressLine: z.string().min(5).max(255),
  landmark: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  placeId: z.string().max(100).optional(),
  isDefault: z.boolean().default(false),
});

export const addressUpdate = addressCreate
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    "No data provided for update",
  );

export const locationSearch = z.object({
  q: z.string().trim().min(2).max(100),
});

export const reverseGeocode = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const serviceabilityCheck = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const fareEstimate = z.object({
  pickup: locationSchema,
  drop: locationSchema,
  categoryId: z.string().uuid().optional(),
  couponCode: z.string().trim().max(40).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
});

export const bookingCreateImmediate = z.object({
  pickup: locationSchema,
  drop: locationSchema,
  categoryId: z.string().uuid(),
  fareEstimateId: z.string().uuid().optional(),
  paymentMethod: z
    .enum(["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "NET_BANKING", "WALLET"])
    .optional(),
  paymentType: z
    .enum(["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "NET_BANKING", "WALLET"])
    .optional(),
  couponCode: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
  passengerCount: z.number().int().positive().optional(),
  luggageCount: z.number().int().nonnegative().optional(),
  bookingFor: z
    .object({
      type: z.enum(["SELF", "OTHER"]),
      name: z.string().nullable().optional(),
      phoneNumber: z.string().nullable().optional(),
    })
    .optional(),
  specialRequirements: z.array(z.string()).optional(),
});

export const bookingCreateScheduled = bookingCreateImmediate.extend({
  scheduledAt: z.string().datetime(),
  estimateId: z.string().uuid().optional(), // Adding this for the prompt's new estimateId payload
});

export const bookingReschedule = z.object({
  scheduledAt: z.string().datetime(),
  reasonCode: z.string().trim().max(50).optional(),
  reason: z.string().trim().max(500).optional(),
});

export const tripsList = z.object({
  status: z
    .enum([
      "ALL",
      "ACCEPTED",
      "ONGOING",
      "COMPLETED",
      "CANCELLED",
      "REJECTED",
      "NO_SHOW",
    ])
    .optional(),
  dateFrom: z.string().date("Invalid date. Expected YYYY-MM-DD").optional(),
  dateTo: z.string().date("Invalid date. Expected YYYY-MM-DD").optional(),
  search: z.string().trim().min(1).max(100).optional(),
  vehicleCategoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(["asc", "desc"]).optional(),
});

const scheduledRideStatuses = [
  "UPCOMING",
  "PENDING",
  "SEARCHING_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_COMPLETED",
  "CANCELLED",
  "NO_DRIVER_FOUND",
  "PAYMENT_PENDING",
  "PAYMENT_COMPLETED",
] as const;

export const scheduledRidesList = z.object({
  status: z.enum(scheduledRideStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const bookingCancel = z.object({
  reasonCode: z.string().trim().min(2).max(50),
  reason: z.string().trim().max(500).optional(),
});

export const changePaymentMethod = z.object({
  paymentMethod: z.enum([
    "CASH",
    "UPI",
    "CREDIT_CARD",
    "DEBIT_CARD",
    "NET_BANKING",
    "WALLET",
  ]),
});

export const createPaymentOrder = z.object({
  bookingId: z.string().uuid().optional(),
  amount: z.number().positive().optional(),
  purpose: z.enum(["BOOKING", "WALLET"]),
});

export const verifyPayment = z.object({
  paymentId: z.string().uuid(),
  providerPaymentId: z.string().trim().min(3).max(200),
  signature: z.string().trim().min(16).max(200),
});

export const walletAddMoney = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(["UPI", "CREDIT_CARD", "DEBIT_CARD", "NET_BANKING"]),
});

export const couponValidate = z.object({
  couponCode: z.string().trim().toUpperCase().min(1).max(40),
  subtotal: z.number().positive(),
  categoryId: z.string().uuid().optional(),
});

export const referralApply = z.object({
  referralCode: z.string().trim().max(20),
});

export const ratingCreate = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const supportTicketAttachment = z.union([
  z.string().url().max(2000),
  z.object({
    url: z.string().url().max(2000),
    name: z.string().trim().max(255).optional(),
  }),
  z
    .array(
      z.object({
        url: z.string().url().max(2000),
        name: z.string().trim().max(255).optional(),
      }),
    )
    .max(5),
]);

export const supportTicketCreate = z
  .object({
    categoryId: z.string().uuid().optional(),
    subject: z.string().trim().min(3).max(200).optional(),
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(1).max(4000),
    bookingId: z.string().uuid().optional(),
    tripId: z.string().uuid().optional(),
    paymentId: z.string().uuid().optional(),
    attachments: supportTicketAttachment.optional(),
    attachmentUrl: z.string().url().max(2000).optional(),
  })
  .refine((data) => Boolean(data.subject || data.title), {
    message: "subject or title is required",
    path: ["subject"],
  });

export const supportMessageCreate = z.object({
  message: z.string().trim().min(1).max(4000),
  attachments: supportTicketAttachment.optional(),
  attachmentUrl: z.string().url().max(2000).optional(),
});

export const safetySosCreate = z.object({
  bookingId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  message: z.string().trim().max(500).optional(),
});

export const safetyMessageCreate = z.object({
  message: z.string().trim().min(1).max(4000),
});

export const safetyIncidentReport = z.object({
  bookingId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  type: z.string().trim().min(2).max(100),
  description: z.string().trim().min(5).max(1000),
});

export const emergencyContactCreate = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number"),
  relationship: z.string().trim().max(50).optional(),
});
