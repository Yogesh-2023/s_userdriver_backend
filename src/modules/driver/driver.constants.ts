export const DRIVER_CACHE_KEYS = {
  OTP_COOLDOWN: (phone: string) => `driver:otp:cooldown:${phone}`,
  OTP_ATTEMPTS: (phone: string) => `driver:otp:attempts:${phone}`,
  SESSION: (sessionId: string) => `driver:session:${sessionId}`,
  LOCATION: (driverId: string) => `location:driver:${driverId}`,
  PRESENCE: (driverId: string) => `driver:presence:${driverId}`,
  AVAILABILITY: (driverId: string) => `availability:driver:${driverId}`,
  DISPATCH_OFFER: (offerId: string) => `dispatch:offer:${offerId}`,
  BOOKING_LOCK: (bookingId: string) => `lock:booking:accept:${bookingId}`,
};

export const DRIVER_LIMITS = {
  OTP_COOLDOWN_SECONDS: 60,
  OTP_EXPIRY_SECONDS: 300,
  MAX_OTP_ATTEMPTS: 5,
  LOCATION_STALE_MINUTES: 15,
  DISPATCH_OFFER_TTL_SECONDS: 30,
};

export type DriverActionContext = {
  driverId: string;
  userId: string;
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
  requestId: string;
};
