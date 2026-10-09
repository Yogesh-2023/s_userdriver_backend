import { createHash } from "node:crypto";

export const SOCKET_EVENTS = {
  READY: "socket:ready",
  ERROR: "socket:error",
  SESSION_REVOKED: "socket:session-revoked",
  STATE_SYNC: "state:sync",
} as const;

export const REALTIME_TTL = {
  PRESENCE_SECONDS: 90,
  CONNECTION_SECONDS: 180,
  LOCATION_SECONDS: 300,
  OFFER_GRACE_SECONDS: 60,
  DISPATCH_SECONDS: 60 * 60,
  TRIP_SECONDS: 24 * 60 * 60,
  IDEMPOTENCY_SECONDS: 24 * 60 * 60,
  LOCK_MILLISECONDS: 10_000,
  LOCATION_SAMPLE_SECONDS: 15,
  ADMIN_LOCATION_THROTTLE_SECONDS: 3,
  DASHBOARD_CACHE_SECONDS: 60,
} as const;

export const redisKeys = {
  sessionConnections: (sessionId: string) =>
    `socket:session:${createHash("sha256").update(sessionId).digest("hex")}:connections`,
  sessionRoom: (sessionId: string) =>
    `socket-session:${createHash("sha256").update(sessionId).digest("hex")}`,
  profileConnections: (
    role: "customer" | "driver" | "admin",
    profileId: string,
  ) => `socket:${role}:${profileId}:connections`,
  profileSockets: (role: "customer" | "driver" | "admin", profileId: string) =>
    `socket:${role}:${profileId}:sockets`,
  eventSequence: (scope: "booking" | "trip", id: string) =>
    `socket:seq:${scope}:${id}`,
  driverPresence: (driverId: string) => `presence:driver:${driverId}`,
  driverAvailability: (driverId: string) => `availability:driver:${driverId}`,
  driverLocation: (driverId: string) => `location:driver:${driverId}`,
  driverLocationLastSeen: (driverId: string) =>
    `location:driver:${driverId}:last-seen`,
  driverLocationSequence: (driverId: string) =>
    `location:driver:${driverId}:sequence`,
  driverLocationSample: (driverId: string) =>
    `location:driver:${driverId}:last-sample`,
  categoryGeo: (categoryId: string) => `category:${categoryId}:drivers`,
  dispatchState: (bookingId: string) => `dispatch:booking:${bookingId}:state`,
  dispatchCycle: (bookingId: string) => `dispatch:booking:${bookingId}:cycle`,
  dispatchOfferedDrivers: (bookingId: string) =>
    `dispatch:booking:${bookingId}:offered-drivers`,
  dispatchOffer: (offerId: string) => `dispatch:offer:${offerId}`,
  driverOffers: (driverId: string) => `dispatch:driver:${driverId}:offers`,
  tripLive: (tripId: string) => `trip:${tripId}:live`,
  tripLastLocation: (tripId: string) => `trip:${tripId}:last-location`,
  bookingAcceptLock: (bookingId: string) => `lock:booking:${bookingId}:state`,
  bookingCancelLock: (bookingId: string) => `lock:booking:${bookingId}:state`,
  tripStartLock: (tripId: string) => `lock:trip:${tripId}:start`,
  tripCompleteLock: (tripId: string) => `lock:trip:${tripId}:complete`,
  rateLimit: (identity: string, event: string, bucket: number) =>
    `socket:rate:${identity}:${event}:${bucket}`,
  adminTrackingThrottle: (driverId: string) =>
    `socket:admin-tracking:${driverId}`,
  adminDashboardSummary: (hash: string) => `admin:dashboard:summary:${hash}`,
  adminDashboardBookingOverview: (hash: string) =>
    `admin:dashboard:booking-overview:${hash}`,
  adminDashboardBookingStatus: (hash: string) =>
    `admin:dashboard:booking-status:${hash}`,
  adminDashboardTopVehicles: (hash: string) =>
    `admin:dashboard:top-vehicles:${hash}`,
  adminDashboardRevenueOverview: (hash: string) =>
    `admin:dashboard:revenue-overview:${hash}`,
  adminDashboardDriverPerformance: (hash: string) =>
    `admin:dashboard:driver-performance:${hash}`,
  globalOnlineDrivers: "drivers:online:global",
  globalBusyDrivers: "drivers:busy:global",
} as const;

export const ACTIVE_BOOKING_STATUSES = [
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
] as const;

export const ACTIVE_TRIP_STATUSES = [
  "CREATED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "STARTED",
] as const;
