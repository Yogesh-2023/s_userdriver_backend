import { z } from "zod";

export const uuidParams = (name: string) =>
  z.object({ [name]: z.uuid() }) as z.ZodObject<Record<string, z.ZodUUID>>;

export const pagination = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const reviewQuery = pagination.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["APPROVED", "HIDDEN", "FLAGGED"]).optional(),
});

export const dateRange = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

const validDateRange = (value: { from?: Date; to?: Date }) =>
  !value.from || !value.to || value.to >= value.from;

export const adminLogin = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
});

export const forgotPassword = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
});

export const verifyOtp = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  otp: z.string().min(6).max(10),
});

export const resetPassword = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  resetToken: z.string().uuid(),
  newPassword: z.string().min(8).max(128),
});

export const changePassword = z.object({
  oldPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

export const adminUpdateProfile = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    email: z
      .email()
      .max(320)
      .transform((value) => value.trim().toLowerCase())
      .optional(),
    title: z.string().trim().max(100).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No update supplied");

export const adminUpdateProfileImage = z.object({
  fileKey: z.string().trim().min(1).max(255),
});

export const adminCreate = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  displayName: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  title: z.string().trim().max(100).optional(),
  role: z.enum(["ADMIN", "SUPER_ADMIN"]).default("ADMIN"),
});

export const adminUpdate = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    email: z
      .email()
      .max(320)
      .transform((value) => value.trim().toLowerCase())
      .optional(),
    title: z.string().trim().max(100).nullable().optional(),
    role: z.enum(["ADMIN", "SUPER_ADMIN"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No update supplied");

export const adminPasswordUpdate = z.object({
  password: z.string().min(8).max(100),
  reason: z.string().trim().min(5).max(500),
});

export const adminRoleAssignment = z.object({
  roleId: z.uuid(),
});

export const adminPermissionAssignment = z.object({
  permissionId: z.uuid(),
});

export const customerList = pagination
  .extend({
    search: z.string().trim().max(120).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "BLOCKED", "DELETED"]).optional(),
    ...dateRange,
    sort: z
      .enum(["newest", "oldest", "booking_count", "total_spending"])
      .default("newest"),
  })
  .refine(validDateRange, {
    message: "to must be on or after from",
    path: ["to"],
  });

export const customerCreate = z.object({
  phone: z.string().trim().min(5).max(20),
  displayName: z.string().trim().min(2).max(120),
  email: z.email().max(320).optional(),
});

export const customerUpdate = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    email: z.email().max(320).nullable().optional(),
    dateOfBirth: z.coerce.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No update supplied");

export const accountStatusUpdate = z.object({
  status: z.preprocess(
    (val) => (typeof val === "string" ? val.toUpperCase() : val),
    z.enum(["ACTIVE", "SUSPENDED", "BLOCKED", "DELETED"]),
  ),
  reason: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((val) => val || "Status updated"),
});

export const vehicleAssignDriver = z.object({
  driverId: z.string().uuid(),
});

export const vehicleMaintenanceCreate = z.object({
  description: z.string().trim().min(2).max(255),
  cost: z.number().min(0),
  date: z.coerce.date(),
});

export const vehicleInsuranceCreate = z.object({
  provider: z.string().trim().min(2).max(120),
  policyNo: z.string().trim().min(2).max(100),
  expiresAt: z.coerce.date(),
});

export const driverList = pagination
  .extend({
    search: z.string().trim().max(120).optional(),
    tab: z
      .enum(["all", "online", "on_trip", "pending_kyc", "suspended"])
      .default("all"),
    categoryId: z.uuid().optional(),
    assigned: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    maxRating: z.coerce.number().min(0).max(5).optional(),
    ...dateRange,
  })
  .refine(validDateRange, {
    message: "to must be on or after from",
    path: ["to"],
  })
  .refine(
    (value) =>
      value.minRating === undefined ||
      value.maxRating === undefined ||
      value.maxRating >= value.minRating,
    { message: "maxRating must be at least minRating", path: ["maxRating"] },
  );

export const driverCreate = z.object({
  phoneNumber: z.string().trim().min(5).max(20),
  firstName: z.string().trim().min(2).max(120),
  lastName: z.string().trim().min(2).max(120).optional(),
  email: z.email().max(320).optional(),
});

export const driverUpdate = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    email: z.email().max(320).nullable().optional(),
    licenseNumber: z.string().trim().min(3).max(50).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No update supplied");

export const verificationUpdate = z.object({
  status: z.enum(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"]),
  reason: z.string().trim().min(5).max(500).optional(),
});

export const assignmentBody = z.object({
  vehicleId: z.uuid(),
  reason: z.string().trim().min(5).max(500).optional(),
});

export const dispatchOfferBody = z.object({
  driverId: z.uuid(),
  reason: z.string().trim().min(5).max(500).optional(),
});

export const reasonBody = z.object({
  reason: z.string().trim().min(5).max(500),
});

export const optionalReasonBody = z.object({
  reason: z.string().trim().min(5).max(500).optional(),
});

export const documentVerificationUpdate = z.object({
  status: z.enum(["VERIFIED", "REJECTED"]),
  reason: z.string().trim().min(5).max(500).optional(),
});

export const vehicleList = pagination.extend({
  search: z.string().trim().max(120).optional(),
  status: z
    .enum([
      "PENDING",
      "ACTIVE",
      "INACTIVE",
      "IN_SERVICE",
      "MAINTENANCE",
      "SUSPENDED",
    ])
    .optional(),
  verificationStatus: z
    .enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"])
    .optional(),
  categoryId: z.uuid().optional(),
  assigned: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const vehicleCreate = z.object({
  categoryId: z.uuid(),
  registrationNo: z.string().trim().min(4).max(30),
  make: z.string().trim().min(2).max(80),
  model: z.string().trim().min(1).max(80),
  color: z.string().trim().max(40).optional(),
  year: z
    .number()
    .int()
    .min(1980)
    .max(new Date().getUTCFullYear() + 1)
    .optional(),
  seatingCapacity: z.number().int().min(1).max(50).optional(),
  fuelType: z.string().trim().min(2).max(40).optional(),
  rc: z.any().optional(),
  rcFileKey: z.string().optional(),
  rcUrl: z.string().optional(),
  rcNumber: z.string().optional(),
  insurance: z.any().optional(),
  insuranceFileKey: z.string().optional(),
  insuranceUrl: z.string().optional(),
  insuranceCompany: z.string().optional(),
  policyNumber: z.string().optional(),
  policyValidTill: z.string().optional(),
  vehiclePhoto: z.any().optional(),
  vehiclePhotoFileKey: z.string().optional(),
  vehiclePhotoUrl: z.string().optional(),
  documents: z.array(z.any()).optional(),
});

export const vehicleUpdate = vehicleCreate
  .partial()
  .refine((value) => Object.keys(value).length > 0, "No update supplied");

export const vehicleStatusUpdate = z.object({
  status: z.enum([
    "PENDING",
    "ACTIVE",
    "INACTIVE",
    "IN_SERVICE",
    "MAINTENANCE",
    "SUSPENDED",
  ]),
  reason: z.string().trim().min(5).max(500),
});

export const vehicleVerificationUpdate = z.object({
  status: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]),
  reason: z.string().trim().min(5).max(500).optional(),
});

export const categoryBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    imageUrl: z.string().url().max(255).optional(),
    iconUrl: z.string().url().max(255).optional(),
    minPassengers: z.number().int().min(1).max(50).optional(),
    maxPassengers: z.number().int().min(1).max(50).optional(),
    allowedFuelTypes: z
      .array(z.enum(["PETROL", "DIESEL", "CNG"]))
      .optional()
      .default([]),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .refine(
    (data) => {
      if (
        data.minPassengers !== undefined &&
        data.maxPassengers !== undefined
      ) {
        return data.minPassengers <= data.maxPassengers;
      }
      return true;
    },
    {
      message: "Minimum passengers cannot exceed maximum passengers",
      path: ["maxPassengers"],
    },
  );

export const bookingCreate = z.object({
  customerId: z.string().uuid(),
  pickupLocation: z.object({
    latitude: z.number(),
    longitude: z.number(),
    address: z.string().trim(),
  }),
  dropoffLocation: z.object({
    latitude: z.number(),
    longitude: z.number(),
    address: z.string().trim(),
  }),
  scheduledAt: z.coerce.date().optional(),
  vehicleCategoryId: z.string().uuid().optional(),
  estimatedFare: z.number().optional(),
});

export const bookingUpdate = z.object({
  status: z
    .enum(["PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .optional(),
  notes: z.string().optional(),
});

export const paymentStatusUpdate = z.object({
  status: z.enum(["PENDING", "COMPLETED", "FAILED", "REFUNDED"]),
  transactionId: z.string().optional(),
});

export const bookingList = pagination
  .extend({
    search: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .transform((val) => val || undefined),
    bookingId: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.uuid().optional(),
    ),
    customerId: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.uuid().optional(),
    ),
    driverId: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.uuid().optional(),
    ),
    vehicleId: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.uuid().optional(),
    ),
    categoryId: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.uuid().optional(),
    ),
    status: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z
        .enum([
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
        ])
        .optional(),
    ),
    paymentStatus: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z
        .enum([
          "CREATED",
          "PENDING",
          "AUTHORIZED",
          "CAPTURED",
          "FAILED",
          "REFUNDED",
          "PARTIALLY_REFUNDED",
          "CANCELLED",
        ])
        .optional(),
    ),
    type: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.enum(["IMMEDIATE", "SCHEDULED"]).optional(),
    ),
    pickup: z.string().trim().max(120).optional(),
    drop: z.string().trim().max(120).optional(),
    ...dateRange,
  })
  .refine(validDateRange, {
    message: "to must be on or after from",
    path: ["to"],
  });

export const bookingAssignment = z.object({
  driverId: z.uuid(),
  vehicleId: z.uuid().optional(),
  reason: z.string().trim().min(5).max(500),
});

export const bookingStatusUpdate = z.object({
  status: z.enum([
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
  ]),
  reason: z.string().trim().min(5).max(500),
});

export const tripList = pagination
  .extend({
    search: z.string().trim().max(120).optional(),
    status: z
      .enum([
        "CREATED",
        "DRIVER_ARRIVING",
        "DRIVER_ARRIVED",
        "STARTED",
        "COMPLETED",
        "CANCELLED",
      ])
      .optional(),
    driverId: z.uuid().optional(),
    vehicleId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    ...dateRange,
  })
  .refine(validDateRange, {
    message: "to must be on or after from",
    path: ["to"],
  });

export const tripStatusUpdate = z.object({
  status: z.enum([
    "CREATED",
    "DRIVER_ARRIVING",
    "DRIVER_ARRIVED",
    "STARTED",
    "COMPLETED",
    "CANCELLED",
  ]),
  reason: z.string().trim().min(5).max(500),
});

export const forceCompleteTrip = z.object({
  reason: z.string().trim().min(5).max(500),
  finalDistanceMeters: z.number().int().positive(),
  finalDurationSeconds: z.number().int().positive(),
  waitingMinutes: z.number().nonnegative().default(0),
  tollCharge: z.number().nonnegative().default(0),
});

export const resolveDisputeBody = z.object({
  note: z.string().trim().min(5).max(1000),
});

export const searchSchema = z.object({
  query: z.string().trim().min(2).max(100),
  limit: z.coerce.number().min(1).max(50).default(10),
});

// New Aliases schemas
export const emptyBody = z.object({}).optional();

// Service Area & Zone
export const createServiceAreaSchema = z.object({
  name: z.string().trim().min(2).max(100),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  country: z.string().trim().max(100),
  timezone: z.string().trim().max(50),
  boundaryPolygon: z.any(), // GeoJSON
  centerLatitude: z.number(),
  centerLongitude: z.number(),
});

export const updateServiceAreaSchema = createServiceAreaSchema.partial();

export const createZoneSchema = z.object({
  serviceAreaId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  type: z.string().trim().max(50),
  polygon: z.any(), // GeoJSON
});

export const updateZoneSchema = createZoneSchema
  .omit({ serviceAreaId: true })
  .partial();

export const noteBody = z.object({
  note: z.string().trim().min(2).max(2_000),
});

const money = z.coerce.number().nonnegative().max(10_000_000);

const fareBodyBase = z.object({
  vehicleCategoryId: z.uuid(),
  rideType: z.enum(["CITY", "RENTAL", "OUTSTATION"]),
  scopeKey: z.string().trim().min(2).max(100).default("GLOBAL"),
  scope: z.record(z.string(), z.unknown()).optional(),
  baseFare: money,
  minimumFare: money,
  perKilometer: money,
  perMinute: money,
  waitingPerMinute: money.default(0),
  cancellationFee: money.default(0),
  driverAllowance: money.default(0),
  platformCommission: z.coerce.number().min(0).max(100).default(0),
  taxPercentage: z.coerce.number().min(0).max(100).default(0),
  nightCharge: money.default(0),
  rentalPackageMinutes: z.number().int().positive().optional(),
  rentalPackageKm: z.number().int().positive().optional(),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const fareBody = fareBodyBase.refine(
  (value) => !value.effectiveTo || value.effectiveTo > value.effectiveFrom,
  {
    message: "effectiveTo must be after effectiveFrom",
    path: ["effectiveTo"],
  },
);

export const fareUpdate = fareBodyBase
  .omit({
    vehicleCategoryId: true,
    rideType: true,
    scopeKey: true,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "No update supplied");

export const fareStatus = z.object({ isActive: z.boolean() });

export const farePreview = z.object({
  vehicleCategoryId: z.uuid(),
  rideType: z.enum(["CITY", "RENTAL", "OUTSTATION"]),
  distanceMeters: z.number().int().positive(),
  durationSeconds: z.number().int().positive(),
  waitingMinutes: z.number().nonnegative().default(0),
  tollCharge: z.number().nonnegative().default(0),
});

const couponBase = z.object({
  code: z.string().trim().min(3).max(40).toUpperCase(),
  discountType: z.enum(["PERCENTAGE", "FIXED"]),
  discountValue: money,
  maxDiscount: money.nullable().optional(),
  minimumFare: money.default(0),
  maxUses: z.number().int().positive().nullable().optional(),
  maxUsesPerUser: z.number().int().positive().default(1),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  categoryId: z.string().uuid().nullable().optional(),
  serviceAreaId: z.string().uuid().nullable().optional(),
  newUsersOnly: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const couponCreate = couponBase.refine(
  (data) => data.validUntil > data.validFrom,
  { message: "validUntil must be after validFrom", path: ["validUntil"] },
);

export const couponUpdate = couponBase.partial().refine(
  (data) => {
    if (data.validFrom && data.validUntil) {
      return data.validUntil > data.validFrom;
    }
    return true;
  },
  { message: "validUntil must be after validFrom", path: ["validUntil"] },
);

export const notificationAudience = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ALL_CUSTOMERS") }),
  z.object({ type: z.literal("ALL_DRIVERS") }),
  z.object({ type: z.literal("ALL_USERS") }),
  z.object({ type: z.literal("ADMINS") }),
  z.object({
    type: z.literal("SELECTED_USERS"),
    userIds: z.array(z.uuid()).min(1).max(5_000),
  }),
  z.object({
    type: z.literal("USER_STATUS"),
    status: z.enum(["ACTIVE", "SUSPENDED", "BLOCKED"]),
    role: z.enum(["CUSTOMER", "DRIVER"]).optional(),
  }),
]);

export const notificationSend = z.object({
  audience: notificationAudience,
  channels: z.array(z.enum(["PUSH", "SMS", "EMAIL", "IN_APP"])).min(1),
  templateId: z.uuid().optional(),
  title: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(4_000),
  data: z.record(z.string(), z.unknown()).optional(),
  scheduledAt: z.coerce.date().optional(),
});

export const notificationTemplate = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{3,80}$/),
  channel: z.enum(["PUSH", "SMS", "EMAIL", "IN_APP"]),
  title: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(4_000),
  variables: z
    .array(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,49}$/))
    .max(50)
    .default([]),
  isActive: z.boolean().default(true),
});

export const notificationTemplateUpdate = notificationTemplate
  .partial()
  .refine((value) => Object.keys(value).length > 0, "No update supplied");

const reportQueryBase = z.object({
  ...dateRange,
  groupBy: z.enum(["daily", "weekly", "monthly"]).default("daily"),
});

export const reportQuery = reportQueryBase.refine(validDateRange, {
  message: "to must be on or after from",
  path: ["to"],
});

export const reportExport = reportQueryBase
  .extend({
    type: z.enum([
      "bookings",
      "trips",
      "revenue",
      "customers",
      "drivers",
      "vehicles",
      "cancellations",
      "payments",
      "support",
    ]),
    format: z.enum(["CSV"]).default("CSV"),
  })
  .refine(validDateRange, {
    message: "to must be on or after from",
    path: ["to"],
  });

export const supportList = pagination
  .extend({
    search: z.string().trim().max(120).optional(),
    status: z
      .enum([
        "OPEN",
        "IN_PROGRESS",
        "WAITING_FOR_CUSTOMER",
        "RESOLVED",
        "CLOSED",
        "ESCALATED",
      ])
      .optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    assignedAdminId: z.uuid().optional(),
    requesterType: z.enum(["USER", "DRIVER"]).optional(),
    ...dateRange,
  })
  .refine(validDateRange, {
    message: "to must be on or after from",
    path: ["to"],
  });

export const supportReply = z.object({
  message: z.string().trim().min(1).max(10_000),
  attachments: z
    .array(z.object({ key: z.string().max(500), name: z.string().max(255) }))
    .max(10)
    .optional(),
});

export const supportStatus = z.object({
  status: z.enum([
    "OPEN",
    "IN_PROGRESS",
    "WAITING_FOR_CUSTOMER",
    "RESOLVED",
    "CLOSED",
    "ESCALATED",
  ]),
  reason: z.string().trim().min(3).max(500),
  resolution: z.string().trim().max(2000).optional(),
});

export const supportPriority = z.object({
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  reason: z.string().trim().min(3).max(500),
});

export const supportAssignment = z.object({
  adminId: z.uuid(),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const supportCategory = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,50}$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
});

export const configUpdate = z.object({
  value: z.unknown(),
  reason: z.string().trim().min(5).max(500),
});

export const maintenanceMode = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(5).max(500),
});

const dashboardBase = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  timezone: z.string().optional(),
  serviceAreaId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  bookingType: z.enum(["IMMEDIATE", "SCHEDULED"]).optional(),
});

export const dashboardSummary = dashboardBase;

export const dashboardOverview = dashboardBase.extend({
  period: z.enum(["day", "week", "month", "year"]).optional(),
  groupBy: z.enum(["hour", "day", "week", "month", "year"]).default("day"),
});

export const dashboardTopVehicles = dashboardBase.extend({
  limit: z.coerce.number().min(1).max(50).default(5),
  metric: z
    .enum(["bookings", "revenue", "completedTrips", "utilization", "rating"])
    .default("bookings"),
});

export const dashboardRecentBookings = dashboardBase.extend({
  limit: z.coerce.number().min(1).max(50).default(10),
  status: z
    .enum([
      "PENDING",
      "SCHEDULED",
      "DISPATCH_PENDING",
      "SEARCHING_DRIVER",
      "DRIVER_ASSIGNED",
      "DRIVER_ARRIVING",
      "DRIVER_ARRIVED",
      "TRIP_STARTED",
      "TRIP_COMPLETED",
      "CANCELLED",
      "NO_DRIVER_FOUND",
      "ATTENTION_REQUIRED",
    ])
    .optional(),
});

export const dashboardDriverPerformance = dashboardBase.extend({
  limit: z.coerce.number().min(1).max(100).default(10),
  sortBy: z
    .enum([
      "completedTrips",
      "earnings",
      "rating",
      "acceptanceRate",
      "completionRate",
      "onlineHours",
    ])
    .default("completedTrips"),
});

export const supportCreateTicket = z.object({
  userId: z.string().uuid(),
  categoryId: z.string().uuid(),
  title: z.string().min(5).max(120),
  description: z.string().min(10),
  priority: z
    .enum(["LOW", "MEDIUM", "HIGH", "URGENT"])
    .optional()
    .default("MEDIUM"),
});

export const supportUpdateTicket = z.object({
  title: z.string().min(5).max(120).optional(),
  description: z.string().min(10).optional(),
  categoryId: z.string().uuid().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});
