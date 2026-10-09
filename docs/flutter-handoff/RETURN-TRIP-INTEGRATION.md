# Return Trip API Integration Guide (Flutter Team)

This guide provides everything the Flutter client team needs to integrate the newly implemented **Return Trip** functionality.

## 1. Booking a Return Trip

The `POST /api/v1/bookings` endpoint has been updated to accept return trips seamlessly.

### Request Payload Updates

You now have two new fields in the request body when creating a booking:

| Field | Type | Description |
|-------|------|-------------|
| `tripType` | `string` | Optional. Enum: `"ONE_WAY"` or `"RETURN"`. Defaults to `"ONE_WAY"`. |
| `returnDateTime` | `string` (ISO 8601) | Optional. **Required if `tripType` is `"RETURN"`**. The scheduled time for the return leg. Must be after the outbound time and in the future. |

**Example Request:**
```json
{
  "vehicleCategoryId": "uuid-of-vehicle-category",
  "type": "IMMEDIATE",
  "rideType": "CITY",
  "tripType": "RETURN",
  "pickup": {
    "address": "Home",
    "latitude": 28.7041,
    "longitude": 77.1025
  },
  "drop": {
    "address": "Office",
    "latitude": 28.5355,
    "longitude": 77.3910
  },
  "returnDateTime": "2026-10-10T18:00:00Z",
  "paymentMethod": "CASH"
}
```

> [!NOTE]
> Under the hood, the backend creates **two separate, linked bookings** within a single transaction. The first booking acts as the outbound ride, and the second booking is automatically generated as a scheduled ride with its pickup/drop coordinates reversed.

## 2. Handling Websocket Events (`booking:created`)

When the booking is created, the backend emits the `booking:created` event over the WebSocket connection (`customer:{customerId}`). The payload now includes a unified `fare` block for return trips.

**Updated Payload Structure:**
```json
{
  "bookingId": "outbound-booking-uuid",
  "status": "PENDING",
  "type": "IMMEDIATE",
  "rideType": "CITY",
  "tripType": "RETURN",
  "tripLeg": "OUTBOUND",
  "returnBookingId": "return-booking-uuid",
  "returnDateTime": "2026-10-10T18:00:00Z",
  "categoryId": "uuid",
  "pickup": { ... },
  "drop": { ... },
  "fare": {
    "outbound": 350.00,
    "return": 350.00,
    "total": 700.00,
    "currency": "INR"
  },
  "estimatedFare": 350.00,
  "currency": "INR",
  "scheduledAt": null,
  "createdAt": "2026-10-03T14:00:00Z",
  "paymentMethod": "CASH"
}
```

### UI Presentation Advice
* If `tripType === "RETURN"`, display the `fare.total` as the final quoted price to the user in the pre-flight UI. 
* The driver for the outbound trip may *not* be the same driver for the return trip. Treat the return leg conceptually as an auto-scheduled ride.

## 3. Cancellation Flow

If the customer wishes to cancel the ride, there is no change to the endpoint `POST /api/v1/bookings/:id/cancel`.

> [!IMPORTANT]
> **Cancellation Cascading:** If the customer cancels the parent (outbound) booking via the API, the backend will **automatically cancel** the linked return booking. You do not need to fire two cancellation requests. 

If the outbound ride is completed and the customer only wants to cancel the return leg, simply call the cancel endpoint with the `returnBookingId`.

## 4. Ride History (`GET /api/v1/bookings`)

Ride history will fetch both the OUTBOUND and RETURN legs as individual items. You can visually group them in the UI if `returnBookingId` matches another item's `id`, or if `parentBookingId` is present.
