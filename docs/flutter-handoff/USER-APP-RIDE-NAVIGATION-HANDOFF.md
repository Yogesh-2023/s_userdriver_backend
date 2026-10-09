# User App — Ride Navigation (Ride Now / Schedule / Favorites / History) Handoff

Version: 1.0
Prepared: 2026-09-23
Scope: Customer Flutter app
Related: `docs/flutter-handoff/FLUTTER-TEAM-API-HANDOFF.md`, `docs/flutter-handoff/DRIVER-TRIP-HISTORY-HANDOFF.md`

> Status: all four bottom-navigation features map to existing, canonical `/api/v1/customer/*` endpoints.
> **Ride History (History tab) was enhanced backend-side**: `/api/v1/customer/trips` now returns a
> sanitized, paginated, filterable payload with status counts (see section 4). No endpoint paths changed,
> but the History tab should switch to the new filters/pagination.

---

## 1. Ready-to-Paste Prompt (send this to the Flutter team)

```text
Integrate the User App bottom navigation (Ride Now / Schedule / Favorites / History) with the backend.
Keep the existing nav/theme; only wire data + states.

Auth: signed fleet_session cookie (no Bearer). Base: {{BASE_URL}}/api/v1/customer.

1) RIDE NOW  -> existing ride booking flow (no new API):
   - GET  /home                      Home screen: nearby vehicles, categories, quick info
   - POST /fares/estimate            Body: { pickup:{address,latitude,longitude},
           drop:{address,latitude,longitude}, categoryId }  -> estimateFare/id/eta
   - POST /bookings                  Body: { pickup, drop, categoryId, fareEstimateId?,
           paymentMethod?, couponCode?, idempotencyKey? }   -> creates booking + auto dispatch
   - GET  /bookings/active           Current active ride (or null)
   - GET  /bookings/{bookingId}      Booking detail + status
   - POST /bookings/{bookingId}/cancel   Body: { reasonCode, reason? }
   - Live updates via socket (bookingId room) for DRIVER_ASSIGNED / ARRIVING / ARRIVED / TRIP_STARTED

2) SCHEDULE -> scheduled rides (all exist):
   - POST /bookings/scheduled        Body: bookingCreateScheduled fields + scheduledAt (ISO, >= now+15min)
   - GET  /scheduled-rides           NEW: e.g. ?status=UPCOMING&page=1&limit=20  ->
           { rides: [...], pagination: { page, limit, total, totalPages } }
           status values: UPCOMING(default=PENDING+SEARCHING_DRIVER), PENDING, SEARCHING_DRIVER,
           DRIVER_ASSIGNED, DRIVER_ARRIVING, DRIVER_ARRIVED, TRIP_STARTED, TRIP_COMPLETED,
           CANCELLED, NO_DRIVER_FOUND, PAYMENT_PENDING, PAYMENT_COMPLETED
   - GET  /scheduled-rides/{scheduleId}
   - PATCH /scheduled-rides/{scheduleId}  Body: { scheduledAt }     -> reschedule
   - DELETE /scheduled-rides/{scheduleId} Body: { reasonCode, reason? } -> cancel
   - Reminder push 30 min before ride (SCHEDULED_RIDE_REMINDER), dispatch auto-starts ~10 min before.

3) FAVORITES -> saved places (CustomerAddress), all exist:
   - GET    /addresses               List saved places
   - POST   /addresses               Body: { label: HOME|WORK|<custom>, addressLine, landmark?,
           city?, state?, postalCode?, latitude, longitude, placeId?, isDefault? }
   - GET    /addresses/{addressId}
   - PATCH  /addresses/{addressId}   Same body fields (partial ok)
   - DELETE /addresses/{addressId}   Soft delete
   - PATCH  /addresses/{addressId}/default
   - GET    /addresses/recent        Recently completed locations
   - Response items expose addressId/label/addressLine/lat/lng/isDefault.

4) HISTORY -> ride history (ENHANCED):
   - GET /trips?status=COMPLETED&page=1&limit=20&order=desc
   - status: ALL|ACCEPTED|ONGOING|COMPLETED|CANCELLED|REJECTED|NO_SHOW
   - dateFrom/dateTo (YYYY-MM-DD, inclusive), search (pickup/drop/booking id),
     vehicleCategoryId, page (1+), limit (1-100, default 20), order (asc|desc)
   - data = { trips:[{ id, bookingId, status, bookingStatus, pickup:{...}, drop:{...},
     vehicle:{...}, vehicleCategoryId, driver:{id,name,phone(masked),rating}, fare, distance,
     duration, acceptedAt, startedAt, completedAt, cancelledAt, cancellationReason }],
     pagination:{page,limit,total,totalPages}, counts:{all,accepted,ongoing,completed,cancelled,noShow} }
   - Trip status values are canonical: CREATED, DRIVER_ARRIVING, DRIVER_ARRIVED, STARTED,
     COMPLETED, CANCELLED. Tab badge counts come from `counts`.
   - REJECTED is always empty (rejected offers never create a trip) - show an empty state.

UI requirements:
- Keep current bottom nav; History tab gets pull-to-refresh + infinite scroll (totalPages),
  status tabs/pill filter, optional date-range filter. Ride cards show pickup/drop, category,
  vehicle number, driver name, fare, date.
- Favorites screen: list with HOME/WORK icons + add/edit/delete/set-default.
- Schedule tab: upcoming list; reschedule/cancel actions; empty state when none.
- Masked phone shown as-is (never unmask).

Integration checklist:
- [] Use singular /customer/* canonical paths
- [] 401 -> re-login; non-2xx uses { success, message, error: { code, details?, requestId } }
- [] GET needs no CSRF; POST/PATCH/DELETE are CSRF-protected (send fleet_session + csrf as required)
- [] Idempotency: pass idempotencyKey on POST /bookings and /bookings/scheduled
```

---

## 2. Feature-to-Endpoint Map (User App)

| Nav item  | Feature          | Backend endpoint(s)                                  | Status |
| --------- | ---------------- | ---------------------------------------------------- | ------ |
| Ride Now  | Book a ride      | `GET /home`, `POST /fares/estimate`, `POST /bookings` | EXISTING |
| Ride Now  | Manage active ride | `GET /bookings/active`, `POST /bookings/{id}/cancel`, socket room `booking:{id}` | EXISTING |
| Schedule  | Scheduled rides  | `POST /bookings/scheduled`, `GET|PATCH|DELETE /scheduled-rides(/…)` | EXISTING (list ENHANCED: filters + pagination) |
| Favorites | Saved places     | `GET|POST /addresses`, `GET|PATCH|DELETE /addresses/{id}`, `PATCH /addresses/{id}/default`, `GET /addresses/recent` | EXISTING |
| History   | Ride history     | `GET /trips`                                          | EXISTING (ENHANCED: pagination, filters, counts, sanitized) |

All customer endpoints are scoped to the authenticated customer via the session (`authSession.userId`);
no arbitrary `customerId` is accepted from the client.

---

## 3. API Contracts (summary)

### 3.1 Ride Now — create immediate booking

**URL:** `POST {{BASE_URL}}/api/v1/customer/bookings` (CSRF-protected)
**Auth:** fleet_session cookie

```json
{
  "pickup": { "address": "MG Road, Bengaluru", "latitude": 12.9716, "longitude": 77.5946 },
  "drop":   { "address": "Indiranagar, Bengaluru", "latitude": 12.9784, "longitude": 77.6408 },
  "categoryId": "uuid",
  "fareEstimateId": "uuid",
  "paymentMethod": "UPI",
  "idempotencyKey": "client-generated-uuid"
}
```
Creates the Booking (status `PENDING` → `SEARCHING_DRIVER`), prices fare, starts dispatch for a driver.

### 3.2 Schedule — create scheduled booking

**URL:** `POST {{BASE_URL}}/api/v1/customer/bookings/scheduled` (CSRF-protected)
Same body as immediate **plus** `scheduledAt` (ISO, at least 15 min in the future). A `ScheduledBooking`
row is created; BullMQ delayed jobs arm a 30-min reminder and a 10-min-early activation that starts
the same shared dispatch flow.

### 3.3 Favorites — saved places

**URL:** `POST /api/v1/customer/addresses` (CSRF-protected); list `GET /api/v1/customer/addresses`.
Body example:
```json
{
  "label": "HOME",
  "addressLine": "221B Baker Street, MG Road",
  "landmark": "Near Metro Station",
  "city": "Bengaluru",
  "state": "Karnataka",
  "postalCode": "560001",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "isDefault": true
}
```
Soft-delete on `DELETE`; deleting the default promotes the newest remaining address.

### 3.4 History — ride history

**URL:** `GET {{BASE_URL}}/api/v1/customer/trips?status=COMPLETED&page=1&limit=20`
Response shape: data = `{ trips, pagination, counts }` (full shape in the prompt above).

Sanitization note: the response intentionally excludes private fields (OTP hashes, etc.) —
the old raw `Trip` payload was sanitized as part of this enhancement.

---

## 4. Backend Changes In This Release

| Module | Change |
| ------ | ------ |
| `src/modules/customer/services/customer-trip-history.service.ts` | NEW — production-grade trip history (pagination, status/date/category/search filters, groupBy counts, sanitized serializer, strict `booking.customerId` scoping) |
| `src/modules/customer/customer.controller.ts` | `listTrips` now validates filters via `schemas.tripsList` + delegates to the new service; `listScheduledRides` now supports `status` filter + `page`/`limit` + rich detail (driver/vehicle up to DRIVER_ASSIGNED) + pagination |
| `src/modules/customer/customer.validation.ts` | Added `tripsList` and `scheduledRidesList` query schemas |
| `src/modules/admin/services/admin-booking.service.ts` | `listScheduled` now supports `customerId`/`driverId`/`vehicleId`/`search` filters + assigned driver/vehicle includes |
| `src/modules/admin/services/admin-customer.service.ts` | `getAddresses` now excludes soft-deleted addresses |
| Tests | Added customer trip-history spec (14) + admin scheduled-booking spec (8) + existing driver spec (23); all green |

## 5. Verification

- `npm run typecheck` — only the 5 pre-existing unrelated errors remain (driver-vehicle / admin-vehicle services)
- `npm run lint` — no new issues in changed modules
- `npm run build` — success (`tsup`)
- Unit tests: 3 suites / 48 tests passing