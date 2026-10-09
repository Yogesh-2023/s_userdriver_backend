# Driver App — Trip History API Handoff

Version: 1.1
Prepared: 2026-09-23
Scope: Driver Flutter app
Related: `docs/flutter-handoff/FLUTTER-TEAM-API-HANDOFF.md`, `docs/postman/driver-api-inventory.md`

> Backend status: EXISTING endpoint enhanced — filters, pagination, and status counts added.
> Endpoint paths are UNCHANGED, so existing trip-history screens keep working.

---

## 1. Ready-to-Paste Prompt (send this to the Flutter driver team)

```text
Integrate the enhanced Driver Trip History API into the driver Flutter app.
Endpoint (SINGULAR driver prefix — do not use the /drivers alias):
  GET {{BASE_URL}}/api/v1/driver/trip-history
  GET {{BASE_URL}}/api/v1/driver/trip-history/{tripId}

Auth: signed fleet_session cookie (no Bearer header).

1) Contract (all query params optional):
   - status: ALL | ACCEPTED | ONGOING | COMPLETED | CANCELLED | REJECTED | NO_SHOW
   - dateFrom, dateTo: YYYY-MM-DD, inclusive full-day ranges
   - search: customer name/phone, pickup/drop address, or trip/booking uuid
   - vehicleCategoryId: uuid of booking category
   - page (default 1, min 1), limit (default 20, max 100)
   - order: asc | desc (default desc = newest first); sort is always createdAt

2) Response envelope: { success, message, data }
   data = {
     trips: [{ id, bookingId, status, bookingStatus,
              pickup: {address,latitude,longitude}, drop: {...},
              vehicle: {id,category,vehicleNumber}, vehicleCategoryId,
              customer: {id,name,phone}, fare, distance, duration,
              acceptedAt, startedAt, completedAt, cancelledAt, cancellationReason }],
     pagination: { page, limit, total, totalPages },
     counts: { all, accepted, ongoing, completed, cancelled, noShow }
   }
   - status values are canonical DB values:
     CREATED, DRIVER_ARRIVING, DRIVER_ARRIVED, STARTED, COMPLETED, CANCELLED
   - fare is a number (use finalFare if present, else estimatedFare)
   - distance in meters, duration in seconds
   - customer.phone is MASKED by the backend for privacy (do not unmask)

3) Build these UI pieces:
   - Tab/dropdown status filter mapped exactly like this:
     ACCEPTED = CREATED  |  ONGOING = CREATED/DRIVER_ARRIVING/DRIVER_ARRIVED/STARTED
     COMPLETED | CANCELLED | NO_SHOW = CANCELLED with customer no-show
     REJECTED always returns an empty list (rejected offers never become trips).
   - Pull-to-refresh + infinite scroll using page/limit; totalPages stops paging.
   - Tab badge counts from the counts object (not from per-tab requests).
   - Date range filter (send dateFrom/dateTo) and a search field.

4) Error handling: non-2xx -> { success:false, message, error:{code,details,requestId} }.
   Invalid status/date/limit returns 400 with message. 401 = session expired (re-login).

5) Keep GET /driver/trip-history/{tripId} for the detail screen (unchanged shape).
```

---

## 2. API Contract Details

**URL:** `GET {{BASE_URL}}/api/v1/driver/trip-history`

**Query parameters:**

| Param              | Type     | Default | Rules                                          |
| ------------------ | -------- | ------- | ---------------------------------------------- |
| `status`           | string   | `ALL`   | enum above; invalid value → 400                |
| `dateFrom`         | `YYYY-MM-DD` | –   | inclusive start of day                         |
| `dateTo`           | `YYYY-MM-DD` | –   | inclusive end of day                           |
| `search`           | string   | –       | max 100 chars; name/phone/address/id matches   |
| `vehicleCategoryId`| uuid     | –       |                                                |
| `page`             | int      | `1`     | min 1                                          |
| `limit`            | int      | `20`    | min 1, max 100                                 |
| `order`            | `asc`/`desc` | `desc` | newest first                                 |

**Semantic → canonical status mapping:**

| Filter value | Database filter |
| ------------ | --------------- |
| `ALL` | none |
| `ACCEPTED` | `TripStatus.CREATED` |
| `ONGOING` | `IN (CREATED, DRIVER_ARRIVING, DRIVER_ARRIVED, STARTED)` |
| `COMPLETED` | `TripStatus.COMPLETED` |
| `CANCELLED` | `TripStatus.CANCELLED` |
| `NO_SHOW` | `CANCELLED` + `booking.cancellation.reasonCode = CUSTOMER_NO_SHOW` |
| `REJECTED` | no Trip row exists → always empty list |

**Example request:**

```http
GET /api/v1/driver/trip-history?status=COMPLETED&dateFrom=2026-09-01&dateTo=2026-09-30&page=1&limit=20&order=desc
Cookie: fleet_session=...
```

**Example response:**

```json
{
  "success": true,
  "message": "Trip history retrieved",
  "data": {
    "trips": [
      {
        "id": "trip-id",
        "bookingId": "booking-id",
        "status": "COMPLETED",
        "bookingStatus": "COMPLETED",
        "pickup": { "address": "MG Road, Bengaluru", "latitude": 12.9716, "longitude": 77.5946 },
        "drop": { "address": "Indiranagar, Bengaluru", "latitude": 12.9784, "longitude": 77.6408 },
        "vehicle": { "id": "vehicle-id", "category": "Sedan", "vehicleNumber": "KA01AB1234" },
        "vehicleCategoryId": "cat-sedan",
        "customer": { "id": "customer-id", "name": "Rahul Sharma", "phone": "+9*********10" },
        "fare": 456.75,
        "distance": 12400,
        "duration": 2100,
        "acceptedAt": "2026-09-21T10:00:00.000Z",
        "startedAt": "2026-09-21T10:05:00.000Z",
        "completedAt": "2026-09-21T10:40:00.000Z",
        "cancelledAt": null,
        "cancellationReason": null
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 },
    "counts": { "all": 57, "accepted": 3, "ongoing": 2, "completed": 40, "cancelled": 12, "noShow": 1 }
  }
}
```

**Error example (400):**

```json
{
  "success": false,
  "message": "Validation failed",
  "error": { "code": "VALIDATION_ERROR", "details": { "status": "Invalid enum value..." }, "requestId": "req-id" }
}
```

**Detail endpoint:** `GET /api/v1/driver/trip-history/{tripId}` (unchanged).

---

## 3. Integration Checklist

- [ ] Use singular `/driver/trip-history` (canonical) — not `/drivers/...`
- [ ] Send `fleet_session` cookie; no `Authorization` header
- [ ] No CSRF header needed for GET requests
- [ ] Map filter tabs exactly as the table in section 2
- [ ] Infinite scroll via `page`/`limit`; stop when `page >= totalPages`
- [ ] Badge counts from `counts` object; only fetch once per page/screen
- [ ] `NO_SHOW` uses the same tab badge but filtered list; `REJECTED` tab always empty — render "No rejected rides" state
- [ ] Show fare as plain number; distance meters → km for display; duration seconds → minutes
- [ ] Do NOT unmask or display masked phone beyond what backend sends; real phone available via active-ride socket handoff (not history)
- [ ] Detail screen keeps using `trip-history/{tripId}`

---

## 4. Notes / Edge Cases

- `counts` ignores the `status` filter (tab badges reflect the whole history) but still honors `dateFrom`/`dateTo`/`search`/`vehicleCategoryId`.
- Newest-first is the default; `order=asc` goes oldest-first within the same `sort` (createdAt).
- Date boundaries are full-day inclusive in UTC.
- There is no trip-level record for rejected dispatch offers, so `status=REJECTED` is a documented empty result — do not send a separate endpoint for it.