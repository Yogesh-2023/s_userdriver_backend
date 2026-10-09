# Flutter handoff — Active booking, live ride and scheduled ride

Prepared: 28 September 2026. Source: backend commit `3046ac3`.
Audience: Customer Flutter app and Driver Flutter app.
Verification: checked against backend source; examples below are illustrative, not captured production responses. Confirm the deployed environment runs this revision before integrating.

## 1. Read this first: implemented contract versus requested specification

The attached Active Ride specification describes a target API. The last backend change fixed compilation errors; it did **not** implement that entire specification. Use the existing routes below for integration today.

| Topic | Current backend |
|---|---|
| Customer active booking | `GET /api/v1/customer/bookings/active` |
| Driver active booking | `GET /api/v1/driver/bookings/active` |
| Proposed `/rides/active`, `/driver/rides/active` | Not registered in the checked revision |
| Authentication | Signed session cookie; Bearer token alone does not authenticate these routes |
| Payload | `response.data.data` is the booking/offer, not `response.data.data.ride` |
| Customer empty state | HTTP 404 with message `No active booking session found` |
| Driver empty state | HTTP 200 with `data: null`, when no assigned booking or pending offer exists |
| Driver pending offer | Same endpoint can return a dispatch offer with `status: "OFFERED"` |
| Active statuses | Booking enum uses `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `TRIP_STARTED` |
| Additional returned states | Customer includes `PENDING`, `SEARCHING_DRIVER`, `PAYMENT_PENDING`; driver includes `PAYMENT_PENDING` |
| Scheduled rides | Active lookup does not exclude future scheduled bookings by time |
| Location | Separate customer live-location endpoint; not a normalized `location` field on the active booking |

Do not assume the proposed normalized API or admin Active Rides feature is available based on this document. This handoff documents existing mobile APIs and their limitations.

## 2. Base URL and authentication

Use the environment's existing backend host. Paths in this guide assume the default API prefix `/api/v1`.

```http
GET /api/v1/customer/bookings/active
Accept: application/json
Cookie: fleet_session=<signed value received at login>
```

For the driver app, replace `customer` with `driver`.

Reuse the app's existing Dio client and persistent cookie manager. Preserve `Set-Cookie` from OTP verification **and subsequent responses**: the backend can rotate the session on GET requests. The cookie name is configurable; `fleet_session` is the default. Do not extract an unsigned session ID, hardcode cookies, or log them.

Customer routes require the `CUSTOMER` role; driver routes require `DRIVER`. The backend resolves the profile from the authenticated session. Do not send another user/driver ID to active lookup. The checked mobile route guards do not enforce a CSRF header, even though some old documentation mentions one.

Standard success envelope:

```json
{"success":true,"message":"Active booking retrieved","data":{}}
```

Standard error envelope:

```json
{
  "success": false,
  "message": "Authentication required",
  "error": {"code":"UNAUTHORIZED","requestId":"request-id"}
}
```

| HTTP status | Flutter handling |
|---|---|
| 400 | Show validation message; do not retry unchanged input |
| 401 | Stop polling and use existing sign-in/session recovery flow |
| 403 | Show access/role error; do not treat as no active ride |
| 404 | Only the exact customer empty-state response below means no active booking |
| 409 | State changed or action unavailable: refetch before offering another action |
| 429 | Back off; respect `Retry-After` when present |
| 500/503 or network failure | Keep last known state marked as offline/stale; offer retry |

## 3. Customer active booking

```http
GET /api/v1/customer/bookings/active
```

No query parameters. Returns the most recently **created** matching booking owned by the customer. Included statuses: `PENDING`, `SEARCHING_DRIVER`, `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `TRIP_STARTED`, `PAYMENT_PENDING`.

Illustrative field subset (additional backend fields are returned):

```json
{
  "success": true,
  "message": "Active booking retrieved",
  "data": {
    "id": "booking-uuid",
    "status": "TRIP_STARTED",
    "type": "IMMEDIATE",
    "scheduledAt": null,
    "pickupAddress": "Pickup address",
    "pickupLatitude": "28.1230000",
    "pickupLongitude": "77.4560000",
    "dropAddress": "Drop address",
    "dropLatitude": "28.2230000",
    "dropLongitude": "77.5560000",
    "estimatedFare": "150.00",
    "finalFare": null,
    "currency": "INR",
    "assignedDriver": {
      "id": "driver-profile-uuid",
      "profileImageUrl": null,
      "averageRating": "4.80",
      "user": {"displayName":"Driver name","phone":"example-phone"}
    },
    "assignedVehicle": {
      "id": "vehicle-uuid",
      "make": "Make",
      "model": "Model",
      "registrationNo": "UP00XX0000",
      "color": "Black",
      "category": {"id":"category-uuid","name":"Auto","iconUrl":null,"imageUrl":null}
    },
    "trip": {"id":"trip-uuid","status":"STARTED","startedAt":"2026-09-28T10:00:00.000Z"},
    "payments": [{"method":"CASH","status":"PENDING"}],
    "createdAt": "2026-09-28T09:45:00.000Z",
    "hasOngoingTrip": true,
    "rideStartOtp": "1234"
  }
}
```

The customer service also returns `booking` as a nested copy of the booking and OTP aliases `otp`/`pickupOtp`. Prefer top-level `data.id` and `data.status`; do not construct navigation state from `hasOngoingTrip` alone.

Nullable relations: `assignedDriver`, `assignedVehicle`, `trip`. Payments may be empty; the customer response includes at most the newest payment. Prisma decimals can serialize as strings: accept both JSON numbers and numeric strings. Do not convert missing fare/location into zero.

No active booking:

```http
HTTP/1.1 404 Not Found
```

```json
{
  "success": false,
  "message": "No active booking session found",
  "error": {"code":"NOT_FOUND","requestId":"request-id"}
}
```

Handle that combination only for this endpoint as the normal home state. Other 404 responses, such as `Customer profile not found`, are errors.

## 4. Driver active booking or pending offer

```http
GET /api/v1/driver/bookings/active
```

The backend first selects the most recently **updated** booking assigned to this driver, or whose trip belongs to this driver, with status `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `TRIP_STARTED`, or `PAYMENT_PENDING`.

Assigned-booking response uses flat booking fields like the customer example, with these differences:

```json
{
  "success": true,
  "message": "Active booking retrieved",
  "data": {
    "id": "booking-uuid",
    "status": "DRIVER_ASSIGNED",
    "type": "IMMEDIATE",
    "customer": {
      "id": "customer-profile-uuid",
      "displayName": "Passenger name",
      "maskedPhone": "91******10"
    },
    "pickupAddress": "Pickup address",
    "pickupLatitude": "28.1230000",
    "pickupLongitude": "77.4560000",
    "dropAddress": "Drop address",
    "dropLatitude": "28.2230000",
    "dropLongitude": "77.5560000",
    "estimatedFare": "150.00",
    "finalFare": null,
    "currency": "INR",
    "trip": null,
    "payments": []
  }
}
```

This is a field subset. The actual result includes `assignedVehicle`, `vehicleCategory`, timestamps and other booking relations. Driver `payments` are ordered newest first. Passenger identity is under `customer`, not `passenger`; the phone is masked.

If no assigned active booking exists, the endpoint looks for an unexpired offer:

```json
{
  "success": true,
  "message": "Active booking retrieved",
  "data": {
    "id": "offer-uuid",
    "bookingId": "booking-uuid",
    "driverId": "driver-profile-uuid",
    "status": "OFFERED",
    "expiresAt": "2026-09-28T10:01:00.000Z",
    "booking": {
      "pickupAddress": "Pickup address",
      "pickupLatitude": "28.1230000",
      "pickupLongitude": "77.4560000",
      "dropAddress": "Drop address",
      "dropLatitude": "28.2230000",
      "dropLongitude": "77.5560000",
      "estimatedFare": "150.00"
    }
  }
}
```

Here `data.id` is an **offer ID**; `data.bookingId` is the booking ID. Show the offer screen with expiry/accept/reject controls. Do not show trip controls until acceptance succeeds and state is refetched.

If neither exists:

```json
{"success":true,"message":"Active booking retrieved","data":null}
```

`GET /api/v1/driver/trips/active` is currently an alias for this same controller, including the offer fallback. It is not a separate trip-only contract.

## 5. Status and screen mapping

| Booking status | Suggested screen |
|---|---|
| `PENDING` | Booking pending, or scheduled booking summary |
| `SEARCHING_DRIVER` | Searching, or scheduled booking awaiting assignment |
| `DRIVER_ASSIGNED` | Assigned driver / pickup navigation |
| `DRIVER_ARRIVING` | Driver approaching pickup |
| `DRIVER_ARRIVED` | Pickup reached / OTP flow |
| `TRIP_STARTED` | Ongoing journey; remain here until backend changes state |
| `PAYMENT_PENDING` | Payment settlement; not an ongoing driving state |
| `TRIP_COMPLETED`, `PAYMENT_COMPLETED` | Completion/receipt |
| `CANCELLED`, `NO_DRIVER_FOUND` | Terminal state; dismiss active journey and refresh |

Trip status is a separate enum: `CREATED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `STARTED`, `COMPLETED`, `CANCELLED`. Do not compare `trip.status` with `TRIP_STARTED`.

On customer startup, `GET /api/v1/customer/trips/active` can additionally recover a trip in `CREATED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, or `STARTED`; it returns `data: null` when absent and includes its `booking`. This can help distinguish an actual trip from a newer future booking, but it does not recover every pre-trip booking. Do not infer a trip started merely because a trip object exists.

For scheduled bookings, display `type` and `scheduledAt` explicitly. Both active booking queries lack a time-window exclusion, so a future scheduled record may be returned. A customer with several matching bookings receives just one, not a guaranteed priority-ordered ongoing ride. The strict active-ride semantics in the original specification require backend work; Flutter cannot fully correct selection of a hidden booking.

## 6. Live driver location (customer)

```http
GET /api/v1/customer/bookings/{bookingId}/live-driver-location
```

Requires the customer's ownership. No assigned driver returns 409. Missing cached location returns 200:

```json
{
  "success": true,
  "message": "Driver live location retrieved",
  "data": {
    "latitude": null,
    "longitude": null,
    "heading": null,
    "etaMinutes": null,
    "distanceMeters": null,
    "stale": true
  }
}
```

When cached location exists, coordinates are populated, `stale` is false and `lastSeenAt` is taken from the cached timestamp, if present. ETA is a rough straight-line estimate to pickup using a fixed speed, not traffic-aware routing.

Only render a map marker if both coordinates parse and are within geographic bounds. Do not substitute `(0,0)` for null; valid zero coordinates must not automatically be rejected. Retain timestamps, show location age, and mark stale data explicitly. The current `stale: false` flag only indicates a cache value exists; it does not guarantee a recent timestamp.

## 7. Driver actions

All paths below start with `/api/v1/driver`. POST JSON using the existing authenticated client. Let the server validate transitions; on 409 refresh the booking.

| Action | Path | JSON body |
|---|---|---|
| Accept offer | `/bookings/{bookingId}/accept` | `{"offerId":"offer-uuid"}` |
| Reject offer | `/bookings/{bookingId}/reject` | `{"offerId":"offer-uuid","reasonCode":"UNAVAILABLE"}` |
| Navigate to pickup | `/bookings/{bookingId}/navigate` | `{}` |
| Report arrival | `/bookings/{bookingId}/arrived` | `{}` |
| Verify pickup OTP | `/bookings/{bookingId}/pickup-otp/verify` | `{"otp":"entered-otp"}` (4–8 digits) |
| Start | `/bookings/{bookingId}/start` | `{"otp":"entered-otp"}` or `{}` where backend already permits verified OTP |
| Complete | `/bookings/{bookingId}/complete` | `{}` |
| Release assigned booking | `/bookings/{bookingId}/cancel` | `{"reason":"Unable to continue"}` |

Use booking IDs in paths, not trip IDs or offer IDs. Refetch after success. Do not automatically retry a mutation after a timeout without checking resulting state first. Customer cancellation uses `POST /api/v1/customer/bookings/{bookingId}/cancel` with `{"reasonCode":"CHANGE_OF_PLAN","reason":"Optional details"}`.

The checked customer active response has a server-side fallback OTP value when a trip exists. Flutter must not hardcode an OTP, infer verification from that fallback, or bypass server-side OTP verification. This behavior needs backend review before treating the target API specification as complete.

## 8. Scheduled ride rescheduling — two existing contracts

Body for both contracts:

```json
{"scheduledAt":"2026-10-01T10:30:00.000Z"}
```

Generate this from the user's selected time using `selectedTime.toUtc().toIso8601String()`; do not send formatted local time strings.

| Endpoint | Current rules |
|---|---|
| `PATCH /api/v1/customer/bookings/{bookingId}/reschedule` | Customer-owned scheduled booking; status must be `PENDING`; current ride must be at least 15 minutes away; new time at least 15 minutes ahead |
| `PATCH /api/v1/bookings/{bookingId}/reschedule` (alias `/schedule`) | Session required, customer ownership checked; scheduled booking in `PENDING`, `SEARCHING_DRIVER`, or `DRIVER_ASSIGNED`; new time at least 30 minutes ahead |

Customer route returns `{"success":true,"message":"Rescheduled successfully","data":{"success":true}}` and updates both booking and scheduling records.

Generic route example:

```json
{
  "success": true,
  "message": "Ride scheduled time updated successfully",
  "data": {
    "rideId": "booking-uuid",
    "scheduledAt": "2026-10-01T10:30:00.000Z",
    "status": "SEARCHING_DRIVER",
    "reassignmentRequired": true
  }
}
```

**Current generic-route limitation:** source updates the scheduling record but does not update `Booking.scheduledAt`; its driver overlap simulation also retains the old top-level time. A successful response does not guarantee subsequent booking reads show the new time or reassignment was evaluated against it. Backend correction is needed before shipping this generic route for accepted/searching scheduled rides. Do not hide the mismatch with a client-only time override.

For the supported pending-booking flow, use the customer route and refetch after success. The two routes are not interchangeable.

## 9. Flutter/Dio adapter example

This uses the existing cookie-enabled `Dio`; it does not create another HTTP client. Configure that client with the backend origin as base URL. If its base already ends in `/api/v1`, adjust paths once to avoid duplicating the prefix.

```dart
import 'package:dio/dio.dart';

typedef Json = Map<String, dynamic>;

Json asJson(Object? value) {
  if (value is! Map) throw const FormatException('Expected JSON object');
  return Map<String, dynamic>.from(value);
}

double? nullableNumber(Object? value) => value == null
    ? null
    : value is num ? value.toDouble() : double.tryParse(value.toString());

DateTime? nullableDate(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toUtc() : null;

class ActiveBooking {
  final Json raw;
  ActiveBooking(this.raw) {
    if (raw['id'] is! String || raw['status'] is! String) {
      throw const FormatException('Missing booking id/status');
    }
  }
  String get id => raw['id'] as String;
  String get status => raw['status'] as String;
  bool get isScheduled => raw['type'] == 'SCHEDULED';
  DateTime? get scheduledAt => nullableDate(raw['scheduledAt']);
  double? get estimatedFare => nullableNumber(raw['estimatedFare']);
  double? get pickupLatitude => nullableNumber(raw['pickupLatitude']);
  double? get pickupLongitude => nullableNumber(raw['pickupLongitude']);
  // Add optional typed fields from the mapping table below.
}

class DriverActiveState {
  final ActiveBooking? booking;
  final Json? offer;
  const DriverActiveState({this.booking, this.offer});
  bool get isEmpty => booking == null && offer == null;
}

class ActiveRideApi {
  final Dio client;
  ActiveRideApi(this.client);

  bool _isCustomerEmpty(int? status, Object? body) {
    if (status != 404 || body is! Map) return false;
    final error = body['error'];
    return body['success'] == false &&
        body['message'] == 'No active booking session found' &&
        error is Map && error['code'] == 'NOT_FOUND';
  }

  Json _success(Response<dynamic> response) {
    final body = asJson(response.data);
    if (response.statusCode != 200 || body['success'] != true) {
      throw StateError('API error: ${body['message']}');
    }
    return body;
  }

  Future<ActiveBooking?> getCustomerActiveBooking() async {
    try {
      final response = await client.get('/api/v1/customer/bookings/active');
      // Also supports a shared client that accepts HTTP 404 in validateStatus.
      if (_isCustomerEmpty(response.statusCode, response.data)) return null;
      final body = _success(response);
      return ActiveBooking(asJson(body['data']));
    } on DioException catch (error) {
      if (_isCustomerEmpty(error.response?.statusCode, error.response?.data)) {
        return null;
      }
      rethrow; // Preserve auth, network and unexpected errors.
    }
  }

  Future<DriverActiveState> getDriverActiveState() async {
    final response = await client.get('/api/v1/driver/bookings/active');
    final data = _success(response)['data'];
    if (data == null) return const DriverActiveState();
    final object = asJson(data);
    if (object['status'] == 'OFFERED') {
      if (object['id'] is! String || object['bookingId'] is! String) {
        throw const FormatException('Missing offer/booking ID');
      }
      return DriverActiveState(offer: object);
    }
    return DriverActiveState(booking: ActiveBooking(object));
  }

  Future<Json> getCustomerDriverLocation(String bookingId) async {
    final response = await client.get(
      '/api/v1/customer/bookings/$bookingId/live-driver-location',
    );
    return asJson(_success(response)['data']);
  }
}
```

The sample intentionally represents `offer`, `booking`, and empty state separately. Integrate errors into the existing app error model. Unknown statuses should render a recoverable state and refetch, not become `STARTED` by default. This snippet was reviewed against backend fields; Dart/Flutter tooling was not available to compile it here.

Suggested app-side models (these names do **not** describe normalized server JSON):

| App model | Source fields |
|---|---|
| `ActiveRide` / `ActiveBooking` | Top-level booking `id`, `status`, `type`, `scheduledAt`, `createdAt`; `trip.startedAt` |
| `PickupLocation` | `pickupAddress`, `pickupLatitude`, `pickupLongitude` |
| `DropoffLocation` | `dropAddress`, `dropLatitude`, `dropLongitude` |
| `ActiveRideDriver` | Customer response `assignedDriver.id`, `.user.displayName`, `.user.phone`, `.profileImageUrl`, `.averageRating` |
| `ActiveRidePassenger` | Driver response `customer.id`, `.displayName`, `.maskedPhone`; no passenger rating supplied by this mapper |
| `ActiveRideVehicle` | `assignedVehicle.id`, `.model`, `.registrationNo`, `.color`; category varies by response, use `vehicleCategory.name` when needed |
| `ActiveRideFare` | `estimatedFare`, `finalFare`, `currency` |
| `ActiveRidePayment` | Newest `payments[0].method` / `.status`, or null when empty |
| `DriverLocation` | Separate location response `latitude`, `longitude`, `heading`, `lastSeenAt`, `stale` |
| `DispatchOffer` | Offer `id`, `bookingId`, `expiresAt`, `status`, nested pickup/drop/fare summary |

All absent relations/timestamps and nullable numeric values need nullable Dart fields. Do not synthesize ratings, phone numbers, locations, or payment status.

## 10. Refresh and sockets

1. After successful login, app launch, and foreground/resume: fetch current state.
2. Reuse the existing authenticated Socket.IO connection. On reconnect emit `state:sync:request` with `{}` and refetch REST state.
3. For customer booking tracking, the existing socket event is `booking:track` with `{"bookingId":"..."}`; handle its acknowledgement before relying on updates.
4. Treat events such as `driver:heading-to-pickup`, `driver:arrived`, `trip:started`, `trip:completed`, `payment:updated`, and `booking:rescheduled` as refresh triggers. Do not assume every event contains a complete booking.
5. If sockets are unavailable, use one foreground polling loop. A starting interval of 10–15 seconds is a client recommendation, not a backend guarantee; debounce event-triggered refreshes and back off on errors.
6. Await each request before starting another. Cancel timers/subscriptions on dispose, logout, or background; ignore late responses belonging to an old session/booking.
7. Refresh after every successful driver/customer action. Do not clear the ride on a transient network error. Stop active polling when the journey ends, while retaining any payment-settlement screen indicated by the backend.

See [mobile socket guide](../MOBILE_SOCKET_INTEGRATION.md) for the existing connection implementation. Where older handoffs conflict with the source-checked REST behavior above, use this document for these endpoints.

## 11. Integration acceptance checklist

- Customer: exact empty 404, searching, assigned, arriving, arrived, started, payment pending, completion and cancellation.
- Driver: `data: null`, offered/expired offer, accepted booking, all trip stages, payment pending.
- No premature trip UI for a future scheduled booking; verify the actual backend limitation when multiple bookings exist.
- App kill/relaunch, background/resume, socket reconnect and expired/rotated session cookies.
- Decimal numbers as both strings and numbers; absent driver/vehicle/trip; empty payments; unknown extra fields.
- Location missing, old timestamp, malformed/out-of-range coordinates, valid zero coordinates.
- Ownership: Customer A cannot read Customer B's booking/location; Driver A cannot read Driver B's assigned booking; role errors are not empty states.
- Reschedule pending booking through customer route; verify time is persisted after refetch. Keep generic assigned-ride rescheduling blocked until backend consistency is corrected.
- 401/403/409/429/500 and offline recovery; prevent duplicate mutation submissions.

## 12. Backend follow-up required for the original specification

The following are **not delivered by documentation**: unified `data.ride` payloads and proposed routes; customer `200 + ride:null`; strict scheduled-time/ongoing-ride selection; exclusion of payment-only states from driving state; normalized location and party models; generic reschedule persistence correction; OTP fallback review; and the requested admin integration/OpenAPI contract. Agree a backend API change before replacing the compatibility adapter with the proposed specification's parser.

Source references: `src/app.ts`, `src/common/auth.ts`, `src/common/response.ts`, customer/driver route and controller files, `customer-booking.service.ts`, `driver-booking-journey.service.ts`, `driver-dispatch.service.ts`, and `src/modules/bookings/service.ts`.
