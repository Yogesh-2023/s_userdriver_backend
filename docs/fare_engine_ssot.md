# Dynamic Fare Engine, Pricing Versioning & Admin Surge Configuration Specification (SSOT)
**Project**: Sawariya Taxi Booking Backend
**Version**: 1.0

## 1. Fare System Audit & Strategy
An audit of the existing `PricingService` (`src/modules/pricing/service.ts`) and database schema reveals that the system is already implemented with **deterministic, versioned, and immutable financial accuracy.**

**Key Findings:**
- The engine uses exact-precision `Prisma.Decimal` arithmetic to avoid floating-point errors.
- It already supports configurable Base Fare, Per-KM, Per-Minute, Waiting Charge, Taxes, Minimum Fare, and dynamic Surge Multipliers.
- **Client inputs are strictly ignored.** The frontend cannot pass `surgeMultiplier` or `finalFare` in the request body; the server recalculates everything from scratch using internal IDs.
- **Versioning is built-in.** Changes to pricing do not overwrite the row; they create a new `PricingRule` with `effectiveFrom` and `effectiveTo` timestamps.

**Conclusion**: No destructive codebase changes are required. The current engine perfectly satisfies the proposal's requirements. This document standardizes the pricing architecture as the SSOT.

---

## 2. Configurable Fare Rules & Versioning Model

### The `PricingRule` Model (Base Engine)
All pricing configurations are stored in the database. When an Admin updates a rule, the backend executes a **Soft Versioning** strategy:
1. `effectiveTo` on the current rule is updated to `now()`.
2. A new row is inserted with `effectiveFrom = now()` and `version = currentVersion + 1`.

*Impact*: Future bookings instantly use the new rate. Historical bookings seamlessly preserve their original fares, ensuring financial audits and refunds are completely reproducible.

---

## 3. Surge Multiplier (Admin Authorization Only)

**Constraint**: The Surge Multiplier represents a demand-based price increase (e.g., `1.5x`).
- **Customers & Drivers**: Cannot read or write surge rules directly. They only see the resultant estimated fare or breakdown.
- **Admin**: Only authorized Admins (with `fares.update` permission) can hit the `PATCH /api/v1/admin/fare-rules/:id/surge` endpoint.

**How it works**:
The system queries `SurgePricingRule` where `startsAt <= now` and `endsAt > now`. If multiple rules apply, it orders by multiplier descending (highest surge wins). If no rule applies, the default multiplier is `1.0x`.

---

## 4. Deterministic Fare Calculation Formula

The `PricingService` executes the following strict, linear formula using `Decimal.js` (handled via Prisma Decimal):

1. **Calculate Base Components**:
   - `Distance Charge` = `(perKilometer * distanceMeters) / 1000`
   - `Time Charge` = `(perMinute * durationSeconds) / 60`
   - `Waiting Charge` = `(waitingPerMinute * waitingMinutes)`
   - `Base Subtotal` = `BaseFare + Distance Charge + Time Charge + Waiting Charge`

2. **Apply Surge**:
   - `Surge Charge` = `Base Subtotal * (SurgeMultiplier - 1)`
   - `Pre-Minimum Subtotal` = `Base Subtotal + Surge Charge + Tolls`

3. **Apply Minimum Fare**:
   - If `Pre-Minimum Subtotal < Configured Minimum Fare`, then `Subtotal = Minimum Fare`.

4. **Apply Discount (Coupons)**:
   - Validates coupon expiry, usage limit, and minimum fare requirements.
   - `Taxable Amount` = `Subtotal - Discount`

5. **Apply Taxes & Final Rounding**:
   - `Tax` = `(Taxable Amount * TaxPercentage) / 100`
   - `Total` = `Taxable Amount + Tax`
   - *Final output is rounded to 2 decimal places using `ROUND_HALF_UP`.*

---

## 5. Fare Estimate vs. Final Fare Flows

### Fare Estimate Flow (`GET /api/v1/customer/fare-estimate`)
- **Inputs**: `pickupLatitude`, `pickupLongitude`, `dropLatitude`, `dropLongitude`, `vehicleCategoryId`.
- **Process**: Uses Google Maps API (or equivalent routing) to guess `distanceMeters` and `durationSeconds`.
- **Output**: Returns a `FareBreakdown` JSON clearly marked as an estimate.

### Final Fare Calculation (`POST /api/v1/driver/trips/:id/complete`)
- **Inputs**: Actual GPS polyline distance, actual ride duration, actual driver waiting time.
- **Process**: Re-runs the exact same `PricingService.calculate()` method.
- **Snapshot Creation**: The engine serializes the exact variables used (e.g., `pricingRuleId`, `surgeRuleId`, `platformCommissionPercentage`) and stores them immutably inside `FareBreakdown.calculationSnapshot` in the database.

---

## 6. Cancellation Fee Rules
Cancellation logic is tightly coupled with the Booking State Machine.
- **Pre-Assignment**: Free cancellation.
- **Post-Assignment (Driver En Route)**: `PricingRule.cancellationFee` applies.
- **Driver Arrived**: Wait time limits trigger driver-initiated cancellation, charging the customer.

*The fee is automatically injected into the customer's `WalletTransaction` as a debit, or applied to their next ride.*

---

## 7. Security & API Defenses (The "Zero-Trust" Approach)
- **Ignored Client Payloads**: If a malicious client tries to send `{"finalFare": 10, "surgeMultiplier": 0.5}` during booking completion, the Zod schema automatically drops these fields.
- **Audit Logging**: Every change to `PricingRule` or `SurgePricingRule` by an Admin triggers an `AuditLog` entry detailing:
  - `actorUserId` (The Admin)
  - `before` / `after` JSON diffs
  - `ipAddress` and timestamp
- **Role Validation**: Enforced at the router level using `requireRoles(['ADMIN'])` and explicit permission checks.

---

## 8. Final Acceptance Checklist

- [x] Base Fare, Per-Km, Per-Minute, Min Fare, Waiting/Night Charges are fully configurable.
- [x] Surge Multiplier logic is deterministic and restricted exclusively to Admin control.
- [x] Historical pricing versioning is enforced (Immutable financial history).
- [x] Minimum Fare strictly acts as a floor.
- [x] Financial calculation uses Decimal math (No floating-point errors).
- [x] Customers and drivers cannot override or inject fake pricing inputs.
- [x] Fare Snapshot captures all rules and components in the database at trip completion.
- [x] The single centralized `PricingService` ensures Estimates and Final Fares use identical logic.
