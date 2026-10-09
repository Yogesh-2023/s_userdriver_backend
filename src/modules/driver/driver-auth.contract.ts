const firstTimeDriverResponseExample = {
  success: true,
  message: "OTP verified successfully",
  data: null,
};

const returningDriverResponseExample = {
  success: true,
  message: "Logged in successfully",
  data: {
    driverId: "a83b5cea-e762-4935-9c6f-ecacce562a2e",
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
    profile: {
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
    },
  },
};

export const driverVerifyOtpResponseExamples = {
  firstTimeDriver: firstTimeDriverResponseExample,
  returningDriver: returningDriverResponseExample,
};

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };

const driverLoginProfileSchema = {
  type: "object",
  additionalProperties: false,
  required: [
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
  ],
  properties: {
    fullName: nullableString,
    phoneNumber: { type: "string" },
    email: nullableString,
    profileImage: nullableString,
    gender: nullableString,
    dateOfBirth: {
      anyOf: [{ type: "string", format: "date" }, { type: "null" }],
    },
    preferredLanguage: nullableString,
    address: {
      type: "object",
      additionalProperties: false,
      required: [
        "addressLine1",
        "addressLine2",
        "city",
        "state",
        "postalCode",
        "country",
      ],
      properties: {
        addressLine1: nullableString,
        addressLine2: nullableString,
        city: nullableString,
        state: nullableString,
        postalCode: nullableString,
        country: nullableString,
      },
    },
    createdAt: { type: "string", format: "date" },
    updatedAt: { type: "string", format: "date" },
  },
};

const returningDriverDataSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "driverId",
    "isNewDriver",
    "isProfileCompleted",
    "kycStatus",
    "vehicleApproved",
    "documentsValid",
    "accountStatus",
    "availability",
    "canGoOnline",
    "hasActiveBooking",
    "activeBooking",
    "nextStep",
    "profile",
  ],
  properties: {
    driverId: { type: "string", format: "uuid" },
    isNewDriver: { type: "boolean" },
    isProfileCompleted: { type: "boolean" },
    kycStatus: { type: "string" },
    vehicleApproved: { type: "boolean" },
    documentsValid: { type: "boolean" },
    accountStatus: { type: "string" },
    availability: { type: "string" },
    canGoOnline: { type: "boolean" },
    hasActiveBooking: { type: "boolean" },
    activeBooking: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "status"],
          properties: {
            id: { type: "string", format: "uuid" },
            status: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    nextStep: { type: "string" },
    profile: {
      anyOf: [driverLoginProfileSchema, { type: "null" }],
    },
  },
};

export const driverVerifyOtpRouteSchema = {
  tags: ["Driver Authentication"],
  summary: "Verify driver OTP",
  description:
    "Creates the authenticated driver session. Returning drivers also receive a safe saved-profile projection; the first-time response remains unchanged.",
  response: {
    200: {
      description: "OTP verified and driver session created",
      type: "object",
      additionalProperties: false,
      required: ["success", "message", "data"],
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        data: {
          anyOf: [returningDriverDataSchema, { type: "null" }],
        },
      },
      examples: [
        firstTimeDriverResponseExample,
        returningDriverResponseExample,
      ],
    },
  },
};
