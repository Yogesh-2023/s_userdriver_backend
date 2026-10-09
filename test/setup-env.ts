process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fleet:fleet@localhost:5434/fleet_test?schema=public";
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
process.env.COOKIE_SECRET ??= "test-cookie-secret-with-at-least-32-characters";
process.env.CSRF_SECRET ??= "test-csrf-secret-with-at-least-32-characters";
process.env.COOKIE_SECURE = "false";
process.env.CORS_ORIGINS = "https://tuk-admin.technogigz.co.in";
process.env.OTP_FIXED_CODE = "1234";
process.env.ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE = "30";
process.env.ADMIN_LOGIN_MAX_ATTEMPTS = "20";
process.env.ADMIN_LOGIN_LOCK_SECONDS = "60";
