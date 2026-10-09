# Mobile App Socket Integration Guide (Customer & Driver)

This guide provides step-by-step instructions for integrating the robust `socket.io-client` with the NodeJS backend in your React Native or Flutter mobile applications.

The backend uses a state-of-the-art implementation featuring connection resilience, session validation, presence pinging, and offline queuing. It is critical that the mobile apps implement their side correctly to ensure a fully End-to-End production-grade architecture.

---

## Step 1: Install Socket.io Client

### For React Native
```bash
npm install socket.io-client
```

### For Flutter
Add the `socket_io_client` dependency in your `pubspec.yaml`.

---

## Step 2: Establish Connection & Handle Authentication

The backend uses Fastify Signed Cookies for authentication (`withCredentials: true`). You must ensure that the HTTP client (Axios, Fetch, etc.) maintains the session cookie, and that the Socket connection sends it along.

### React Native Implementation
Create a global Socket context/provider.

```typescript
import { io, Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../config';

export const useSocketConnection = () => {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const socketInstance = io(API_BASE_URL, {
      path: '/socket.io',
      transports: ['websocket'],
      withCredentials: true, // IMPORTANT: Sends session cookies
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketInstance.on('connect', () => {
      console.log('Socket Connected:', socketInstance.id);
    });

    socketInstance.on('socket:ready', (data) => {
      console.log('Socket Ready - Roles:', data.roles);
    });

    socketInstance.on('connect_error', (error) => {
      if (error.message.includes('SOCKET_UNAUTHENTICATED')) {
        // Trigger Logout / Redirect to Login
      }
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  return socket;
};
```

---

## Step 3: State Sync on Reconnect (CRITICAL)

Mobile networks are patchy. If the user drives through a tunnel, the socket disconnects. When they reconnect, they might have missed important events (e.g., driver arrived, booking cancelled). 

To solve this, **always emit `state:sync:request` whenever the socket reconnects.**

```typescript
useEffect(() => {
  if (!socket) return;

  socket.io.on("reconnect", () => {
    console.log("Reconnected to socket server. Fetching missing events...");
    
    // Acknowledge callback gives us the current accurate state
    socket.emit("state:sync:request", {}, (response) => {
      if (response?.success) {
        const state = response.data;
        // Update your Zustand/Redux store with this state
        // For driver: state.driver.activeTrip, state.driver.activeOffers
        // For customer: state.customer.activeBooking, state.customer.latestDriverLocation
      }
    });
  });
}, [socket]);
```

---

## Step 4: Driver Heartbeat (Driver App Only)

The backend has a background BullMQ job (`scheduleDisconnectCheck`) that runs a grace period when a driver disconnects. If the driver app doesn't reconnect or maintain its presence, the driver is forced offline. 
To prevent this when the app is backgrounded, send periodic heartbeats.

```typescript
useEffect(() => {
  if (!socket || !isDriverOnline) return;

  const interval = setInterval(() => {
    // Emits a heartbeat every 30 seconds to refresh the presence TTL in Redis
    socket.emit("driver:heartbeat", {}, (response) => {
      if (!response?.success) {
        console.error("Heartbeat failed");
      }
    });
  }, 30000); 

  return () => clearInterval(interval);
}, [socket, isDriverOnline]);
```

---

## Step 5: Handling Event Acknowledgements

Every socket emission in the backend is wrapped in `safeSocketHandler` and returns an acknowledgement object. **Never fire-and-forget critical actions.**

Example: Accepting a dispatch offer.
```typescript
const acceptRideOffer = (offerId: string) => {
  socket.emit("dispatch:accept", { offerId }, (response) => {
    if (response.success) {
      console.log("Offer accepted successfully", response.data);
      // Navigate to tracking screen
    } else {
      console.error("Error accepting offer:", response.error.code);
      // Show toast: "Too slow, another driver accepted it" or similar
    }
  });
};
```

---

## Step 6: Location Updates (Driver App)

Driver location should be emitted frequently when online or on a trip. The backend will handle throttling and broadcasting it to the Customer and Admin dashboards.

```typescript
import Geolocation from '@react-native-community/geolocation';

useEffect(() => {
  if (!socket || !isOnline) return;

  const watchId = Geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, heading, speed, accuracy } = position.coords;
      
      socket.emit("driver:location:update", {
        latitude,
        longitude,
        heading,
        speed,
        accuracy,
        timestamp: new Date(position.timestamp).toISOString(),
        tripId: currentTripId, // Pass tripId if currently on a trip
      });
    },
    (error) => console.log(error),
    { enableHighAccuracy: true, distanceFilter: 10, interval: 5000 }
  );

  return () => Geolocation.clearWatch(watchId);
}, [socket, isOnline, currentTripId]);
```

---

## Common Error Codes to Handle

You should globally listen for these error codes in the `response.error.code` of your acknowledgements:
- `SOCKET_UNAUTHENTICATED`: Session token expired/invalid. Redirect to Login.
- `SOCKET_RATE_LIMITED`: The user is clicking a button too fast. Show a "Please wait" toast.
- `SOCKET_INVALID_PAYLOAD`: The payload validation failed (Zod schema mismatch). Check your payload structure against the backend handlers.
- `BOOKING_NOT_FOUND`: The booking doesn't exist or doesn't belong to the user.
