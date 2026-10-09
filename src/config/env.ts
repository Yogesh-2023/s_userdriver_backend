import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const loadDotEnv = () => {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (process.env[key] !== undefined) continue;

    process.env[key] = rawValue
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }
};

loadDotEnv();

const PRODUCTION_ADMIN_ORIGIN = "https://tuk-admin.technogigz.co.in";

const parseCorsOrigins = (origins: string) =>
  origins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    HOST: z.string().default("0.0.0.0"),
    API_PREFIX: z.string().startsWith("/").default("/api/v1"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    CORS_ORIGINS: z
      .string()
      .default("")
      .refine(
        (value) =>
          !value
            .split(",")
            .map((origin) => origin.trim())
            .includes("*"),
        {
          message:
            "CORS_ORIGINS must not include * when credentials are enabled",
        },
      ),
    COOKIE_NAME: z.string().default("fleet_session"),
    COOKIE_SECRET: z.string().min(32),
    COOKIE_DOMAIN: z.string().optional().or(z.literal("")),
    COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("strict"),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .transform((value) => value === "true"),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(3600).default(2_592_000),
    SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().min(900).default(604_800),
    SESSION_ROTATION_SECONDS: z.coerce.number().int().min(300).default(86_400),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
    OTP_REQUEST_WINDOW_SECONDS: z.coerce.number().int().min(30).default(60),
    OTP_FIXED_CODE: z.literal("1234").default("1234"),
    SMS_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
    SMS_WEBHOOK_TOKEN: z.string().optional(),
    EMAIL_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
    EMAIL_WEBHOOK_TOKEN: z.string().optional(),
    EMAIL_FROM: z.string().email().optional().or(z.literal("")),
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    AWS_REGION: z.string().default("ap-south-1"),
    AWS_S3_BUCKET: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    FIREBASE_NOTIFICATION_ENABLED: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .default(true),
    FIREBASE_NOTIFICATION_MAX_RETRIES: z.coerce
      .number()
      .int()
      .min(0)
      .default(3),
    FIREBASE_NOTIFICATION_RETRY_DELAY: z.coerce
      .number()
      .int()
      .min(1000)
      .default(5000),
    DISPATCH_BATCH_SIZE: z.coerce.number().int().positive().default(5),
    DISPATCH_ACCEPTANCE_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(20),
    DISPATCH_MAX_BATCHES: z.coerce.number().int().positive().default(3),
    BOOKING_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(8),
    DRIVER_LOCATION_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(15)
      .default(90),
    DRIVER_DISCONNECT_GRACE_SECONDS: z.coerce.number().int().min(5).default(30),
    ASSIGNED_DRIVER_DISCONNECT_GRACE_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .default(120),
    TRIP_TRACKING_STALE_SECONDS: z.coerce.number().int().min(30).default(90),
    PICKUP_RADIUS_METERS: z.coerce.number().int().min(25).default(200),
    TRIP_COMPLETION_RADIUS_METERS: z.coerce.number().int().min(50).default(500),
    SOCKET_LOCATION_RATE_LIMIT_PER_SECOND: z.coerce
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10),
    ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .max(30)
      .default(5),
    ADMIN_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    ADMIN_LOGIN_LOCK_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(900),
    CONFIG_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
    REPORT_EXPORT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(3600)
      .default(86_400),
  })
  .superRefine((value, context) => {
    const corsOrigins = parseCorsOrigins(value.CORS_ORIGINS);

    if (
      value.NODE_ENV === "production" &&
      (corsOrigins.length !== 1 || corsOrigins[0] !== PRODUCTION_ADMIN_ORIGIN)
    ) {
      context.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: `CORS_ORIGINS must be exactly ${PRODUCTION_ADMIN_ORIGIN} in production`,
      });
    }
  });

export const env = schema.parse(process.env);
