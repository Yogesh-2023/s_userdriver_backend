import { z } from "zod";

export const requestOtp = z.object({
  mobile: z
    .string()
    .regex(/^(?:\+91|91)?[6-9]\d{9}$/, "Invalid Indian mobile number"),
});

export const verifyOtp = z.object({
  mobile: z
    .string()
    .regex(/^(?:\+91|91)?[6-9]\d{9}$/, "Invalid Indian mobile number"),
  otp: z.string().length(4),
  deviceId: z.string().max(255).optional(),
});

const minimumDrivingAge = 18;

const personalFields = {
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email().optional().nullable(),
  dateOfBirth: z.coerce
    .date()
    .optional()
    .nullable()
    .refine((d) => {
      if (!d) return true;
      const ageDiffMs = Date.now() - d.getTime();
      const ageDate = new Date(ageDiffMs);
      return Math.abs(ageDate.getUTCFullYear() - 1970) >= minimumDrivingAge;
    }, `Driver must be at least ${minimumDrivingAge} years old`),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]),
  profileImageUrl: z.preprocess((val) => {
    if (Buffer.isBuffer(val)) return null;
    if (typeof val === "string" && val.trim() === "") return null;
    return val;
  }, z.string().optional().nullable()),
  currentNumber: z.string().trim().min(7).max(20).optional(),
  alternateNumber: z.string().trim().min(7).max(20).optional().nullable(),
};

const addressFields = {
  addressLine1: z.string().max(255),
  addressLine2: z.string().max(255).optional().nullable(),
  landmark: z.string().max(255).optional().nullable(),
  city: z.string().max(100),
  state: z.string().max(100),
  postalCode: z.string().max(20),
  country: z.string().max(100),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
};

const emptyToNull = (val: any) => {
  if (Buffer.isBuffer(val)) return null;
  if (typeof val === "string" && val.trim() === "") return null;
  return val;
};

const drivingFields = {
  drivingLicenseNumber: z.string().toUpperCase().min(4).max(50),
  drivingLicenseIssueDate: z.coerce
    .date()
    .refine((d) => d <= new Date(), "Issue date cannot be in the future"),
  drivingLicenseExpiryDate: z.coerce
    .date()
    .refine((d) => d > new Date(), "License is expired"),
  drivingExperienceYears: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(0).max(60).optional().nullable(),
  ),
};

// Optional driving fields for profile creation (license submitted separately)
const optionalDrivingFields = {
  drivingLicenseNumber: z.preprocess(
    emptyToNull,
    z.string().toUpperCase().min(4).max(50).optional().nullable(),
  ),
  drivingLicenseIssueDate: z.preprocess(
    emptyToNull,
    z.coerce
      .date()
      .refine((d) => d <= new Date(), "Issue date cannot be in the future")
      .optional()
      .nullable(),
  ),
  drivingLicenseExpiryDate: z.preprocess(
    emptyToNull,
    z.coerce
      .date()
      .refine((d) => d > new Date(), "License is expired")
      .optional()
      .nullable(),
  ),
  drivingExperienceYears: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(0).max(60).optional().nullable(),
  ),
};

const emergencyContactFields = {
  emergencyContactName: z.preprocess(
    emptyToNull,
    z.string().min(2).max(100).optional().nullable(),
  ),
  emergencyContactPhone: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number")
      .optional()
      .nullable(),
  ),
  emergencyContactRelation: z.preprocess(
    emptyToNull,
    z
      .enum(["PARENT", "SPOUSE", "SIBLING", "FRIEND", "RELATIVE", "OTHER"])
      .optional()
      .nullable(),
  ),
};

const preferenceFields = {
  preferredLanguage: z.string().max(10).optional().nullable(),
  navigationPreference: z
    .enum(["GOOGLE_MAPS", "APPLE_MAPS", "IN_APP"])
    .optional()
    .nullable(),
  serviceAreaId: z.string().uuid().optional().nullable(),
};

export const createProfile = z
  .object({
    ...personalFields,
    ...addressFields,
    ...optionalDrivingFields,
    ...emergencyContactFields,
    ...preferenceFields,
  })
  .refine((data) => {
    if (data.drivingLicenseIssueDate && data.drivingLicenseExpiryDate) {
      return data.drivingLicenseIssueDate < data.drivingLicenseExpiryDate;
    }
    return true;
  }, "Issue date must be before expiry date");

// Dedicated schema for driving license submission step
export const submitDrivingLicense = z
  .object({
    ...drivingFields,
  })
  .refine((data) => {
    return data.drivingLicenseIssueDate < data.drivingLicenseExpiryDate;
  }, "Issue date must be before expiry date");

export const updateProfile = z
  .object({
    ...personalFields,
    ...addressFields,
    ...drivingFields,
    ...emergencyContactFields,
    ...preferenceFields,
  })
  .partial()
  .refine((data) => {
    if (data.drivingLicenseIssueDate && data.drivingLicenseExpiryDate) {
      return data.drivingLicenseIssueDate < data.drivingLicenseExpiryDate;
    }
    return true;
  }, "Issue date must be before expiry date")
  .refine(
    (data) => Object.keys(data).length > 0,
    "No data provided for update",
  );

export const uploadImageUrl = z.object({
  fileName: z.preprocess((val) => {
    if (Buffer.isBuffer(val)) return "image.jpg";
    if (typeof val === "string" && val.trim() === "") return "image.jpg";
    return val;
  }, z.string().min(1).max(255)),
});
