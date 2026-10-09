export const CUSTOMER_CACHE_KEYS = {
  OTP_COOLDOWN: (phone: string) => `customer:otp:cooldown:${phone}`,
  OTP_ATTEMPTS: (phone: string) => `customer:otp:attempts:${phone}`,
  SESSION: (sessionId: string) => `customer:session:${sessionId}`,
  SERVICE_AREAS: "customer:service-areas:active",
  DRIVER_LOCATION: (driverId: string) => `location:driver:${driverId}`,
};

export const CUSTOMER_LIMITS = {
  OTP_COOLDOWN_SECONDS: 60,
  OTP_EXPIRY_SECONDS: 600,
  MAX_OTP_ATTEMPTS: 5,
  MAX_RECENT_ADDRESSES: 5,
  FARE_ESTIMATE_EXPIRY_MINUTES: 10,
};

export type CustomerActionContext = {
  customerId: string;
  userId: string;
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
  requestId: string;
};
