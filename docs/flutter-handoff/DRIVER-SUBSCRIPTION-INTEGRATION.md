# Driver subscription plans — Flutter integration handoff

Updated: 29 September 2026. Implements the subscription checkout completion following baseline `2433798`.
Audience: Driver Flutter team. Examples are illustrative; use actual IDs and the deployed backend host.

## 1. Available integration and business policy

The backend now supports **Plans → Plan Details → Purchase → Razorpay Checkout → Verified Payment → Active Subscription → Expiry → Manual Renewal**. Existing signed-cookie authentication and payment verification/webhook endpoints are reused. No Prisma schema migration is required.

| Capability | Method and endpoint (default prefix) |
|---|---|
| Plans | `GET /api/v1/driver/subscriptions/plans` |
| Plan details | `GET /api/v1/driver/subscriptions/plans/:id` |
| Active subscription | `GET /api/v1/driver/subscriptions/active` |
| Purchase / manual renewal | `POST /api/v1/driver/subscriptions/purchase` |
| Purchase history / pending recovery | `GET /api/v1/driver/subscriptions/history` |
| Own subscription details | `GET /api/v1/driver/subscriptions/:id` |
| Payment status / checkout recovery | `GET /api/v1/driver/subscriptions/:id/payment` |
| Verify captured payment | `POST /api/v1/payments/verify` (existing endpoint extended) |
| Gateway notification | `POST /api/v1/webhooks/razorpay` (existing, server-to-server) |
| Driver readiness | `GET /api/v1/driver/onboarding-status` |
| Account status | `GET /api/v1/driver/account/status` |

**Approved policy:** renewal is manual after expiry/trip exhaustion; refunds are handled by support. There is no automatic recurring charge, mid-term upgrade, self-service paid cancellation/refund, or auto-renew toggle. An unpaid checkout can be dismissed and resumed with its existing order; dismissing it is not a server cancellation. To change a pending plan or resolve a historical simulated purchase, contact support.

There is deliberately no public “activate” endpoint: activation is performed atomically with server-confirmed payment capture. Zero-price plans activate immediately without gateway checkout. `features`, `duration`, subscription `isActive` and `expiresAt` are not invented wire fields; see the field dictionary.

### Changes Flutter must adopt

- Purchase now requires `X-Idempotency-Key`; generates a real Razorpay order instead of a simulated payment.
- Successful purchase means “purchase retrieved”; inspect `subscription.status`, `payment.status` and nullable `checkout` before navigation.
- New pending purchases have null start/expiry dates. Duration begins at successful activation, using the duration snapshot taken at purchase.
- Onboarding readiness and go-online now require an unexpired, non-exhausted subscription. Already-running rides can still complete.
- Legacy `SIMULATED` payments are not converted to paid subscriptions or sent through real verification. History exposes them for support; a new real purchase is allowed when no valid active or real pending purchase blocks it.

## 2. Environment, authentication and shared response contract

Default local base URL: `http://localhost:5000/api/v1`. For a physical phone/emulator, use the existing reachable development host. The prefix is configurable through `API_PREFIX`; examples assume `/api/v1`.

`/api/v1/drivers/...` is an existing alias of `/api/v1/driver/...`. Use the singular form consistently.

### Exact authentication mechanism

Protected APIs use **a signed session cookie plus the `DRIVER` role**, enforced by `requireSession` and `requireRoles("DRIVER")`. They do not authenticate with an `Authorization: Bearer ...` token alone.

1. Request and verify the driver OTP (section 3).
2. Persist the verification response's `Set-Cookie` in the app's existing cookie jar.
3. Send the cookie on protected requests. Default cookie name: `fleet_session`; configurable through `COOKIE_NAME`.
4. Persist subsequent `Set-Cookie` headers too: authenticated GET/HEAD requests can rotate the session.

The server validates the cookie signature, session token hash, revocation, absolute expiry and idle expiry against session storage. The cookie is HTTP-only, signed, path `/`; secure, SameSite and domain settings depend on deployment. Preserve the value exactly; do not construct it from a session ID. A new driver login revokes previous sessions for that user.

No CSRF header is enforced by the current driver route guards, including purchase. `X-Idempotency-Key` is **required** by subscription purchase (1–100 characters after trimming). Persist one key for each purchase attempt and reuse it for retries.

| Header | Requirement |
|---|---|
| `Accept: application/json` | Recommended for every request |
| `Content-Type: application/json` | Required for the JSON POST examples |
| `Cookie: fleet_session=<signed cookie>` | Required on protected requests; let the cookie manager set it |
| `X-Request-Id` | Optional correlation value; error responses include `error.requestId` |

Shell setup for all cURL examples:

```bash
export BASE_URL='http://localhost:5000/api/v1'
export COOKIE_JAR='./driver-subscription.cookies'
export MOBILE='+919800000000' # Replace with the test driver's mobile
```

Use `-b` and `-c` together to read and update cookies. Do not commit cookie files or log cookie values. In Postman, set `baseUrl` to the same URL, use its cookie jar, and leave Authorization set to **No Auth**; that setting does not replace the required session cookie.

Success envelope, except request-OTP which omits `data`:

```json
{"success":true,"message":"Endpoint-specific message","data":{}}
```

Standard application error:

```json
{
  "success": false,
  "message": "Authentication required",
  "error": {"code":"UNAUTHORIZED","requestId":"request-id"}
}
```

`error.details` is present for validation errors; it is normally omitted for errors without details.

| HTTP | Code / message | Flutter handling |
|---|---|---|
| 400 | `BAD_REQUEST`, `Request validation failed` with field details | Fix input; do not retry unchanged input. |
| 401 | `UNAUTHORIZED`, `Authentication required` | Session missing/invalid/expired; use existing sign-in recovery. Rotation can also report `Session is invalid or expired`. |
| 403 | `FORBIDDEN`, `Required role is missing` | Valid session lacks DRIVER; do not interpret as empty subscription. |
| 404 | `NOT_FOUND`, endpoint-specific message | See endpoint table; not a generic empty-state signal. |
| 409 | `CONFLICT`, endpoint-specific message | Refresh relevant state before another action. |
| 429 | Global throttling; normally `BAD_REQUEST` through generic HTTP error handler, message supplied by rate limiter | Back off; respect `Retry-After` when returned. Default global limit: 120/minute. OTP service limits use `RATE_LIMITED`. |
| 503 | `SERVICE_UNAVAILABLE`, provider/configuration failure | Keep the purchase reference/key and reconcile status before a new attempt. |
| 500 | `INTERNAL_ERROR`, `An unexpected error occurred` | Preserve last known state. Purchase outcome may be uncertain; recover using the same idempotency key/history. |

Malformed JSON/framework 4xx errors use `BAD_REQUEST` with the framework's message. Unexpected database failures map to 500; unique/concurrent database conflicts can map to 409. Do not rely only on HTTP 200: parse the envelope and nullable `data`.

## 3. Authentication prerequisites

Reuse the app's existing driver sign-in implementation if already integrated.

### 3.1 Request OTP

- **Method / endpoint:** `POST /api/v1/driver/auth/request-otp`
- **Authentication:** None.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`.
- **Query:** None.
- **Body:** `mobile` (required string), Indian number matching `^(?:\+91|91)?[6-9]\d{9}$`. Keep the same representation when verifying.

```json
{"mobile":"+919800000000"}
```

**200 success:**

```json
{"success":true,"message":"OTP sent successfully"}
```

**Errors:** 400 validation; 429 `RATE_LIMITED` with `Please wait before requesting another OTP`, `Maximum OTP requests exceeded for this hour`, or `Too many OTP requests from this IP. Please try again later.`; shared framework/infrastructure errors also apply.

```bash
curl -sS -X POST "$BASE_URL/driver/auth/request-otp" \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  --data "{\"mobile\":\"$MOBILE\"}"
```

**Flutter notes:** OTP lifetime is 300 seconds; resend cooldown is 60 seconds. Existing `/driver/auth/send-otp` is an alias with the same body and response. `POST /driver/auth/resend-otp` also takes the same body without authentication and uses the same JSON headers, validation and rate limits; its 200 response is `{"success":true,"message":"OTP resent successfully","data":null}`. To resend with cURL, replace `request-otp` with `resend-otp` in the command above. Use actual OTP delivery; do not hardcode development OTPs.

### 3.2 Verify OTP and establish session

- **Method / endpoint:** `POST /api/v1/driver/auth/verify-otp`
- **Authentication:** None before verification; success sets the signed session cookie.
- **Headers:** JSON/Accept headers above.
- **Query:** None.
- **Body:** required `mobile` as above, required `otp` string of exactly 4 characters; optional `deviceId` string, maximum 255 characters.

```json
{"mobile":"+919800000000","otp":"1234","deviceId":"flutter-device-id"}
```

The OTP above is illustrative, not a usable credential.

**200 first-time driver:**

```json
{"success":true,"message":"OTP verified successfully","data":null}
```

**200 returning driver (illustrative subscription-routing case):**

```json
{
  "success": true,
  "message": "Logged in successfully",
  "data": {
    "isNewDriver": false,
    "isProfileCompleted": true,
    "kycStatus": "APPROVED",
    "vehicleApproved": true,
    "documentsValid": true,
    "accountStatus": "ACTIVE",
    "availability": "OFFLINE",
    "canGoOnline": false,
    "hasActiveBooking": false,
    "activeBooking": null,
    "nextStep": "BUY_SUBSCRIPTION",
    "driverId": "22222222-2222-4222-8222-222222222222",
    "profile": {
      "fullName": "Example Driver",
      "phoneNumber": "+919800000000",
      "email": null,
      "profileImage": "/images/example.jpg",
      "gender": "MALE",
      "dateOfBirth": "1995-01-01",
      "preferredLanguage": "en",
      "address": {
        "addressLine1": "Example address", "addressLine2": null,
        "city": "Delhi", "state": "Delhi", "postalCode": "110001", "country": "India"
      },
      "createdAt": "2026-09-01", "updatedAt": "2026-09-29"
    }
  }
}
```

**Errors:** 400 validation; 401 `UNAUTHORIZED` / `OTP is invalid or has expired`; 403 `FORBIDDEN` / `Driver account is <status>`; 429 `RATE_LIMITED` / `Too many failed verification attempts. Please request a new OTP.` or `Too many failed verification attempts. OTP has been invalidated.`; shared infrastructure errors apply.

```bash
export OTP='replace-with-received-otp'
curl -sS -X POST "$BASE_URL/driver/auth/verify-otp" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  --data "{\"mobile\":\"$MOBILE\",\"otp\":\"$OTP\",\"deviceId\":\"flutter-test-device\"}"
```

**Flutter notes:** Authentication comes from `Set-Cookie`, including when `data` is null. No bearer/access token is returned. Login can return `nextStep: BUY_SUBSCRIPTION` when other requirements pass; an existing active trip takes routing priority. Use the active-subscription API for subscription data, not `profile` or `accountStatus`.

## 4. Plans and plan details

### 4.1 List

- **Method / endpoint:** `GET /api/v1/driver/subscriptions/plans`.
- **Auth:** Signed driver session + DRIVER role.
- **Headers:** `Accept: application/json`, session cookie. No body.
- **Query:** None; no pagination/category/zone filter.
- **200:** Active plans ordered by price ascending, then ID. Empty catalog returns `data: []`.

```json
{
  "success": true,
  "message": "Active subscription plans retrieved",
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Monthly Unlimited",
      "description": "Example plan",
      "durationType": "MONTHLY",
      "durationValue": 30,
      "price": "499",
      "tripType": "UNLIMITED",
      "numberOfTrips": null,
      "isActive": true,
      "autoRenewAllowed": false,
      "gstOrTax": "0",
      "createdAt": "2026-09-01T00:00:00.000Z",
      "updatedAt": "2026-09-01T00:00:00.000Z"
    }
  ]
}
```

- **Errors:** Shared 401/403/429/500; an empty catalog is not 404.

```bash
curl -sS "$BASE_URL/driver/subscriptions/plans" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Accept: application/json'
```

**Flutter:** Read the envelope's `data` list. Parse Decimal values as strings/decimal values, not mandatory JSON numbers. No category/zone relations are returned or enforced by purchase.

### 4.2 Details

- **Method / endpoint:** `GET /api/v1/driver/subscriptions/plans/:id`.
- **Auth / headers:** Same driver cookie, DRIVER role and Accept header.
- **Path:** `id`, required plan UUID. **Query/body:** None.
- **200:** `{"success":true,"message":"Subscription plan retrieved","data":<Plan>}`; `<Plan>` is exactly one plan object from 4.1.
- **Errors:** 400 invalid UUID; 404 `NOT_FOUND` / `Subscription plan not found or inactive`; shared 401/403/429/500.

```bash
export PLAN_ID='replace-with-plan-uuid'
curl -sS "$BASE_URL/driver/subscriptions/plans/$PLAN_ID" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Accept: application/json'
```

**Flutter:** Fetch this on deep-link entry or before purchase confirmation. A catalog change between details and purchase is possible; the server takes current price at purchase. The returned payment/checkout amount is authoritative for payment.

## 5. Purchase / manual renewal

- **Method / endpoint:** `POST /api/v1/driver/subscriptions/purchase`.
- **Auth:** Signed driver cookie + DRIVER role; profile belongs to the session user.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, cookie, **`X-Idempotency-Key` required**.
- **Query:** None. **Body:** only required `planId` UUID. Do not send client price, driver ID or payment status.

```json
{"planId":"11111111-1111-4111-8111-111111111111"}
```

**200, real paid-plan checkout:**

```json
{
  "success": true,
  "message": "Subscription purchase retrieved",
  "data": {
    "subscription": {
      "id": "33333333-3333-4333-8333-333333333333",
      "driverId": "22222222-2222-4222-8222-222222222222",
      "planId": "11111111-1111-4111-8111-111111111111",
      "status": "PENDING_PAYMENT",
      "startDate": null,
      "expiryDate": null,
      "priceAtPurchase": "499",
      "taxAtPurchase": "0",
      "remainingTrips": null,
      "autoRenew": false,
      "createdAt": "2026-09-29T10:00:00.000Z",
      "updatedAt": "2026-09-29T10:00:00.000Z",
      "plan": {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "Monthly Unlimited",
        "description": "Example plan",
        "durationType": "MONTHLY",
        "durationValue": 30,
        "price": "499",
        "tripType": "UNLIMITED",
        "numberOfTrips": null,
        "isActive": true,
        "autoRenewAllowed": false,
        "gstOrTax": "0",
        "createdAt": "2026-09-01T00:00:00.000Z",
        "updatedAt": "2026-09-01T00:00:00.000Z"
      }
    },
    "paymentId": "44444444-4444-4444-8444-444444444444",
    "payment": {
      "id": "44444444-4444-4444-8444-444444444444",
      "subscriptionId": "33333333-3333-4333-8333-333333333333",
      "amount": "499",
      "amountPaid": "0",
      "currency": "INR",
      "method": "UPI",
      "status": "PENDING",
      "provider": "RAZORPAY",
      "providerOrderId": "order_example",
      "providerPaymentId": null,
      "paidAt": null,
      "createdAt": "2026-09-29T10:00:00.000Z",
      "updatedAt": "2026-09-29T10:00:00.000Z"
    },
    "checkout": {
      "provider": "RAZORPAY",
      "keyId": "rzp_test_example",
      "orderId": "order_example",
      "amountMinor": 49900,
      "currency": "INR"
    }
  }
}
```

**Other successful outcomes:** zero-price plan returns ACTIVE/CAPTURED, `provider: FREE`, `checkout: null`; same-key replay returns the existing purchase's current state, including FAILED or EXPIRED. A concurrent request while an order is being created may return CREATED and `checkout: null`. Never treat that as a failed or free purchase.

| HTTP | Code / exact message |
|---|---|
| 400 | `BAD_REQUEST` / `A valid x-idempotency-key header is required`; or `Request validation failed` for invalid plan UUID |
| 403 | `FORBIDDEN` / `Driver account is not active` |
| 404 | `NOT_FOUND` / `Driver profile not found`, `Driver not found`, or `Subscription plan not found or inactive` |
| 409 | `CONFLICT` / `Driver already has an active subscription` |
| 409 | `CONFLICT` / `Driver has a pending subscription; resume its payment first` |
| 409 | `CONFLICT` / `Idempotency key was used for another plan` |
| 409 | `CONFLICT` / `Subscription plan configuration is invalid` or `Subscription plan price is invalid` |
| 503 | `SERVICE_UNAVAILABLE` / `Razorpay is not configured` |
| 503 | `SERVICE_UNAVAILABLE` / `Unable to create subscription payment; check purchase history before retrying` |

Shared session, role, throttle and infrastructure errors also apply. Error envelope example:

```json
{"success":false,"message":"Driver already has an active subscription","error":{"code":"CONFLICT","requestId":"request-id"}}
```

```bash
export PURCHASE_KEY='unique-persisted-key-for-this-attempt'
curl -sS -X POST "$BASE_URL/driver/subscriptions/purchase" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -H "X-Idempotency-Key: $PURCHASE_KEY" \
  --data "{\"planId\":\"$PLAN_ID\"}"
```

**Idempotency and retry rules:** keys are scoped to the authenticated driver, maximum 100 characters after trimming. Generate/persist a UUID before the first request; retry the same purchase with the same key. The database serializes purchase creation per driver. A different key cannot create a second real pending purchase. On app restart, recover it from history. A 503/timeout can mean the gateway created an order but its response was lost: use history/status reconciliation rather than a new checkout. After a terminal FAILED attempt, a new user-confirmed attempt uses a new key. After expiry, manual renewal also uses a new key and the same purchase API; replaying the old key does not renew.

Money and duration are snapshotted. `gstOrTax` remains metadata: no new tax interpretation/addition was introduced. Price zero is supported; a LIMITED plan must have a positive trip count. Admin-configured `durationValue` continues to mean days regardless of durationType.

## 6. Checkout and verified payment result

Open the app's installed Razorpay Flutter checkout with this mapping:

| Checkout option | Backend source |
|---|---|
| `key` | `data.checkout.keyId` (public key, never the server secret) |
| `order_id` | `data.checkout.orderId` |
| `amount` | `data.checkout.amountMinor` (integer paise; do not multiply again) |
| `currency` | `data.checkout.currency` |
| Local purchase reference | `data.subscription.id` and `data.paymentId` |

No checkout URL or UPI deep link is returned. Use the provider SDK already selected by the Flutter project. The recorded `method: UPI` is the backend's existing method default and is not proof of the gateway instrument selected. Do not configure the UI from a fictional checkout token.

### 6.1 Verify payment (existing shared endpoint)

- **Method / endpoint:** `POST /api/v1/payments/verify`.
- **Auth:** Signed session required; for subscriptions the payment must belong to the authenticated driver's user. An admin/other user cannot verify someone else's subscription through this branch.
- **Headers:** Cookie, Accept, JSON content type. No idempotency header needed.
- **Query:** None.
- **Body:** `paymentId` backend UUID; `providerPaymentId` string length 3–200 from gateway success; `signature` string length 16–200 from gateway success. The backend uses its stored order ID for verification.

```json
{"paymentId":"44444444-4444-4444-8444-444444444444","providerPaymentId":"pay_example","signature":"replace-with-checkout-signature"}
```

```json
{
  "success": true,
  "message": "Payment verified",
  "data": {
    "id": "44444444-4444-4444-8444-444444444444",
    "subscriptionId": "33333333-3333-4333-8333-333333333333",
    "amount": "499",
    "amountPaid": "499",
    "currency": "INR",
    "method": "UPI",
    "status": "CAPTURED",
    "provider": "RAZORPAY",
    "providerOrderId": "order_example",
    "providerPaymentId": "pay_example",
    "paidAt": "2026-09-29T10:05:00.000Z",
    "createdAt": "2026-09-29T10:00:00.000Z",
    "updatedAt": "2026-09-29T10:05:00.000Z"
  }
}
```

The signature must match and the Razorpay order-payments API must report that exact payment captured with matching amount, currency and order. Only then does one transaction record capture and activate the subscription. Repeated valid verification/webhook delivery does not extend subscription dates.

| HTTP | Code / message |
|---|---|
| 400 | `BAD_REQUEST` / `Request validation failed` |
| 401 | `UNAUTHORIZED` / `Payment signature verification failed` or shared session error |
| 403 | `FORBIDDEN` / `Payment access denied` |
| 404 | `NOT_FOUND` / `Payment order not found` |
| 409 | `CONFLICT` / `Payment is not captured yet; refresh payment status` |
| 409 | `CONFLICT` / `Payment amount or currency does not match subscription` |
| 409 | `CONFLICT` / `Subscription payment provider is not supported`, `Subscription cannot be activated`, `Subscription payment has no duration snapshot`, `Subscription duration is invalid`, `Driver already has an active subscription`, or `Payment cannot be captured` |
| 503 | Provider request/configuration failure, including `Payment provider request failed` / `Payment verification is not configured` |

Shared 429/500 also apply. Network failure talking to the provider may surface as 500; preserve the purchase and reconcile.

```bash
export PAYMENT_ID='backend-payment-uuid'
export PROVIDER_PAYMENT_ID='pay_from-checkout'
export PAYMENT_SIGNATURE='signature-from-checkout'
curl -sS -X POST "$BASE_URL/payments/verify" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  --data "{\"paymentId\":\"$PAYMENT_ID\",\"providerPaymentId\":\"$PROVIDER_PAYMENT_ID\",\"signature\":\"$PAYMENT_SIGNATURE\"}"
```

**Flutter:** A gateway callback alone does not activate membership. After verify 200, fetch active status. On 409 not-yet-captured, show processing and reconcile with backoff. On SDK dismissal/failure, retain the existing order and fetch status before resuming it; late success is possible. Do not submit fabricated signatures. `POST /payments/` remains booking-only and is not needed for subscription purchase.

### 6.2 Gateway webhook (server-to-server; not a Flutter call)

- **Method / endpoint:** `POST /api/v1/webhooks/razorpay`.
- **Auth:** No driver cookie. HMAC-SHA256 of the **unaltered raw request bytes**, using server `RAZORPAY_WEBHOOK_SECRET`, must match `X-Razorpay-Signature`.
- **Headers:** `Content-Type: application/json`, `X-Razorpay-Signature`, `X-Razorpay-Event-Id` (provider event ID). Legacy payload `id`/`event_id` also supported when header is absent.
- **Body/query:** No query. Provider JSON with `event: payment.captured` and `payload.payment.entity` including `id`, `order_id`, `amount` integer minor units and `currency`.
- **200:** `{"success":true,"message":"Webhook accepted","data":null}`. Duplicate/irrelevant events are acknowledged. Amount/currency mismatch is audited and acknowledged without activation.
- **Errors:** 400 missing raw body/signature/event ID or invalid payload; 401 `Webhook signature verification failed`; 404 `Webhook payment not found` (provider can retry); 409 capture/activation conflict; 503 webhook verification not configured; 429/500 infrastructure errors.

Backend-only replay with an actual test payload/signature (do not ship webhook secrets in Flutter):

```bash
curl -sS -X POST "$BASE_URL/webhooks/razorpay" \
  -H 'Content-Type: application/json' \
  -H "X-Razorpay-Signature: $WEBHOOK_SIGNATURE" \
  -H "X-Razorpay-Event-Id: $WEBHOOK_EVENT_ID" \
  --data-binary @razorpay-test-event.json
```

**Flutter notes:** no webhook integration in the app. If the app is closed during payment, webhook/reconciliation can still activate membership. `payment.failed` does not permanently fail the order: the same order can have a later successful payment attempt.

## 7. Subscription status, details, history and recovery

All endpoints in this section require the signed cookie + DRIVER role and `Accept: application/json`. There is no request body. Other drivers' IDs return 404. Common errors: 401/403/429/500; UUID/query validation uses 400. Driver profile missing returns 404 `Driver profile not found`, except active lookup's compatible null behavior.

### 7.1 Active subscription

- **GET** `/api/v1/driver/subscriptions/active`; **query/path:** none.
- **200:** message `Active subscription retrieved`; `data` is one subscription with `plan`, without nested payment. Example:

```json
{
  "success": true,
  "message": "Active subscription retrieved",
  "data": {
    "id": "33333333-3333-4333-8333-333333333333",
    "driverId": "22222222-2222-4222-8222-222222222222",
    "planId": "11111111-1111-4111-8111-111111111111",
    "status": "ACTIVE",
    "startDate": "2026-09-29T10:05:00.000Z",
    "expiryDate": "2026-10-29T10:05:00.000Z",
    "priceAtPurchase": "499",
    "taxAtPurchase": "0",
    "remainingTrips": null,
    "autoRenew": false,
    "createdAt": "2026-09-29T10:00:00.000Z",
    "updatedAt": "2026-09-29T10:05:00.000Z",
    "plan": {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Monthly Unlimited",
      "description": "Example plan",
      "durationType": "MONTHLY",
      "durationValue": 30,
      "price": "499",
      "tripType": "UNLIMITED",
      "numberOfTrips": null,
      "isActive": true,
      "autoRenewAllowed": false,
      "gstOrTax": "0",
      "createdAt": "2026-09-01T00:00:00.000Z",
      "updatedAt": "2026-09-01T00:00:00.000Z"
    }
  }
}
```

No valid active record: `{"success":true,"message":"Active subscription retrieved","data":null}`. Missing profile retains `{"success":true,"message":"No active subscription found","data":null}`. No 404 for absence of membership.

```bash
curl -sS "$BASE_URL/driver/subscriptions/active" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Accept: application/json'
```

**Flutter:** ACTIVE requires future `expiryDate` and `remainingTrips` null or greater than zero. Plan `isActive` controls sale, not an already-paid membership. Null does not distinguish pending/expired/failed; consult history. Expired/exhausted ACTIVE rows are changed to EXPIRED during reads and the reconciliation job. Display UTC dates in the user's timezone.

### 7.2 Details of own purchase

- **GET** `/api/v1/driver/subscriptions/:id`; **path:** subscription UUID, **query:** none.
- **200:** `{"success":true,"message":"Subscription retrieved","data":<SubscriptionWithPlanAndPayment>}`.
- `<SubscriptionWithPlanAndPayment>` has all subscription fields from 7.1 and a `payment` object exactly as shown in section 5 (or null for legacy records without payment). Unlike purchase, it is not wrapped in `data.subscription` and has no checkout.
- **404:** `Driver subscription not found` for absent/not-owned purchase; 400 invalid UUID; shared errors above.

```bash
export SUBSCRIPTION_ID='subscription-uuid'
curl -sS "$BASE_URL/driver/subscriptions/$SUBSCRIPTION_ID" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Accept: application/json'
```

**Flutter:** Use this for receipt/details of active, expired, failed or pending purchases. The nested plan is current catalog data; use purchase snapshot fields for historical price/tax.

### 7.3 History / pending purchase recovery

- **GET** `/api/v1/driver/subscriptions/history`.
- **Query:** `page` integer ≥1, default 1; `limit` integer 1–100, default 20; optional `status`: `PENDING_PAYMENT`, `ACTIVE`, `EXPIRED`, `CANCELLED`, `FAILED`, `SCHEDULED`.
- **200:** message `Subscription history retrieved`; `data.items` is a list of the exact detail objects in 7.2; `data.meta` contains `page`, `limit`, `total`, `totalPages`. Newest first, ID as deterministic tie-breaker.
- **Empty success:**

```json
{"success":true,"message":"Subscription history retrieved","data":{"items":[],"meta":{"page":1,"limit":20,"total":0,"totalPages":0}}}
```

- **Errors:** 400 invalid page/limit/status; missing profile 404; shared errors above.

```bash
curl -sS "$BASE_URL/driver/subscriptions/history?page=1&limit=20&status=PENDING_PAYMENT" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Accept: application/json'
```

**Flutter:** On restart, use pending history to recover IDs, then call payment status. Filter/payment provider distinguish legacy SIMULATED records. History does not call Razorpay and does not itself reconcile funds.

### 7.4 Payment status / resume checkout

- **GET** `/api/v1/driver/subscriptions/:id/payment`.
- **Path:** subscription UUID. **Query:** optional `reconcile=true|false` string, default `false`.
- **200:** message `Subscription payment status retrieved`; **exact `data` shape matches section 5:** `{subscription, paymentId, payment, checkout}`. Payment/paymentId can be null for legacy rows. `checkout` is null when captured, terminal, free, simulated, or order creation is unresolved.
- **Errors:** 400 invalid UUID/reconcile value; 404 `Driver subscription not found`; reconciliation can also return verification/capture 409 and provider 503/500; shared session/role/throttle errors apply.

```bash
curl -sS "$BASE_URL/driver/subscriptions/$SUBSCRIPTION_ID/payment?reconcile=true" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Accept: application/json'
```

**Flutter:** Without reconciliation this reads database state. With `true`, backend checks gateway capture and activates if confirmed. For CREATED orders lacking a provider ID, receipt recovery starts once the record is at least two minutes old; a matching order is attached, while a successful provider lookup with no order marks the attempt FAILED. Before that, show “Preparing payment” and retry status with backoff. Do not repeatedly submit new purchases. Captured responses have `checkout: null`.

The worker also reconciles stale payments (older than 15 minutes) every 15 minutes. Keep it running; foreground status recovery is available without waiting for that job. Avoid constant rapid polling; e.g. refresh on resume, after callback and a few times with increasing delay, then offer manual refresh/support.

## 8. Field dictionary

| Plan field | Type / meaning |
|---|---|
| `id` | Plan UUID; send as purchase `planId`, not as subscription/payment ID. |
| `name`, `description` | Display name; description is nullable. |
| `price` | Decimal JSON string, e.g. `"499"`; charged in INR major units. Catalog has no currency field; payment does. |
| `durationType` | DAILY/WEEKLY/MONTHLY catalog label. |
| `durationValue` | Positive number of days. Preserves existing day-based configuration; MONTHLY + 30 means 30 days, MONTHLY + 1 means 1 day. |
| `duration`, `features` | Absent. Derive UI labels from actual duration/trip fields and description. |
| `tripType`, `numberOfTrips` | LIMITED/UNLIMITED; nullable integer allowance. New LIMITED purchases reject missing/non-positive counts. |
| `isActive` | Catalog availability for new sales, not driver membership. |
| `status` | Absent on plan; exists on subscription/payment. |
| `gstOrTax` | Stored decimal tax metadata, copied to purchase; no percentage interpretation or extra charge is applied. |
| `autoRenewAllowed` | Catalog metadata only; recurring payments are not enabled. |
| `createdAt`, `updatedAt` | ISO date-time record timestamps. |

| Subscription field | Type / meaning |
|---|---|
| `id`, `driverId`, `planId` | Subscription UUID, DriverProfile UUID (not user ID), plan UUID. |
| `status` | PENDING_PAYMENT before capture, ACTIVE after verified capture, EXPIRED on date/trip exhaustion, FAILED for unresolved creation confirmed absent at provider. CANCELLED/SCHEDULED are retained schema values; no self-service transitions added. |
| `startDate`, `expiryDate` | Nullable ISO timestamps; null until activation for new purchases. Start is activation time, expiry is snapshot duration days later in UTC. |
| `expiresAt`, `isActive` | Absent on subscription. Use `expiryDate` and server status. |
| `priceAtPurchase`, `taxAtPurchase` | Decimal strings; historical price/tax snapshots. Price is the charged total under the preserved existing tax behavior. |
| `remainingTrips` | Null for unlimited; integer for limited. One completed trip decrements the membership that covered trip start, transactionally with completion. At zero the membership expires. Legacy rides with no matching membership are not retroactively billed. |
| `autoRenew` | False for new purchases. Manual renewal only. |
| `plan` | Current catalog scalar fields, included in active/details/history/purchase-status responses. |
| `payment` | Included in details/history, separate sibling in purchase/payment-status, absent from active lookup. |
| `createdAt`, `updatedAt` | Record timestamps; not necessarily activation time. |

| Payment / checkout field | Meaning |
|---|---|
| `paymentId`, `payment.id` | Backend payment UUID. Send to `/payments/verify`. |
| `subscriptionId` | Owning subscription ID; payment lookup is driver-scoped. |
| `amount`, `amountPaid` | Decimal major-unit strings. Before capture paid is zero; after capture equals amount. |
| `currency` | INR. |
| `provider` | RAZORPAY for real checkout, FREE for zero-price, SIMULATED only in legacy data. |
| `method` | Existing UPI default; not a verified record of chosen gateway instrument. |
| `status` | CREATED during preparation, PENDING after order, CAPTURED after funds confirmed, FAILED if stale creation has no provider order. Other existing payment enum states may appear in historical/admin-managed records. |
| `providerOrderId` | Razorpay `order_...`, nullable until order is saved. |
| `providerPaymentId` | Razorpay `pay_...`, nullable until capture. Not interchangeable with backend UUID. |
| `paidAt` | Nullable confirmed payment timestamp. |
| `checkout.keyId` | Public Razorpay key for checkout; no secret returned. |
| `checkout.orderId` | Gateway order ID. |
| `checkout.amountMinor` | Integer paise. Use directly in SDK. |

Payment response projections omit internal idempotency keys and metadata. The duration snapshot lives in internal payment metadata, so editing a catalog plan later cannot shorten an already-created purchase. No schema migration is needed.

## 9. Supporting driver status APIs

### 9.1 Onboarding status

- **GET** `/api/v1/driver/onboarding-status` (alias `/driver/onboarding/status`).
- **Auth / headers:** signed cookie + DRIVER, Accept. **Body/query:** none.
- **200 example:**

```json
{"success":true,"message":"Onboarding status retrieved","data":{"onboardingStatus":"READY_TO_DRIVE","verificationStatus":"APPROVED","kycStatus":"APPROVED","isProfileCompleted":true,"hasAssignedVehicle":true,"vehicleApproved":true,"documentsValid":true,"accountStatus":"ACTIVE","canGoOnline":true,"hasActiveSubscription":true,"hasActiveBooking":false,"activeBooking":null,"nextStep":"DASHBOARD","vehiclesRegistered":1,"vehiclesApproved":1}}
```

Missing profile returns 200 with ACCOUNT_CREATED/PENDING/NOT_SUBMITTED, false readiness flags including `hasActiveSubscription`, `nextStep: COMPLETE_PROFILE`, zero vehicle counts; that fallback omits booking fields.

- **Errors:** shared 401/403/429/500.

```bash
curl -sS "$BASE_URL/driver/onboarding-status" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Accept: application/json'
```

**Flutter:** `hasActiveSubscription` is now explicit. `canGoOnline` also requires profile/KYC/vehicle/documents/account readiness and no active booking. `nextStep: BUY_SUBSCRIPTION` is returned only after higher-priority requirements pass. After payment, refresh this plus active subscription. Existing go-online operations reject a missing/expired/exhausted membership with 403 `DRIVER_SUBSCRIPTION_REQUIRED`; this does not abort an ongoing trip.

### 9.2 Account status

- **GET** `/api/v1/driver/account/status`.
- **Auth / headers:** signed cookie + DRIVER, Accept. **Body/query:** none.
- **200:**

```json
{"success":true,"message":"Account status retrieved","data":{"userStatus":"ACTIVE","verificationStatus":"VERIFIED","availability":"OFFLINE"}}
```

- **Errors:** shared 401/403/429/500; 404 `Driver account not found`. Missing profile returns actual userStatus with PENDING verification and OFFLINE availability.

```bash
curl -sS "$BASE_URL/driver/account/status" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Accept: application/json'
```

**Flutter:** Account ACTIVE is not membership ACTIVE. Account verification is raw (e.g. VERIFIED), while onboarding maps it to an external label (APPROVED).

## 10. Recommended Flutter implementation

1. Restore cookies and fetch active status. Show an existing membership or recover pending history before starting another purchase.
2. Fetch plans and details. Confirm displayed plan and price.
3. Persist a new purchase UUID key; submit once. Persist subscription/payment IDs.
4. If checkout is available, map fields to Razorpay SDK. If ACTIVE/FREE, skip checkout. If CREATED/null checkout, use status recovery.
5. On checkout success, call existing payment verify with backend payment UUID and provider callback ID/signature.
6. Fetch active subscription and onboarding status. Only server confirmation allows the Active screen.
7. On expiry/trip exhaustion, display EXPIRED and offer manual purchase with a new key. Refund requests go to support.

Client states should distinguish loading, no active membership, preparing checkout, pending payment, active, expired, failed, uncertain/network error. Never turn a network error into an empty membership or payment failure. Scope cached state to the signed-in account. Preserve updated cookies from every response.

Dio repository sketch (reuse the app's existing authenticated, persistent-cookie client; `baseUrl` ends in `/api/v1/`):

```dart
class DriverSubscriptionApi {
  DriverSubscriptionApi(this.dio);
  final Dio dio;

  Future<dynamic> getData(String path) async {
    final response = await dio.get(path);
    final envelope = Map<String, dynamic>.from(response.data as Map);
    if (envelope['success'] != true) throw StateError('Request failed');
    return envelope['data'];
  }

  Future<Map<String, dynamic>> purchase(String planId, String savedKey) async {
    final response = await dio.post('driver/subscriptions/purchase',
      data: {'planId': planId},
      options: Options(headers: {'X-Idempotency-Key': savedKey}));
    return Map<String, dynamic>.from(response.data['data'] as Map);
  }

  Future<void> verify(String paymentId, String providerId, String signature) async {
    await dio.post('payments/verify', data: {
      'paymentId': paymentId,
      'providerPaymentId': providerId,
      'signature': signature,
    });
  }
}
```

Use the project's installed Dio dependency and error handling. Decode `DioException.response.statusCode`, `message`, `error.code/details/requestId`; `response.data` is the envelope. Implement nullable DTO dates/objects. Keep monetary arithmetic decimal-safe; only checkout `amountMinor` is already an integer minor-unit amount.

## 11. Postman and rollout

The existing [Flutter mobile collection](Fleet-Management-Flutter-Mobile.postman_collection.json) contains a **45 - Driver Subscriptions** folder. Login using driver OTP first; cookie jar handles authentication. Set `subscriptionPlanId`, use/persist `subscriptionIdempotencyKey`, and keep it unchanged when retrying. Purchase saves `subscriptionId` and `subscriptionPaymentId`. Set `subscriptionProviderPaymentId` and `subscriptionSignature` from an actual test checkout before verification; collection requests cannot synthesize provider success. The collection's `BASE_URL` is host-only (e.g. `http://localhost:5000`), unlike the shell examples whose BASE_URL includes `/api/v1`.

Deployment requirements:

- Deploy this backend revision; no new DB migration or package dependency is introduced.
- Configure server `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` from one matching test/live account. Never embed server secrets in Flutter.
- Configure the existing webhook URL for `payment.captured` and automatic payment capture in Razorpay. Authorization alone is intentionally insufficient for activation.
- Keep the existing payments worker running for reconciliation and expiry maintenance.
- Ensure existing drivers have valid subscriptions before enforcing the new go-online requirement. Legacy SIMULATED pending records require support review, not automatic activation.
- Keep existing catalog duration values as day counts. Tax metadata semantics are unchanged; do not add tax again in Flutter.

Provider references: [Razorpay order fetch/receipt filtering](https://github.com/razorpay/razorpay-node/blob/master/documents/order.md), [webhook signature and event-ID validation](https://github.com/razorpay/markdown-docs/blob/master/webhooks/validate-test.md).

## 12. Verification and source map

Verified for this change: production build, TypeScript typecheck and focused subscription/payment lint pass; all **16 subscription integration tests pass** against a separate PostgreSQL test database. The full existing unit suite reports 98 passed / 4 failed; the same four assertions fail on untouched baseline `2433798` (driver profile eligibility, empty vehicle-document shape, customer geofencing and booking cancellation transition). Those unrelated behaviors were not changed to make this feature's tests green.

To reproduce integration tests, initialize a dedicated empty database with the current Prisma schema, set `TEST_DATABASE_URL` to it, and use test-only `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`. Then run `npm run test:integration -- --runTestsByPath test/driver-subscription.integration-spec.ts`. Provider HTTP calls are mocked; do not point this command at production. The suite is skipped when `TEST_DATABASE_URL` is unset.

Automated coverage lives in [driver-subscription.integration-spec.ts](../../test/driver-subscription.integration-spec.ts). It uses an isolated PostgreSQL database and mocked gateway network calls with real signatures; it does not charge money. Real Razorpay test-mode checkout on a device remains a deployment acceptance step.

Relevant sources: [driver routes](../../src/modules/driver/driver.routes.ts), [controller](../../src/modules/driver/driver-subscription.controller.ts), [subscription service](../../src/modules/driver/services/driver-subscription.service.ts), [transactional state helpers](../../src/modules/driver/services/subscription-state.ts), [payment verification/capture](../../src/modules/payments/service.ts), [webhook](../../src/webhook/controller.ts), [trip completion](../../src/modules/trips/service.ts), [schema](../../prisma/schema.prisma), [Postman generator](../../scripts/generate-postman.ts).
