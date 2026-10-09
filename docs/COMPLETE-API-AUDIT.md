# Complete API Audit

Audit date: 2026-09-20

Evidence: Fastify route registration, controllers, route guards, services, Zod validation, Prisma schema, Socket.IO handlers, admin frontend API constants/services, and the generated Postman collection. Values that cannot be proven without a running PostgreSQL/Redis-backed environment are marked `UNVERIFIED`.

## A. Project API Architecture Overview

- Backend: Fastify 5 modular monolith, TypeScript, Prisma, PostgreSQL, Redis, BullMQ, Socket.IO.
- Frontend: Next.js 16 admin application using Axios, React Query, and Socket.IO client.
- Canonical REST prefix: `/api/v1`; health and local media routes are unversioned.
- Default local URL: `http://localhost:5000`.
- Authentication: signed `fleet_session` HttpOnly cookie. This project does not use Bearer/JWT authorization.
- CSRF: authenticated state-changing requests send `x-csrf-token`; tokens are captured by Postman login/OTP scripts.
- Authorization: customer/driver role guards; admin principal plus permission checks; `SUPER_ADMIN` bypasses individual admin permissions.
- Responses: success envelope is `{ success, message, data, meta? }`. Errors are `{ success: false, message, error: { code, details?, requestId } }`.
- Uploads: Fastify multipart, maximum 30 files, 5 MiB per file, 100 fields, 150 parts. Four multipart requests are represented in Postman.
- Static/local media: `GET /uploads/*`, `PUT /images/*`, and `GET /images/*`. The raw image routes currently have no auth guard.
- Realtime: Socket.IO at `/socket.io`, polling/websocket transports, cookie-session authentication, Redis adapter.
- Integrations found: Razorpay, Google Maps, Firebase notifications, S3/presigned upload support, SMS webhook, email webhook.
- Database: 79 Prisma models and 28 enums. Major domains include users/profiles, sessions/RBAC, vehicles/documents, bookings/trips/dispatch, payments/wallets/refunds, notifications, safety/support, pricing, subscriptions, and audit/configuration.

## B. Complete API Summary

The importable collection contains 520 requests in 76 folders: 257 GET, 178 POST, 58 PATCH, and 27 DELETE. The backend also exposes compatibility aliases under both `/customer` and `/customers`, and both `/driver` and `/drivers`; the collection intentionally emphasizes canonical mobile prefixes rather than duplicating every alias.

| Area                            | Requests in collection | Status                    |
| ------------------------------- | ---------------------: | ------------------------- |
| Health/setup                    |                      2 | EXISTING                  |
| Customer (auth through account) |                    148 | EXISTING                  |
| Driver (auth through account)   |                    145 | EXISTING                  |
| Admin                           |                    224 | EXISTING / see gaps below |
| Webhooks                        |                      1 | EXISTING                  |

Every collection request includes the implemented HTTP method, exact path, headers, query/path variables where configured, and JSON/form-data body where configured. Request-level saved success responses are mostly `UNVERIFIED`: only two are present in the source generator. Runtime error examples are documented below rather than invented per endpoint.

## C. Authentication APIs

- Customer: OTP send/verify/resend, current session, sessions, session revoke, logout, logout-all, account deletion.
- Driver: OTP request/send/resend/verify, current principal, sessions, session revoke, logout, account deletion.
- Admin: login, current principal, logout/logout-all, forgot password, OTP verification, reset/change password, sessions, revoke session.
- Legacy generic auth/session routes also exist under `/api/v1/auth` and `/api/v1/sessions`.
- Public requests omit auth. Protected requests rely on the Postman cookie jar. Mutations include the relevant `{{customerCsrfToken}}`, `{{driverCsrfToken}}`, or `{{adminCsrfToken}}` header.

## D. User/Customer APIs

148 collection requests cover profile/onboarding, addresses, location/serviceability, vehicle categories, fare estimates, immediate/scheduled bookings, active ride lifecycle, trip tracking, cancellation, payments, wallet, coupons/offers, referrals, ratings, notifications, support, SOS/safety, settings, and account/privacy requests.

Canonical prefix: `/api/v1/customer`. Compatibility alias: `/api/v1/customers`.

## E. Driver APIs

145 canonical driver requests cover auth, profile, KYC, documents, vehicles, availability, location, dashboard, ride offers, pickup/arrival, trip OTP/lifecycle, history, earnings, wallet, bank/payout accounts, incentives, ratings, notifications, support, safety, and account controls.

Canonical prefix: `/api/v1/driver`. Compatibility alias: `/api/v1/drivers`. The generated endpoint-by-endpoint driver inventory is `docs/postman/driver-api-inventory.md`.

## F. Vehicle APIs

Vehicle APIs exist at generic `/api/v1/vehicles`, customer/driver category and vehicle paths, and admin vehicle/category management paths. Admin supports CRUD/status/verification/documents/compliance/trips. See section N for frontend method mismatches.

## G. Booking/Ride APIs

Customer, driver, generic, dispatch, trip, scheduled-booking, and admin booking/trip APIs are represented. Booking status is persisted through `Booking`, `BookingStatusHistory`, `ScheduledBooking`, `Trip`, `TripStatusHistory`, `DispatchCycle`, `DispatchOffer`, and `DriverAssignment` models.

## H. Payment APIs

Payment order/verification, booking payment, wallets, transactions, refunds, invoices, settlements, payout accounts, payouts, and Razorpay webhook handling exist. `POST /api/v1/webhooks/razorpay` uses raw body verification and is not cookie-authenticated.

## I. Notification APIs

Customer and driver inbox operations, device tokens, admin campaigns/templates/send/schedule/retry/cancel, and generic notification routes exist. Firebase delivery is environment-controlled and includes retry configuration.

## J. Admin APIs

224 requests cover auth, dashboard, staff/RBAC, customers, drivers/KYC, vehicles, compliance, bookings, scheduled rides, trips, fares, payments, coupons, incentives, dispatch, notifications, support, safety, reports, configuration, audit logs, and global search. Admin routes require an admin session and commonly an explicit permission; `SUPER_ADMIN` satisfies permission checks.

## K. Upload/Media APIs

- Multipart requests are included with exact generator field names; Postman reports four `formdata` requests.
- Fastify multipart limits: 5 MiB per file, 30 files, 100 fields, 150 total parts.
- Driver/customer profile, KYC/document, and vehicle-document flows also expose presigned/upload URL operations.
- `PUT /images/*` writes raw request bytes to `.uploads`; `GET /images/*` serves them. Security finding: the raw PUT route has no session/role guard.

## L. Other APIs

- `GET /health/live`: process liveness.
- `GET /health/ready`: PostgreSQL and Redis readiness.
- `/api/v1/locations/states`, `/:stateCode/cities`, `/pincodes/:pincode`: public location metadata.
- `/api/v1/pricing/estimate`, generic ratings/support/safety, audit-log, and compatibility controllers are registered.
- No Swagger/OpenAPI setup was found.

## M. WebSocket/Socket Events

Connection uses `{{SOCKET_URL}}`, path `/socket.io`, credentials enabled, and the signed session cookie. Server emits `socket:ready` and `state:sync`; failures emit `socket:error` and revoked sessions use `socket:session-revoked`.

Driver inbound events: `driver:online`, `driver:go-online`, `driver:offline`, `driver:go-offline`, location updates, `dispatch:accept`, `dispatch:reject`, `driver:arrived`, `trip:start`, `trip:complete`, and compatibility aliases `ACCEPT_TRIP`, `REJECT_TRIP`, `DRIVER_ARRIVED`, `START_TRIP`, `END_TRIP`, plus goods-booking events. Detailed payloads and emitted booking/trip events are in `docs/SOCKET-API-INTEGRATION-GUIDE.md` and `docs/MOBILE_SOCKET_INTEGRATION.md`.

## O. Postman Collection JSON

Import these files into Postman:

1. `docs/postman/Fleet-Management-All-APIs.postman_collection.json` (Collection v2.1, 520 requests)
2. `docs/postman/Fleet-Management-Local.postman_environment.json`
3. Optional: `docs/postman/Fleet-Management-Staging.postman_environment.json`

Use `{{BASE_URL}}` and `{{SOCKET_URL}}`. Local defaults are `http://localhost:5000` and `ws://localhost:5000`. Run customer OTP verification, driver OTP verification, or admin login first so Postman stores the signed cookie and captures the correct CSRF token.

Example global success envelope:

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {}
}
```

Example validation error (verified from global handler):

```json
{
  "success": false,
  "message": "Request validation failed",
  "error": {
    "code": "BAD_REQUEST",
    "details": {},
    "requestId": "request-id"
  }
}
```

Example unhandled error (verified from global handler):

```json
{
  "success": false,
  "message": "An unexpected error occurred",
  "error": {
    "code": "INTERNAL_ERROR",
    "requestId": "request-id"
  }
}
