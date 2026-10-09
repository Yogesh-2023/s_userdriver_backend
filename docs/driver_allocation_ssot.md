# Driver Matching, Allocation, Timeout, Fallback & Concurrency Control Specification (SSOT)
**Project**: Sawariya Taxi Booking Backend
**Version**: 1.0
**Module**: Dispatch (`src/modules/dispatch/*`)

## 1. Existing Driver Matching Audit & Strategy
An audit of the existing `DispatchService`, `DriverMatchingService`, and `DispatchLockService` reveals that a highly scalable, production-grade allocation engine is **already implemented**. 
- It uses Redis geospatial search (`GEOSEARCH`) for hyper-fast localized driver discovery.
- It employs Serializable ACID transactions (`Prisma.TransactionIsolationLevel.Serializable`) combined with Redis distributed locks for strict concurrency control.
- Background jobs (via `BullMQ` / queues) manage timeouts and fallback dispatches safely.

**Conclusion**: No structural changes or redesigns are necessary. The current system successfully mitigates race conditions and driver double-bookings. This document formally standardizes the current implementation as the SSOT.

---

## 2. Driver Eligibility Rules
Before a driver is even considered for a booking, the `DriverMatchingService` enforces the following strict eligibility checks at the database query level:

### Driver Preconditions
- `user.status == 'ACTIVE'` (Not suspended or blocked).
- `verificationStatus == 'VERIFIED'` (KYC complete).
- `availability == 'ONLINE'` (Actively seeking rides).
- **Double-booking Prevention**: `currentBookings` must NOT contain any active states (`DRIVER_ASSIGNED`, `TRIP_STARTED`, etc.).
- **Cooldown Prevention**: Must not have an existing active `dispatchOffer` for another ride.
- Documents (License, background check) must be `VERIFIED` and not expired (`expiresAt > now()`).

### Vehicle Preconditions
- The driver's active assigned vehicle must match the booking's `vehicleCategoryId`.
- `vehicle.status == 'ACTIVE'` and `vehicle.isAvailable == true`.

### Location & Freshness Preconditions
- Must be within the configurable `radiusMeters`.
- Redis checks the driver's location freshness. If the last broadcast (`receivedAt`) is stale (>90 seconds), the driver is excluded to prevent assigning rides to drivers with network drops.

---

## 3. Matching & Ranking Algorithm
Instead of blindly assigning the absolute closest driver, the system calculates a weighted **Score** to ensure fairness and efficiency:

```javascript
const score = 
  proximity * 55 +         // Distance to pickup
  idle * 15 +              // Time since last trip (rewards drivers waiting longer)
  freshness * 10 +         // Confidence in GPS ping
  rating * 8 +             // Customer average rating
  neutralOperationalHistory * 12; // Safety/Reliability metrics
```
*Ranked drivers are sorted descending by score, and selected in limited batches.*

---

## 4. Controlled Dispatch Strategy
The system uses a **Controlled Sequential Batch/Broadcast Strategy**:
1. Top `N` eligible drivers (Batch 1) are selected.
2. An `OFFERED` record is created in `DispatchOffer` for each.
3. Socket `booking.driver.offer` is emitted.
4. A Redis timer queue `dispatch-timeout` is scheduled.

*If no driver accepts within the timeout, or all reject, the system moves to Batch 2.*

---

## 5. Driver Offer State Machine
The lifecycle of a single dispatch attempt (Offer) explicitly tracks timestamps and statuses:
- **`OFFERED`**: Active and waiting for response.
- **`ACCEPTED`**: Driver clicked accept.
- **`REJECTED`**: Driver clicked decline. (Triggers immediate re-dispatch).
- **`EXPIRED`**: Driver ignored it. (Triggers immediate re-dispatch).
- **`INVALIDATED`**: Another driver won the booking.

---

## 6. Concurrency & Race Condition Strategy (The "Winner Takes All" Lock)
The most critical part of the system is the `DispatchLockService.acceptRide()`. It solves the "Two Drivers Accept Simultaneously" problem.

1. **Distributed Lock (Optimistic Phase)**: 
   Uses Redis `SET NX` (`redisKeys.bookingAcceptLock`). If locked, concurrent requests skip DB overhead and are immediately routed to a replay check.
2. **ACID Transaction (Serializable Phase)**: 
   The database executes an atomic `updateMany`:
   ```sql
   UPDATE "Booking" 
   SET "status" = 'DRIVER_ASSIGNED', "assignedDriverId" = $driverId 
   WHERE "id" = $bookingId AND "status" = 'SEARCHING_DRIVER' AND "assignedDriverId" IS NULL
   ```
3. **Double-Booking Check**:
   Simultaneously updates the driver's availability:
   ```sql
   UPDATE "DriverProfile" SET "availability" = 'BUSY' WHERE "id" = $driverId AND "availability" = 'ONLINE'
   ```
4. **Outcome Validation**:
   If either of these queries affects `0` rows, the transaction is immediately rolled back (`throw errors.conflict("OFFER_TAKEN" | "DRIVER_NOT_AVAILABLE")`).

> [!IMPORTANT]
> **This guarantees that exactly one driver wins the assignment.** All losing drivers receive a `409 Conflict` REST response and a `dispatch:offer-taken` socket event.

---

## 7. Timeout, Fallback & Rejection Flow
- **Rejection**: When `DispatchService.reject()` is called, it checks if any other active offers remain in the batch. If `0`, it instantly enqueues `dispatch-next-batch` with 200ms delay.
- **Offer Timeout**: Handled by BullMQ. If the job fires and the offer is still `OFFERED`, it marks it `EXPIRED` and triggers the next batch.
- **Global Booking Timeout**: A separate 8-minute `booking-timeout` job runs. If it fires, the booking status transitions to `NO_DRIVER_FOUND`, all pending offers are expired, and the customer receives a push notification.

---

## 8. Driver Cancel & Re-dispatch
If a driver cancels *after* assignment (before Trip start):
1. `DispatchService.driverCancel()` locks the booking.
2. Rollbacks the booking status: `DRIVER_ASSIGNED` → `SEARCHING_DRIVER`.
3. Marks the Trip `CANCELLED`.
4. Frees the vehicle and marks the abandoning driver `OFFLINE` as a penalty.
5. Enqueues a `dispatch-start` job to find a brand new driver instantly.

---

## 9. API vs Socket Responsibilities
- **API (Authoritative)**: `POST /dispatch/accept` and `POST /dispatch/reject`. These return explicit HTTP status codes (200 OK, 409 Conflict).
- **Socket (Eventual/Notifications)**: `booking:driver-assigned`, `dispatch:offer-taken`, `booking:searching-driver`. Used strictly to update UI states. *A socket delay will never cause a database race condition.*

---

## 10. Final Acceptance Checklist

- [x] Eligible driver accurately shortlisted (offline/busy/stale excluded).
- [x] Driver ranking is deterministic (Distance + Idle time + Rating).
- [x] Controlled sequential batch strategy is enforced.
- [x] Concurrency atomic lock prevents two drivers from accepting one booking.
- [x] Driver cannot accept expired or invalidated offers.
- [x] No double-booking allowed (Driver must be strictly `ONLINE`).
- [x] Driver rejection automatically triggers fallback.
- [x] BullMQ timeout gracefully handles unresponsive drivers.
- [x] `NO_DRIVER_FOUND` global limit stops endless searching.
- [x] Re-dispatch flow recovers seamlessly if an assigned driver abandons.
- [x] Redis and Database architectures correctly split responsibility.
- [x] System is completely race-condition safe.
