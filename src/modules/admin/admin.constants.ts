export const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

export const ADMIN_PERMISSIONS = [
  "dashboard.read",
  "customers.read",
  "customers.update",
  "customers.block",
  "customers.delete",
  "drivers.read",
  "drivers.update",
  "drivers.verify",
  "drivers.suspend",
  "drivers.assign_vehicle",
  "vehicles.read",
  "vehicles.create",
  "vehicles.update",
  "vehicles.verify",
  "vehicles.assign_driver",
  "vehicles.deactivate",
  "vehicles.delete",
  "bookings.read",
  "bookings.update",
  "bookings.assign_driver",
  "bookings.cancel",
  "trips.read",
  "trips.monitor",
  "trips.update",
  "trips.force_complete",
  "trips.cancel",
  "fares.read",
  "fares.create",
  "fares.update",
  "fares.activate",
  "notifications.read",
  "notifications.send",
  "notifications.schedule",
  "reports.read",
  "reports.export",
  "support.read",
  "support.reply",
  "support.assign",
  "support.close",
  "config.read",
  "config.update",
  "admins.read",
  "admins.create",
  "admins.update",
  "admins.disable",
  "admins.roles.manage",
  "admins.sessions.revoke",
  "customers.sessions.revoke",
  "drivers.sessions.revoke",
  "audit_logs.read",
  "wallets.adjust",
  "safety.manage",
  "payments.read",
  "payments.manage",
  "refunds.read",
  "refunds.manage",
  "marketing.read",
  "marketing.write",
  "referrals.read",
  "referrals.write",
  "coupons.read",
  "coupons.write",
  "coupons.delete",
  "subscriptions.read",
  "subscriptions.write",
  "subscriptions.delete",
  "subscriptions.create",
  "subscriptions.update",
  "dashboard.alerts.read",
  "dashboard.live_operations.read",
  "dashboard.revenue.read",
  "bookings.create",
  "bookings.delete",
  "customers.create",
  "customers.suspend",
  "drivers.create",
  "drivers.delete",
  "marketing.manage",
  "notifications.manage",
  "reports.manage",
] as const;

export const ADMIN_ROOM_PERMISSIONS = {
  "admin:dashboard": "dashboard.read",
  "admin:tracking": "trips.monitor",
  "admin:support": "support.read",
  "admin:safety": "safety.manage",
} as const;

export const REQUIRED_VEHICLE_DOCUMENTS = [
  "REGISTRATION_CERTIFICATE",
  "INSURANCE",
  "PERMIT",
  "POLLUTION_CERTIFICATE",
] as const;

export const ACTIVE_TRIP_STATUSES = [
  "CREATED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "STARTED",
] as const;

export const ACTIVE_BOOKING_STATUSES = [
  "PENDING",
  "SEARCHING_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
] as const;

export type AdminActionContext = {
  adminId: string;
  userId: string;
  role: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};
