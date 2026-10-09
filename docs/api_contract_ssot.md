# REST API Contract & State Machine Specification (SSOT)
**Project**: Sawariya Taxi Booking Backend
**Version**: 1.0 (Targeting `/api/v1/*`)

## 1. Existing API Audit & Versioning Strategy
The backend currently exposes modular monolith routes registered in `app.ts`. All endpoints are prefixed with `/api/v1` ensuring an explicit, backward-compatible versioning strategy.

**Audit Findings:**
- Existing endpoints conform to RESTful practices.
- Request validation is strictly enforced using `Zod`.
- Authentication is handled via signed HTTP-only cookies (`fleet_session`).
- RBAC is enforced via centralized `requireSession` and `requireRoles` middlewares.

**Versioning Strategy**:
- **Non-breaking changes** (e.g., adding a new optional field) will be added to `v1`.
- **Breaking changes** (e.g., changing response structure, removing fields) will require spinning up a `/api/v2/` namespace.
- **Deprecation Policy**: 3 months of sunset period before removal.

---

## 2. Global Standards

### 2.1 Standard Success Response
All `2xx` responses must follow this shape. Unnecessary nesting is avoided.
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  },
  "requestId": "req-1234-uuid"
}
```

### 2.2 Standard Error Response & Error Code Catalog
Internal exceptions, SQL errors, or stack traces will **never** be exposed in production.
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid pickup latitude",
    "details": [
      { "field": "pickupLatitude", "message": "Must be between -90 and 90" }
    ]
  },
  "requestId": "req-1234-uuid"
}
```

**Common Error Codes:**
- `VALIDATION_ERROR` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `RESOURCE_NOT_FOUND` (404)
- `INVALID_STATE_TRANSITION` (409)
- `RATE_LIMIT_EXCEEDED` (429)
- `INTERNAL_SERVER_ERROR` (500)

### 2.3 Pagination & Filtering Standard
- **Pagination**: Keyset/cursor-based for high-volume logs (`?cursor=uuid&limit=20`), and offset-based for admin grids (`?page=1&limit=50`).
- **Filtering**: Query parameters (e.g., `?status=COMPLETED&from=2026-08-01`).

---

## 3. Role & Permission Matrix

| API | Customer | Driver | Admin | Explicit Permission |
|---|---|---|---|---|
| `POST /bookings` | Yes | No | No | `booking:create` (Implicit for Customer) |
| `GET /bookings/:id` | Own only | Assigned only | Yes | `booking:read` |
| `POST /trips/:id/start` | No | Assigned only | No | `trip:start` (Implicit for Driver) |
| `PATCH /admin/fares/:id` | No | No | Yes | `fares.update` |
| `POST /admin/refunds/:id/process`| No | No | Yes | `refunds.manage` |

---

## 4. Booking & Trip State Machines

The system actively decouples **Booking** (the commercial request) from **Trip** (the physical journey). 

### 4.1 Booking State Machine
**States**: `PENDING`, `SEARCHING_DRIVER`, `DRIVER_ASSIGNED`, `TRIP_STARTED`, `TRIP_COMPLETED`, `CANCELLED`, `NO_DRIVER_FOUND`

**Allowed Transitions:**
- `PENDING` → `SEARCHING_DRIVER` (Trigger: Payment hold / Immediate request)
- `SEARCHING_DRIVER` → `DRIVER_ASSIGNED` (Trigger: Driver accepts dispatch)
- `DRIVER_ASSIGNED` → `TRIP_STARTED` (Trigger: Driver submits OTP)
- `TRIP_STARTED` → `TRIP_COMPLETED` (Trigger: Driver completes trip)
- `*` → `CANCELLED` (Trigger: Customer/Driver cancels before Trip start)

> [!CAUTION]
> **Forbidden Transitions (409 Conflict):**
> - `TRIP_COMPLETED` → `CANCELLED` (Cannot cancel a finished ride)
> - `CANCELLED` → `DRIVER_ASSIGNED` (Dead bookings cannot be revived)

### 4.2 Trip State Machine
**States**: `CREATED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `STARTED`, `COMPLETED`, `CANCELLED`

**Allowed Transitions:**
- `CREATED` → `DRIVER_ARRIVING` (Trigger: Driver assigned)
- `DRIVER_ARRIVING` → `DRIVER_ARRIVED` (Trigger: Geospatial proximity / Driver manual update)
- `DRIVER_ARRIVED` → `STARTED` (Trigger: OTP Verified by Driver)
- `STARTED` → `COMPLETED` (Trigger: Drop-off reached)

---

## 5. API Contracts

### 5.1 Customer APIs (`/api/v1/customer/*`)
- `POST /auth/login`: Issue OTP.
- `POST /auth/verify`: Verify OTP, Set `fleet_session` cookie.
- `POST /bookings`: Create a ride.
  - **Payload**: `pickupLocation`, `dropLocation`, `vehicleCategoryId`, `tripType` (optional, `ONE_WAY`|`RETURN`), `returnDateTime` (optional, required if `tripType=RETURN`)
  - **Idempotency**: Handled via `Idempotency-Key` header.
- `GET /bookings`: Fetch history (Cursor pagination).
- `GET /bookings/:id/estimate`: Pre-flight fare calculation (Returns static breakdown).

### 5.2 Driver APIs (`/api/v1/driver/*`)
- `PATCH /status`: Update `ONLINE`/`OFFLINE` availability.
- `POST /dispatch/:id/accept`: Accept a broadcasted booking.
- `POST /trips/:id/arrive`: Mark as `DRIVER_ARRIVED`.
- `POST /trips/:id/start`: Start trip (Requires `otp` payload).
- `POST /trips/:id/complete`: End trip. Triggers final fare calculation and creates `Invoice`/`Payment`.

### 5.3 Admin APIs (`/api/v1/admin/*`)
- `GET /customers` | `GET /drivers` | `GET /vehicles`: Admin listings.
- `PATCH /fares/:id`: Updates Pricing Rules (Requires `fares.update`). Note: Creates a new rule version, preserves old snapshots.
- `POST /refunds/:id/process`: Refund payment (Requires `refunds.manage`).
- `GET /audit-logs`: View immutable system event logs.

### 5.4 Race Conditions & Concurrency
- **Double Dispatch Accept**: Handled via Optimistic Locking (`version` column) on `Booking`. If Driver A and Driver B accept simultaneously, the second transaction fails with `409 Conflict`.
- **Idempotency**: All `POST` (create) and `PATCH` endpoints for payments/refunds mandate an `Idempotency-Key` header mapped to `providerPaymentId`.

---

## 6. Final Acceptance Checklist

- [x] Standard Error Response & Error Code Catalog defined.
- [x] Booking vs Trip state responsibilities explicitly separated.
- [x] Valid and Forbidden transitions explicitly mapped.
- [x] Idempotency & Concurrency strategies defined.
- [x] Role/Permission matrix enforced.
- [x] Standard HTTP Status Codes mapped.
- [x] SSOT structure ready for Swagger/Postman generation.
