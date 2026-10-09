# Flutter Team API Handoff and Verification Guide

Version: 1.0  
Prepared: 2026-09-20  
Scope: Customer Flutter app and Driver Flutter app

## 1. Files to Share

Send these files to the Flutter team:

1. `Fleet-Management-Flutter-Mobile.postman_collection.json`
2. `Fleet-Management-Flutter-Local.postman_environment.json` for local testing
3. `Fleet-Management-Flutter-Staging.postman_environment.json` for staging testing
4. This guide

The Flutter collection contains 295 requests: 2 health checks, 148 Customer requests, and 145 Driver requests. Admin APIs are intentionally excluded.

## 2. Important Contract Rules

| Item            | Contract                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| REST base URL   | `{{BASE_URL}}`; local default `http://localhost:5000`                                                    |
| Socket URL      | `{{SOCKET_URL}}`; local default `ws://localhost:5000`                                                    |
| REST prefix     | `/api/v1`                                                                                                |
| Customer prefix | Canonical `/api/v1/customer`                                                                             |
| Driver prefix   | Canonical `/api/v1/driver`                                                                               |
| Authentication  | Signed `fleet_session` cookie                                                                            |
| Bearer token    | **Not used**; do not add `Authorization: Bearer ...`                                                     |
| CSRF            | Required on protected POST/PATCH/PUT/DELETE requests                                                     |
| JSON success    | `{ "success": true, "message": "...", "data": ... }`                                                     |
| JSON error      | `{ "success": false, "message": "...", "error": { "code": "...", "details": ..., "requestId": "..." } }` |
| Socket path     | `/socket.io`                                                                                             |
| Upload limits   | 5 MiB per file, maximum 30 files, 100 fields, 150 parts                                                  |

The backend also registers `/customers` and `/drivers` compatibility aliases. Flutter code should use the canonical singular prefixes above so one contract is maintained.

## 3. Postman Verification Before Flutter Integration

### Import

1. Import `Fleet-Management-Flutter-Mobile.postman_collection.json`.
2. Import the required environment JSON.
3. Select that environment.
4. Confirm `BASE_URL`, `SOCKET_URL`, `customerMobile`, `driverMobile`, and `otp`.
5. Do not manually add a Bearer token.

Postman must retain cookies between requests. OTP verification sets the signed session cookie. Collection scripts capture CSRF values into `customerCsrfToken` or `driverCsrfToken`.

### Customer smoke-test order

1. `00 - Setup & Health / Health Live`
2. `02 - Customer Authentication / Send OTP`
3. `02 - Customer Authentication / Verify OTP`
4. `02 - Customer Authentication / Get Current Session`
5. `03 - Customer Profile & Onboarding / Get Profile`
6. `06 - Customer Vehicle Categories / List Vehicle Categories`
7. `07 - Customer Fare Estimate / Estimate Fare`
8. `08 - Customer Immediate Booking / Create Booking`
9. Run active-booking, tracking, payment, cancellation, or rating requests according to the returned booking state.

### Driver smoke-test order

1. `30 - Driver Authentication / Request OTP`
2. `30 - Driver Authentication / Verify OTP`
3. `30 - Driver Authentication / Get Current Driver`
4. `31 - Driver Profile & Onboarding / Get Profile`
5. Complete profile, KYC, documents, and vehicle flows if `canGoOnline` is false.
6. `37 - Driver Availability / Go Online`
7. Verify location update and ride-offer endpoints.
8. Test accept, arrival, OTP/start, completion, earnings, and wallet only after a valid booking is assigned.

Do not run the entire collection blindly in one click. Booking, trip, payment, KYC, and payout requests depend on database state and IDs returned by previous calls.

## 4. Verification Result Sheet

The Flutter team should return this table for each tested flow:

| Field                   | Value                                              |
| ----------------------- | -------------------------------------------------- |
| App                     | Customer / Driver                                  |
| Environment             | Local / Staging                                    |
| Folder and request name | Example: `02 / Verify OTP`                         |
| Method and endpoint     | Example: `POST /api/v1/customer/auth/verify-otp`   |
| HTTP status             | Example: `200`                                     |
| Result                  | PASS / FAIL / BLOCKED                              |
| Response `requestId`    | Required for backend error investigation           |
| Actual response         | Redact cookie, OTP, phone, bank, and document data |
| Expected behavior       | Short description                                  |
| Flutter screen/function | Screen and Dart method name                        |
| Notes                   | Reproduction steps                                 |

### Definition of PASS

- Method, endpoint, headers, and body match the Postman request.
- Expected 2xx status is returned.
- `success` is `true` and required `data` fields are usable.
- Cookie remains available for the next request.
- Mutation sends the correct CSRF token.
- Flutter model parses nullable and optional fields safely.
- Loading, empty, retry, unauthorized, forbidden, validation, and server-error states are handled.

## 5. Flutter HTTP Client Requirements

Recommended packages: `dio`, `cookie_jar`, and `dio_cookie_manager`. Keep one cookie jar per signed-in account context. Never log `Set-Cookie`, the session cookie, OTP, CSRF token, bank details, KYC identifiers, or document URLs.

```dart
final dio = Dio(BaseOptions(
  baseUrl: apiBaseUrl,
  connectTimeout: const Duration(seconds: 20),
  receiveTimeout: const Duration(seconds: 30),
  headers: {'Content-Type': 'application/json'},
));

final cookieJar = CookieJar();
dio.interceptors.add(CookieManager(cookieJar));
```

Store the CSRF token returned by the verified login/session contract and add it only to state-changing protected requests:

```dart
final method = options.method.toUpperCase();
final mutating = {'POST', 'PUT', 'PATCH', 'DELETE'}.contains(method);

if (mutating && csrfToken != null) {
  options.headers['x-csrf-token'] = csrfToken;
}
```

Do not persist the raw session cookie in ordinary preferences. Use an application-private cookie store, clear it on logout, and separate Customer and Driver sessions when both apps are installed/tested.

## 6. Response Parsing

Use a generic envelope and allow `data` to be nullable:

```dart
class ApiEnvelope<T> {
  final bool success;
  final String message;
  final T? data;

  const ApiEnvelope({
    required this.success,
    required this.message,
    this.data,
  });
}
```

Do not assume every list is directly under `response.data`. The backend envelope places payload under JSON `data`, and paginated endpoints may also return `meta`.

Handle at least these statuses centrally:

| Status | Flutter behavior                                               |
| ------ | -------------------------------------------------------------- |
| 400    | Show field/general validation feedback; retain entered data    |
| 401    | Clear local auth state and return to login                     |
| 403    | Show permission/account-state message; do not retry repeatedly |
| 404    | Show not-found or refresh stale local state                    |
| 409    | Refresh current booking/payment state before retrying          |
| 429    | Respect rate limiting and use delayed retry                    |
| 500    | Show retry UI and record `requestId`                           |

Exact success payloads absent from saved backend examples are marked `UNVERIFIED` in the collection. Flutter models must be finalized from staging responses and backend DTO/validation definitions, not invented fields.

## 7. Multipart and File Uploads

- Use the exact form-data key shown in the Postman Body tab.
- Do not rename file fields in Flutter.
- Validate file size before upload; backend per-file limit is 5 MiB.
- Let Dio set the multipart boundary. Do not manually force a boundary string.
- Preserve MIME type and filename.
- Presigned/upload-URL flows must upload to the returned URL exactly as instructed, then submit the resulting file reference to the API.

```dart
final formData = FormData.fromMap({
  'fieldNameFromPostman': await MultipartFile.fromFile(
    file.path,
    filename: file.name,
  ),
});
```

## 8. Socket.IO Integration

Use `socket_io_client`. The socket must send the same signed session cookie used by REST. Connect only after OTP verification/session restoration succeeds.

Required connection behavior:

- URL: `SOCKET_URL`
- Path: `/socket.io`
- Transport: websocket or polling/websocket fallback
- Credentials/session cookie: required
- Listen for `socket:ready`, `state:sync`, `socket:error`, and `socket:session-revoked`
- On reconnect emit `state:sync:request` and wait for acknowledgement
- Critical mutations must use acknowledgement callbacks

Verified Customer outbound events:

- `state:sync:request`
- `booking:cancel`
- `booking:track`
- `booking:untrack`
- `sos:create`
- `chat:join`
- `chat:send`

Verified Driver outbound events:

- `state:sync:request`
- `driver:online`, `driver:offline`
- `driver:location:update`
- `driver:heartbeat`
- `dispatch:accept`, `dispatch:reject`
- `driver:heading-to-pickup`, `driver:arrived`
- `trip:start`, `trip:complete`
- `booking:cancel`
- `sos:create`
- `chat:join`, `chat:send`

Compatibility event aliases exist, but new Flutter code should use the lowercase names above.

Driver location updates are rate-limited by the backend. Send real GPS timestamps and avoid parallel location streams. The backend accepts a maximum configured rate of 10 location events per second; the app should normally send much less based on movement and active-trip state.

## 9. Customer Acceptance Checklist

- OTP request, resend, verification, session restoration, logout
- New-user and returning-user onboarding
- Profile image and preferences
- Address CRUD and default address
- Serviceability and fare estimate
- Immediate and scheduled booking
- Active booking state restoration after app restart
- Driver tracking and pickup ETA
- Cancellation reasons and cancellation result
- Payment order, verification, wallet, and payment status
- Coupon, referral, rating, notification, and support flows
- SOS, emergency contacts, trip sharing, and privacy/account requests
- Socket disconnect/reconnect and state synchronization

## 10. Driver Acceptance Checklist

- OTP request, resend, verification, session restoration, logout
- Profile completion and onboarding state
- KYC draft/submit/reupload/status
- Driver and vehicle document uploads
- Vehicle registration/selection/verification state
- Online, offline, pause, and resume eligibility
- Foreground/background location updates and heartbeat
- Ride offer accept/reject race handling
- Pickup navigation, arrival, OTP verification, and trip start
- Stops, trip completion, cash confirmation, and extra charges
- Earnings, wallet, withdrawal, bank account, payout, and incentives
- Ratings, notifications, support, incident reporting, and SOS
- Socket disconnect/reconnect and state synchronization

## 11. Known Verification Limits

- The collection is source-generated and valid Postman v2.1 JSON.
- Request methods, URLs, configured headers, bodies, and form-data fields come from the backend collection generator.
- Most APIs do not have saved real response examples. Those payloads are `UNVERIFIED` until executed against seeded local/staging data.
- Local live execution requires PostgreSQL and Redis. Readiness fails when either dependency is unavailable.
- Current backend-wide TypeScript check has unrelated existing errors in `src/jobs/workers.ts` at lines 151, 157, and 170.
- Never report a guessed response field as backend-confirmed. Attach the redacted actual response and `requestId` when raising a contract issue.

## 12. Bug Report Template

```text
Title: [Customer/Driver] [Endpoint] short issue
Environment: Local/Staging
App version/commit:
Device and OS:
Postman result: PASS/FAIL
Flutter result: PASS/FAIL
Method and URL:
Request headers: redact Cookie and CSRF values
Request body: redact sensitive values
HTTP status:
Response requestId:
Actual response:
Expected behavior:
Reproduction steps:
Screenshot/video/log:
```

An issue is a backend contract issue when the same valid request fails in Postman. It is likely a Flutter integration issue when Postman passes but the app sends a different URL, method, body, cookie, CSRF header, or parsing expectation.
