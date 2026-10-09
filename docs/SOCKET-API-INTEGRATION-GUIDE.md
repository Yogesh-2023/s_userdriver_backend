# Complete Socket.IO API Integration Guide

This document details all the Real-Time Socket.IO events available for the Customer, Driver, and Admin applications.

## 🔗 Connection Details
- **Namespace/Path:** `/socket.io`
- **Transport:** `websocket`
- **Authentication:** Cookie-based (Fastify Signed Cookies). Ensure `withCredentials: true` is passed in the client configuration.

---

## 📩 General & Server-to-Client Events (All Roles)

These events are emitted by the server to the connected clients automatically.

### 1. `socket:ready`
Fired immediately after a successful connection and authentication.
**Payload from Server:**
```json
{
  "roles": ["DRIVER"],
  "permissions": []
}
```

### 2. `state:sync`
Fired immediately after a successful connection to provide the initial state (active bookings, trips, locations) without needing a manual request.
**Payload from Server:** (Matches `state:sync:request` response).

### 3. `socket:error`
Fired when a critical error occurs.
**Payload from Server:**
```json
{
  "code": "INTERNAL_ERROR" // or SOCKET_UNAUTHENTICATED, SOCKET_RATE_LIMITED
}
```

---

## 🚖 Driver Application Socket Events

Drivers emit these events to the server and receive an Acknowledgement response via callback.

### 1. `driver:online` or `driver:go-online`
Go online and make the driver available for dispatch offers.
**Request Payload:**
```json
{
  "latitude": 19.076,
  "longitude": 72.8777,
  "heading": 180,
  "speed": 40,
  "accuracy": 5,
  "timestamp": "2026-09-08T10:30:00.000Z",
  "sequence": 1,
  "tripId": "uuid-optional"
}
```
**Acknowledgement Response:**
```json
{
  "success": true,
  "data": { "availability": "ONLINE_AVAILABLE" }
}
```

### 2. `driver:offline` or `driver:go-offline`
Go offline.
**Request Payload:** `{}`
**Acknowledgement Response:**
```json
{
  "success": true,
  "data": { "availability": "OFFLINE" }
}
```

### 3. `driver:location:update`
Push periodic location updates (every few seconds).
**Request Payload:**
```json
{
  "latitude": 19.076,
  "longitude": 72.8777,
  "heading": 180,
  "speed": 40,
  "accuracy": 5,
  "timestamp": "2026-09-08T10:30:00.000Z",
  "sequence": 2
}
```
**Acknowledgement Response:**
```json
{
  "success": true,
  "data": { "recordedAt": "2026-09-08T10:30:01.000Z", "sequence": 2 }
}
```

### 4. `dispatch:accept`
Accept a ride offer.
**Request Payload:**
```json
{
  "offerId": "uuid-of-the-offer"
}
```
**Acknowledgement Response:**
```json
{
  "success": true,
  "data": { /* Assignment details */ }
}
```

### 5. `dispatch:reject`
Reject a ride offer.
**Request Payload:**
```json
{
  "offerId": "uuid-of-the-offer",
  "reason": "TOO_FAR" // Optional
}
```
**Acknowledgement Response:** `{ "success": true }`

### 6. `driver:heading-to-pickup`
Mark driver as heading to pickup.
**Request Payload:** `{ "tripId": "uuid" }`
**Acknowledgement Response:** `{ "success": true, "data": {} }`

### 7. `driver:arrived`
Mark driver as arrived at pickup location.
**Request Payload:** `{ "tripId": "uuid" }`
**Acknowledgement Response:** `{ "success": true, "data": {} }`

### 8. `trip:start`
Start the trip by verifying OTP.
**Request Payload:**
```json
{
  "tripId": "uuid",
  "otp": "123456"
}
```
**Acknowledgement Response:** `{ "success": true, "data": {} }`

### 9. `trip:complete`
Complete the trip.
**Request Payload:** `{ "tripId": "uuid" }`
**Acknowledgement Response:** `{ "success": true, "data": {} }`

### 10. `driver:heartbeat`
Ping the server to keep presence alive (avoid disconnect timeout).
**Request Payload:** `{}`
**Acknowledgement Response:** `{ "success": true }`

---

## 🧑‍💼 Customer Application Socket Events

Customers emit these events to the server and receive an Acknowledgement response via callback.

### 1. `booking:track`
Subscribe to live driver location updates for a specific booking.
**Request Payload:** `{ "bookingId": "uuid" }`
**Acknowledgement Response:**
```json
{
  "success": true,
  "data": {
    "bookingId": "uuid",
    "status": "DRIVER_ARRIVING",
    "tripId": "uuid",
    "currentLocation": {
      "latitude": 19.076,
      "longitude": 72.8777,
      "heading": 180
    }
  }
}
```

### 2. `booking:untrack`
Unsubscribe from tracking.
**Request Payload:** `{ "bookingId": "uuid" }`
**Acknowledgement Response:** `{ "success": true }`

### 3. `booking:cancel`
Cancel an active booking.
**Request Payload:**
```json
{
  "bookingId": "uuid",
  "reasonCode": "DRIVER_LATE",
  "reason": "Driver is not moving"
}
```
**Acknowledgement Response:** `{ "success": true, "data": {} }`

---

## 🚨 Shared Events (Customer & Driver)

### 1. `state:sync:request`
Pull the latest state manually (crucial on socket reconnect).
**Request Payload:** `{}`
**Acknowledgement Response:**
```json
{
  "success": true,
  "data": {
    "customer": { "activeBooking": { /* ... */ } },
    "driver": { "availability": "ONLINE_AVAILABLE", "assignedBooking": null }
  }
}
```

### 2. `sos:create`
Trigger SOS alert.
**Request Payload:**
```json
{
  "bookingId": "uuid",
  "latitude": 19.076,
  "longitude": 72.8777,
  "message": "I feel unsafe" // Optional
}
```
**Acknowledgement Response:**
```json
{
  "success": true,
  "data": { "sosId": "uuid" }
}
```

### 3. `chat:join`
Join the chat room for a booking to fetch history.
**Request Payload:** `{ "bookingId": "uuid" }`
**Acknowledgement Response (Customer):** `{ "success": true, "data": { "messages": [] } }`
**Acknowledgement Response (Driver):** `{ "success": true }`

### 4. `chat:send`
Send a message.
**Request Payload:**
```json
{
  "bookingId": "uuid",
  "message": "I am waiting at the gate",
  "clientMessageId": "uuid-local-id"
}
```
**Acknowledgement Response:**
```json
{
  "success": true,
  "data": { /* Saved message object */ }
}
```

---

## 🛠 Admin Subscribed Events (Server Push)

When Admins connect, they automatically join the `"tracking"` room and will receive these events in real-time from the backend to update their dashboard map.

1. **`admin:driver:availability-updated`**
   ```json
   { "driverId": "uuid", "availability": "ONLINE_AVAILABLE", "categoryId": "uuid" }
   ```

2. **`admin:driver:location-updated`**
   ```json
   { "driverId": "uuid", "latitude": 19.076, "longitude": 72.8777, "heading": 180, "recordedAt": "date" }
   ```

3. **`admin:trip:location-updated`**
   ```json
   { "driverId": "uuid", "tripId": "uuid", "bookingId": "uuid", "latitude": 19.076, "longitude": 72.8777, "heading": 180, "recordedAt": "date" }
   ```
