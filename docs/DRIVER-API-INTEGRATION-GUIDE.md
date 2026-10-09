# Driver API - Complete End-to-End Integration Guide

> **Auto-generated from Postman Collection:** `Taxi/docs/postman/Fleet-Management-Driver-APIs.postman_collection.json`

---

## API Reference


## 30 - Driver Authentication


### Request OTP

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/auth/request-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Request Body:**
```json
{
  "mobile": "{{driverMobile}}"
}
```

---

### Send OTP (Canonical)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/auth/send-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Request Body:**
```json
{
  "mobile": "{{driverMobile}}"
}
```

---

### Verify OTP

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/auth/verify-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Request Body:**
```json
{
  "mobile": "{{driverMobile}}",
  "otp": "{{otp}}",
  "deviceId": "456"
}
```

### Example Responses

<details>
<summary><b>First-time driver</b> (Status: 200 OK)</summary>

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": null
}
```
</details>

<details>
<summary><b>Returning driver with saved profile</b> (Status: 200 OK)</summary>

```json
{
  "success": true,
  "message": "Logged in successfully",
  "data": {
    "driverId": "a83b5cea-e762-4935-9c6f-ecacce562a2e",
    "isNewDriver": false,
    "isProfileCompleted": true,
    "kycStatus": "NOT_SUBMITTED",
    "vehicleApproved": false,
    "documentsValid": false,
    "accountStatus": "ACTIVE",
    "availability": "OFFLINE",
    "canGoOnline": false,
    "hasActiveBooking": false,
    "activeBooking": null,
    "nextStep": "SUBMIT_KYC",
    "profile": {
      "fullName": "Driver Name",
      "phoneNumber": "+919800000000",
      "email": "driver@example.com",
      "profileImage": "https://example.com/driver.jpg",
      "gender": "MALE",
      "dateOfBirth": "1995-01-01",
      "preferredLanguage": "en",
      "address": {
        "addressLine1": "Address line",
        "addressLine2": null,
        "city": "Delhi",
        "state": "Delhi",
        "postalCode": "110001",
        "country": "India"
      },
      "createdAt": "2026-07-29",
      "updatedAt": "2026-07-29"
    }
  }
}
```
</details>

---

### Resend OTP

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/auth/resend-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Request Body:**
```json
{
  "mobile": "{{driverMobile}}"
}
```

---

### Get Session Me

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/auth/me`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Auth Session (Canonical)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/auth/session`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### List Sessions

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/auth/sessions`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Revoke Session

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/driver/auth/sessions/{{sessionId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Delete Driver Account (Canonical)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/driver/auth/account`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Logout

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/auth/logout`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Logout All Sessions

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/auth/logout-all`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 31 - Driver Profile & Onboarding


### Create or Complete Driver Profile

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/profile`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "fullName": "Driver Bob",
  "email": "driverbob@example.com",
  "dateOfBirth": "1990-01-01",
  "gender": "MALE",
  "profileImageUrl": "https://cdn.example.com/driver/profile.jpg",
  "addressLine1": "Main St",
  "city": "Delhi",
  "state": "Delhi",
  "postalCode": "110001",
  "country": "India",
  "drivingLicenseNumber": "DL999999",
  "drivingLicenseIssueDate": "2015-01-01",
  "drivingLicenseExpiryDate": "2035-01-01",
  "drivingExperienceYears": 8,
  "emergencyContactName": "Brother",
  "emergencyContactPhone": "+919999999998",
  "emergencyContactRelation": "SIBLING"
}
```

---

### Get Driver Profile

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/profile`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Update Driver Profile

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/driver/profile`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "fullName": "Driver Bob Updated"
}
```

---

### Get Onboarding Status

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/onboarding-status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Onboarding Status (Canonical)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/onboarding/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Account Status

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/account/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Profile Image Upload URL

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/profile/image/upload-url`

**Headers:**
| Key | Value |
|---|---|
| x-csrf-token | {{driverCsrfToken}} |

**Request Body (FormData):**
| Key | Type | Value |
|---|---|---|
| profileImage | file |  |

---

### Get Profile Image Upload URL (Canonical)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/profile/image`

**Headers:**
| Key | Value |
|---|---|
| x-csrf-token | {{driverCsrfToken}} |

**Request Body (FormData):**
| Key | Type | Value |
|---|---|---|
| profileImage | file |  |

---

### Delete Profile Image

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/driver/profile/image`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 32 - Driver KYC


### Get KYC Status

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/kyc/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get KYC Details

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/kyc/details`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Submit KYC (Canonical)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/kyc`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Submit KYC

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/kyc/submit`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Reupload Rejected KYC Document

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/kyc/reupload`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "documentId": "{{driverDocumentId}}",
  "contentType": "image/jpeg",
  "sizeBytes": 500000
}
```

---

## 33 - Driver Documents


### List Documents

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/documents`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### List Expiring Documents

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/documents/expiring?withinDays=30`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Document

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/documents/{{driverDocumentId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Upload KYC Document

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/documents/upload-url`

**Headers:**
| Key | Value |
|---|---|
| x-csrf-token | {{driverCsrfToken}} |

**Request Body (FormData):**
| Key | Type | Value |
|---|---|---|
| DRIVING_LICENSE | file |  |
| VEHICLE_REGISTRATION | file |  |
| VEHICLE_INSURANCE | file |  |
| RESIDENCE_PROOF | file |  |
| PASSBOOK_IMAGE | file |  |
| PAN_CARD | file |  |
| COMMERCIAL_PERMIT | file |  |

---

### Reupload Document

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/documents/{{driverDocumentId}}/reupload`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "contentType": "application/pdf",
  "sizeBytes": 500000
}
```

---

## 34 - Driver Vehicle Categories


### List Categories

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/vehicle-categories`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Category Details

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/vehicle-categories/{{categoryId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 35 - Driver Vehicles


### List Vehicles

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Assigned Vehicle

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/assigned`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Create Vehicle

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "categoryId": "{{categoryId}}",
  "make": "Honda",
  "model": "City",
  "registrationNo": "UP14TEST1234",
  "year": 2021,
  "color": "White",
  "fuelType": "PETROL",
  "seatingCapacity": 4
}
```

---

### Get Vehicle Details

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/{{vehicleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Update Vehicle

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/{{vehicleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "color": "Black"
}
```

---

### Delete Vehicle

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/{{vehicleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 36 - Driver Vehicle Documents


### Get Vehicle Document Upload URL

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/{{vehicleId}}/documents/upload-url`

**Headers:**
| Key | Value |
|---|---|
| x-csrf-token | {{driverCsrfToken}} |

**Request Body (FormData):**
| Key | Type | Value |
|---|---|---|
| RC_FRONT | file |  |
| INSURANCE | file |  |

---

### List Vehicle Documents

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/{{vehicleId}}/documents`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Submit Vehicle for Verification

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/{{vehicleId}}/submit`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Get Vehicle Verification Status

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/{{vehicleId}}/verification-status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Select Active Vehicle

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/vehicles/{{vehicleId}}/select`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 37 - Driver Availability


### Get Availability

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/availability`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Availability Status

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/availability/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Set Availability Status

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/driver/availability`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "availability": "ONLINE"
}
```

---

### Go Online

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/availability/online`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Go Offline

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/availability/offline`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Pause Availability

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/availability/pause`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Resume Availability

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/availability/resume`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 38 - Driver Location


### Get Current Location

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/location/current`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Location Status

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/location/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Update Location

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/location`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "latitude": 19,
  "longitude": 72,
  "heading": 180,
  "speed": 40,
  "accuracy": 5,
  "timestamp": "{{$isoTimestamp}}"
}
```

---

## 38A - Driver Dashboard


### Get Dashboard

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/dashboard`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Statistics

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/statistics?startDate=2026-01-01&endDate=2026-12-31`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Performance

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/performance`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 39 - Driver Ride Offers


### Get Offered Booking

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/active`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Accept Ride Offer

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/accept`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "requestId": "{{dispatchOfferId}}"
}
```

---

### Reject Ride Offer

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/reject`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "requestId": "{{dispatchOfferId}}",
  "reasonCode": "TOO_FAR"
}
```

---

### Legacy Accept Offer

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/dispatch/accept`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "assignmentId": "{{dispatchOfferId}}"
}
```

---

### Legacy Reject Offer

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/dispatch/reject`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "assignmentId": "{{dispatchOfferId}}"
}
```

---

## 40 - Driver Active Booking


### List Driver Bookings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings?limit=20&offset=0`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Booking Details

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Pickup Route

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/pickup-route`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Pickup ETA

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/pickup-eta`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Cancel Assigned Ride

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/cancel`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "reason": "Vehicle mechanical failure"
}
```

---

### Report Customer No-show

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/customer-no-show`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "note": "Waited at pickup and attempted contact."
}
```

---

## 41 - Driver Pickup & Arrival


### Navigate to Pickup

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/navigate`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Arrived

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/arrived`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Arrive (Canonical)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/arrive`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 41A - Driver Communication


### Get Booking Messages

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/messages`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Send Booking Message

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/messages`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "message": "I have reached the pickup point."
}
```

---

### Request Masked Customer Call

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/call-customer`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 42 - Driver Trip OTP


### Request Start OTP

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/trips/{{tripId}}/request-start-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Verify Pickup OTP

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/pickup-otp/verify`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "otp": "{{tripOtp}}"
}
```

---

## 43 - Driver Active Trip


### Start Trip

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/trips/{{tripId}}/start`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "otp": "{{tripOtp}}"
}
```

---

### Start Trip by Booking

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/start`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Get Trip Route

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/route`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Trip Stops

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/stops`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Live Trip Status

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/live-status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Arrive at Trip Stop

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/stops/{{tripStopId}}/arrive`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Complete Trip Stop

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/stops/{{tripStopId}}/complete`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Complete Trip

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/trips/{{tripId}}/complete`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Complete Trip by Booking

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/complete`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 44 - Driver Trip History


### List Trip History

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/trip-history?limit=10`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Trip Details

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/trip-history/{{tripId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 45 - Driver Earnings


### List Earnings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/earnings?limit=20&offset=0`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Earnings Summary

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/earnings/summary`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Daily Earnings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/earnings/daily`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Weekly Earnings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/earnings/weekly`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Monthly Earnings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/earnings/monthly`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Booking Earning

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/earnings/trips/{{bookingId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Trip Earning Details

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/earnings/{{tripId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 46 - Driver Wallet & Settlements


### Get Wallet Balance

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/wallet`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Wallet Transactions

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/wallet/transactions?limit=20`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Create Wallet Top-up Order

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/wallet/add-money`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |
| x-idempotency-key | {{idempotencyKey}} |

**Request Body:**
```json
{
  "amount": 500
}
```

---

### Withdraw Wallet Balance

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/wallet/withdraw`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |
| x-idempotency-key | {{idempotencyKey}} |

**Request Body:**
```json
{
  "amount": 500,
  "payoutAccountId": "{{driverBankAccountId}}"
}
```

---

### List Withdrawals

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/wallet/withdrawals`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Withdrawal

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/wallet/withdrawals/{{driverPayoutId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Settlements History

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/settlements`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Payout Accounts

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/payout-accounts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Add Payout Account

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/payout-accounts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "accountName": "Driver Bob",
  "accountNumber": "1234567890",
  "bankCode": "IFSC0001234",
  "bankName": "Test Bank"
}
```

---

## 46A - Driver Bank Accounts


### List Bank Accounts

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bank-accounts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Add Bank Account

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bank-accounts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "accountName": "Driver Bob",
  "accountNumber": "1234567890",
  "confirmAccountNumber": "1234567890",
  "bankCode": "IFSC0001234",
  "bankName": "Test Bank"
}
```

---

### Update Bank Account

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/driver/bank-accounts/{{driverBankAccountId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "bankName": "Updated Bank"
}
```

---

### Delete Bank Account

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/driver/bank-accounts/{{driverBankAccountId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Set Default Bank Account

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/driver/bank-accounts/{{driverBankAccountId}}/default`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 46B - Driver Payouts


### Request Payout

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/payouts/request`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |
| x-idempotency-key | {{idempotencyKey}} |

**Request Body:**
```json
{
  "amount": 500,
  "payoutAccountId": "{{driverBankAccountId}}"
}
```

---

### List Payouts

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/payouts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Payout

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/payouts/{{driverPayoutId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 46C - Driver Payment


### Confirm Cash Payment

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/payment/cash-confirm`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |
| x-idempotency-key | {{idempotencyKey}} |

---

### Get Booking Payment Status

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/payment-status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 47 - Driver Incentives


### Get Incentives

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/incentives`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Active Incentives

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/incentives/active`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Incentive Progress

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/incentives/progress`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Incentives History

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/incentives/history`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 48 - Driver Ratings


### List Driver Ratings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/ratings?limit=20&offset=0`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Ratings Summary

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/ratings/summary`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Rate Customer

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/trips/{{tripId}}/rate-customer`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "rating": 5,
  "comment": "Polite customer."
}
```

---

### Rate Booking Customer

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/customer-rating`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "rating": 5,
  "comment": "Polite customer."
}
```

---

### Get Booking Customer Rating

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/customer-rating`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 49 - Driver Notifications


### List Notifications

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/notifications`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Unread Count

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/notifications/unread-count`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Mark Notification Read

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/driver/notifications/{{notificationId}}/read`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Mark All Read

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/driver/notifications/read-all`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Delete Notification

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/driver/notifications/{{notificationId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Register Device Token

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/device-tokens`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "token": "driver_device_token_123",
  "platform": "ANDROID"
}
```

---

### Delete Device Token

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/driver/device-tokens/{{driverDeviceToken}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Register Device

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/devices`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "token": "driver_device_token_456",
  "platform": "ANDROID"
}
```

---

### Delete Device

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/driver/devices/{{driverDeviceId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 50 - Driver Support


### Get Support Categories

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/support/categories`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Create Ticket

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/support/tickets`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "subject": "App Crash",
  "description": "The app crashed during navigation."
}
```

---

### Get Support Tickets

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/support/tickets`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Support Ticket

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/support/tickets/{{ticketId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Send Support Message

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/support/tickets/{{ticketId}}/messages`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "message": "Please share an update on this issue."
}
```

---

### Report Booking

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/report`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "category": "CUSTOMER_BEHAVIOUR",
  "description": "Customer behaviour issue during the trip."
}
```

---

## 51 - Driver Safety & SOS


### Raise SOS

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/safety/sos`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "tripId": "{{tripId}}",
  "latitude": 19,
  "longitude": 72,
  "message": "SOS Emergency!"
}
```

---

### Raise Booking SOS

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/sos`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "latitude": 19,
  "longitude": 72,
  "message": "SOS Emergency!"
}
```

---

### Report Safety Issue

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/report-safety-issue`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "type": "ROUTE_SAFETY",
  "description": "Unsafe obstruction on the route."
}
```

---

### Report Customer

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/report-customer`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "description": "Customer misconduct during the trip."
}
```

---

### Report Accident

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/report-accident`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "description": "Minor collision requiring safety review."
}
```

---

### Report Breakdown

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/bookings/{{bookingId}}/report-breakdown`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "description": "Vehicle engine stopped during the trip."
}
```

---

### Get SOS Details

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/safety/sos/{{sosId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Cancel SOS

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/safety/sos/{{sosId}}/cancel`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 52 - Driver Settings & Account


### Get Restrictions

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/driver/account/restrictions`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Request Data Export

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/account/data-export`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### Request Account Deletion

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/driver/account/deletion-request`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 53 - Driver Plural API Compatibility Aliases

Compatibility aliases for every singular /api/v1/driver request. These call the same backend handlers through the plural /api/v1/drivers prefix.


### 30 - Driver Authentication (/drivers alias)


#### Request OTP (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/request-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Request Body:**
```json
{
  "mobile": "{{driverMobile}}"
}
```

---

#### Send OTP (Canonical) (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/send-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Request Body:**
```json
{
  "mobile": "{{driverMobile}}"
}
```

---

#### Verify OTP (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/verify-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Request Body:**
```json
{
  "mobile": "{{driverMobile}}",
  "otp": "{{otp}}",
  "deviceId": "456"
}
```

### Example Responses

<details>
<summary><b>First-time driver</b> (Status: 200 OK)</summary>

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": null
}
```
</details>

<details>
<summary><b>Returning driver with saved profile</b> (Status: 200 OK)</summary>

```json
{
  "success": true,
  "message": "Logged in successfully",
  "data": {
    "driverId": "a83b5cea-e762-4935-9c6f-ecacce562a2e",
    "isNewDriver": false,
    "isProfileCompleted": true,
    "kycStatus": "NOT_SUBMITTED",
    "vehicleApproved": false,
    "documentsValid": false,
    "accountStatus": "ACTIVE",
    "availability": "OFFLINE",
    "canGoOnline": false,
    "hasActiveBooking": false,
    "activeBooking": null,
    "nextStep": "SUBMIT_KYC",
    "profile": {
      "fullName": "Driver Name",
      "phoneNumber": "+919800000000",
      "email": "driver@example.com",
      "profileImage": "https://example.com/driver.jpg",
      "gender": "MALE",
      "dateOfBirth": "1995-01-01",
      "preferredLanguage": "en",
      "address": {
        "addressLine1": "Address line",
        "addressLine2": null,
        "city": "Delhi",
        "state": "Delhi",
        "postalCode": "110001",
        "country": "India"
      },
      "createdAt": "2026-07-29",
      "updatedAt": "2026-07-29"
    }
  }
}
```
</details>

---

#### Resend OTP (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/resend-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Request Body:**
```json
{
  "mobile": "{{driverMobile}}"
}
```

---

#### Get Session Me (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/me`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Auth Session (Canonical) (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/session`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### List Sessions (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/sessions`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Revoke Session (Plural Alias)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/sessions/{{sessionId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Delete Driver Account (Canonical) (Plural Alias)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/account`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Logout (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/logout`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Logout All Sessions (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/auth/logout-all`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 31 - Driver Profile & Onboarding (/drivers alias)


#### Create or Complete Driver Profile (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/profile`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "fullName": "Driver Bob",
  "email": "driverbob@example.com",
  "dateOfBirth": "1990-01-01",
  "gender": "MALE",
  "profileImageUrl": "https://cdn.example.com/driver/profile.jpg",
  "addressLine1": "Main St",
  "city": "Delhi",
  "state": "Delhi",
  "postalCode": "110001",
  "country": "India",
  "drivingLicenseNumber": "DL999999",
  "drivingLicenseIssueDate": "2015-01-01",
  "drivingLicenseExpiryDate": "2035-01-01",
  "drivingExperienceYears": 8,
  "emergencyContactName": "Brother",
  "emergencyContactPhone": "+919999999998",
  "emergencyContactRelation": "SIBLING"
}
```

---

#### Get Driver Profile (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/profile`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Update Driver Profile (Plural Alias)

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/drivers/profile`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "fullName": "Driver Bob Updated"
}
```

---

#### Get Onboarding Status (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/onboarding-status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Onboarding Status (Canonical) (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/onboarding/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Account Status (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/account/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Profile Image Upload URL (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/profile/image/upload-url`

**Headers:**
| Key | Value |
|---|---|
| x-csrf-token | {{driverCsrfToken}} |

**Request Body (FormData):**
| Key | Type | Value |
|---|---|---|
| profileImage | file |  |

---

#### Get Profile Image Upload URL (Canonical) (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/profile/image`

**Headers:**
| Key | Value |
|---|---|
| x-csrf-token | {{driverCsrfToken}} |

**Request Body (FormData):**
| Key | Type | Value |
|---|---|---|
| profileImage | file |  |

---

#### Delete Profile Image (Plural Alias)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/drivers/profile/image`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 32 - Driver KYC (/drivers alias)


#### Get KYC Status (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/kyc/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get KYC Details (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/kyc/details`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Submit KYC (Canonical) (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/kyc`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Submit KYC (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/kyc/submit`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Reupload Rejected KYC Document (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/kyc/reupload`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "documentId": "{{driverDocumentId}}",
  "contentType": "image/jpeg",
  "sizeBytes": 500000
}
```

---

### 33 - Driver Documents (/drivers alias)


#### List Documents (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/documents`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### List Expiring Documents (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/documents/expiring?withinDays=30`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Document (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/documents/{{driverDocumentId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Upload KYC Document (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/documents/upload-url`

**Headers:**
| Key | Value |
|---|---|
| x-csrf-token | {{driverCsrfToken}} |

**Request Body (FormData):**
| Key | Type | Value |
|---|---|---|
| DRIVING_LICENSE | file |  |
| VEHICLE_REGISTRATION | file |  |
| VEHICLE_INSURANCE | file |  |
| RESIDENCE_PROOF | file |  |
| PASSBOOK_IMAGE | file |  |
| PAN_CARD | file |  |
| COMMERCIAL_PERMIT | file |  |

---

#### Reupload Document (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/documents/{{driverDocumentId}}/reupload`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "contentType": "application/pdf",
  "sizeBytes": 500000
}
```

---

### 34 - Driver Vehicle Categories (/drivers alias)


#### List Categories (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicle-categories`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Category Details (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicle-categories/{{categoryId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### 35 - Driver Vehicles (/drivers alias)


#### List Vehicles (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Assigned Vehicle (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/assigned`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Create Vehicle (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "categoryId": "{{categoryId}}",
  "make": "Honda",
  "model": "City",
  "registrationNo": "UP14TEST1234",
  "year": 2021,
  "color": "White",
  "fuelType": "PETROL",
  "seatingCapacity": 4
}
```

---

#### Get Vehicle Details (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/{{vehicleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Update Vehicle (Plural Alias)

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/{{vehicleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "color": "Black"
}
```

---

#### Delete Vehicle (Plural Alias)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/{{vehicleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 36 - Driver Vehicle Documents (/drivers alias)


#### Get Vehicle Document Upload URL (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/{{vehicleId}}/documents/upload-url`

**Headers:**
| Key | Value |
|---|---|
| x-csrf-token | {{driverCsrfToken}} |

**Request Body (FormData):**
| Key | Type | Value |
|---|---|---|
| RC_FRONT | file |  |
| INSURANCE | file |  |

---

#### List Vehicle Documents (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/{{vehicleId}}/documents`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Submit Vehicle for Verification (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/{{vehicleId}}/submit`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Get Vehicle Verification Status (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/{{vehicleId}}/verification-status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Select Active Vehicle (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/vehicles/{{vehicleId}}/select`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 37 - Driver Availability (/drivers alias)


#### Get Availability (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/availability`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Availability Status (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/availability/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Set Availability Status (Plural Alias)

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/drivers/availability`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "availability": "ONLINE"
}
```

---

#### Go Online (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/availability/online`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Go Offline (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/availability/offline`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Pause Availability (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/availability/pause`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Resume Availability (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/availability/resume`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 38 - Driver Location (/drivers alias)


#### Get Current Location (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/location/current`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Location Status (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/location/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Update Location (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/location`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "latitude": 19,
  "longitude": 72,
  "heading": 180,
  "speed": 40,
  "accuracy": 5,
  "timestamp": "{{$isoTimestamp}}"
}
```

---

### 38A - Driver Dashboard (/drivers alias)


#### Get Dashboard (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/dashboard`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Statistics (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/statistics?startDate=2026-01-01&endDate=2026-12-31`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Performance (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/performance`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### 39 - Driver Ride Offers (/drivers alias)


#### Get Offered Booking (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/active`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Accept Ride Offer (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/accept`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "requestId": "{{dispatchOfferId}}"
}
```

---

#### Reject Ride Offer (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/reject`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "requestId": "{{dispatchOfferId}}",
  "reasonCode": "TOO_FAR"
}
```

---

### 40 - Driver Active Booking (/drivers alias)


#### List Driver Bookings (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings?limit=20&offset=0`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Booking Details (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Pickup Route (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/pickup-route`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Pickup ETA (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/pickup-eta`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Cancel Assigned Ride (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/cancel`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "reason": "Vehicle mechanical failure"
}
```

---

#### Report Customer No-show (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/customer-no-show`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "note": "Waited at pickup and attempted contact."
}
```

---

### 41 - Driver Pickup & Arrival (/drivers alias)


#### Navigate to Pickup (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/navigate`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Arrived (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/arrived`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Arrive (Canonical) (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/arrive`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 41A - Driver Communication (/drivers alias)


#### Get Booking Messages (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/messages`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Send Booking Message (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/messages`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "message": "I have reached the pickup point."
}
```

---

#### Request Masked Customer Call (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/call-customer`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 42 - Driver Trip OTP (/drivers alias)


#### Request Start OTP (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/trips/{{tripId}}/request-start-otp`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Verify Pickup OTP (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/pickup-otp/verify`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "otp": "{{tripOtp}}"
}
```

---

### 43 - Driver Active Trip (/drivers alias)


#### Start Trip (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/trips/{{tripId}}/start`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "otp": "{{tripOtp}}"
}
```

---

#### Start Trip by Booking (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/start`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Get Trip Route (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/route`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Trip Stops (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/stops`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Live Trip Status (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/live-status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Arrive at Trip Stop (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/stops/{{tripStopId}}/arrive`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Complete Trip Stop (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/stops/{{tripStopId}}/complete`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Complete Trip (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/trips/{{tripId}}/complete`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Complete Trip by Booking (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/complete`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 44 - Driver Trip History (/drivers alias)


#### List Trip History (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/trip-history?limit=10`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Trip Details (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/trip-history/{{tripId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### 45 - Driver Earnings (/drivers alias)


#### List Earnings (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/earnings?limit=20&offset=0`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Earnings Summary (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/earnings/summary`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Daily Earnings (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/earnings/daily`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Weekly Earnings (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/earnings/weekly`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Monthly Earnings (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/earnings/monthly`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Booking Earning (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/earnings/trips/{{bookingId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Trip Earning Details (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/earnings/{{tripId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### 46 - Driver Wallet & Settlements (/drivers alias)


#### Get Wallet Balance (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/wallet`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Wallet Transactions (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/wallet/transactions?limit=20`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Create Wallet Top-up Order (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/wallet/add-money`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |
| x-idempotency-key | {{idempotencyKey}} |

**Request Body:**
```json
{
  "amount": 500
}
```

---

#### Withdraw Wallet Balance (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/wallet/withdraw`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |
| x-idempotency-key | {{idempotencyKey}} |

**Request Body:**
```json
{
  "amount": 500,
  "payoutAccountId": "{{driverBankAccountId}}"
}
```

---

#### List Withdrawals (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/wallet/withdrawals`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Withdrawal (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/wallet/withdrawals/{{driverPayoutId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Settlements History (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/settlements`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Payout Accounts (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/payout-accounts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Add Payout Account (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/payout-accounts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "accountName": "Driver Bob",
  "accountNumber": "1234567890",
  "bankCode": "IFSC0001234",
  "bankName": "Test Bank"
}
```

---

### 46A - Driver Bank Accounts (/drivers alias)


#### List Bank Accounts (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bank-accounts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Add Bank Account (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bank-accounts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "accountName": "Driver Bob",
  "accountNumber": "1234567890",
  "confirmAccountNumber": "1234567890",
  "bankCode": "IFSC0001234",
  "bankName": "Test Bank"
}
```

---

#### Update Bank Account (Plural Alias)

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/drivers/bank-accounts/{{driverBankAccountId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "bankName": "Updated Bank"
}
```

---

#### Delete Bank Account (Plural Alias)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/drivers/bank-accounts/{{driverBankAccountId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Set Default Bank Account (Plural Alias)

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/drivers/bank-accounts/{{driverBankAccountId}}/default`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 46B - Driver Payouts (/drivers alias)


#### Request Payout (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/payouts/request`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |
| x-idempotency-key | {{idempotencyKey}} |

**Request Body:**
```json
{
  "amount": 500,
  "payoutAccountId": "{{driverBankAccountId}}"
}
```

---

#### List Payouts (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/payouts`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Payout (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/payouts/{{driverPayoutId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### 46C - Driver Payment (/drivers alias)


#### Confirm Cash Payment (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/payment/cash-confirm`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |
| x-idempotency-key | {{idempotencyKey}} |

---

#### Get Booking Payment Status (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/payment-status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### 47 - Driver Incentives (/drivers alias)


#### Get Incentives (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/incentives`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Active Incentives (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/incentives/active`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Incentive Progress (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/incentives/progress`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Incentives History (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/incentives/history`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### 48 - Driver Ratings (/drivers alias)


#### List Driver Ratings (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/ratings?limit=20&offset=0`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Ratings Summary (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/ratings/summary`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Rate Customer (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/trips/{{tripId}}/rate-customer`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "rating": 5,
  "comment": "Polite customer."
}
```

---

#### Rate Booking Customer (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/customer-rating`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "rating": 5,
  "comment": "Polite customer."
}
```

---

#### Get Booking Customer Rating (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/customer-rating`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### 49 - Driver Notifications (/drivers alias)


#### List Notifications (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/notifications`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Unread Count (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/notifications/unread-count`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Mark Notification Read (Plural Alias)

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/drivers/notifications/{{notificationId}}/read`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Mark All Read (Plural Alias)

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/drivers/notifications/read-all`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Delete Notification (Plural Alias)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/drivers/notifications/{{notificationId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Register Device Token (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/device-tokens`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "token": "driver_device_token_123",
  "platform": "ANDROID"
}
```

---

#### Delete Device Token (Plural Alias)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/drivers/device-tokens/{{driverDeviceToken}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Register Device (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/devices`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "token": "driver_device_token_456",
  "platform": "ANDROID"
}
```

---

#### Delete Device (Plural Alias)

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/drivers/devices/{{driverDeviceId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 50 - Driver Support (/drivers alias)


#### Get Support Categories (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/support/categories`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Create Ticket (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/support/tickets`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "subject": "App Crash",
  "description": "The app crashed during navigation."
}
```

---

#### Get Support Tickets (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/support/tickets`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Get Support Ticket (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/support/tickets/{{ticketId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Send Support Message (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/support/tickets/{{ticketId}}/messages`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "message": "Please share an update on this issue."
}
```

---

#### Report Booking (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/report`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "category": "CUSTOMER_BEHAVIOUR",
  "description": "Customer behaviour issue during the trip."
}
```

---

### 51 - Driver Safety & SOS (/drivers alias)


#### Raise SOS (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/safety/sos`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "tripId": "{{tripId}}",
  "latitude": 19,
  "longitude": 72,
  "message": "SOS Emergency!"
}
```

---

#### Raise Booking SOS (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/sos`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "latitude": 19,
  "longitude": 72,
  "message": "SOS Emergency!"
}
```

---

#### Report Safety Issue (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/report-safety-issue`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "type": "ROUTE_SAFETY",
  "description": "Unsafe obstruction on the route."
}
```

---

#### Report Customer (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/report-customer`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "description": "Customer misconduct during the trip."
}
```

---

#### Report Accident (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/report-accident`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "description": "Minor collision requiring safety review."
}
```

---

#### Report Breakdown (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/bookings/{{bookingId}}/report-breakdown`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

**Request Body:**
```json
{
  "description": "Vehicle engine stopped during the trip."
}
```

---

#### Get SOS Details (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/safety/sos/{{sosId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Cancel SOS (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/safety/sos/{{sosId}}/cancel`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

### 52 - Driver Settings & Account (/drivers alias)


#### Get Restrictions (Plural Alias)

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/drivers/account/restrictions`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

#### Request Data Export (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/account/data-export`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

#### Request Account Deletion (Plural Alias)

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/drivers/account/deletion-request`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{driverCsrfToken}} |

---

## 65 - Admin Driver Management


### List Drivers

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Driver Details

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Update Driver Details

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "fullName": "Driver Bob"
}
```

---

### Update Driver Status

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/status`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "status": "SUSPENDED"
}
```

---

### Verify Driver Profile

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/verification`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "verificationStatus": "VERIFIED"
}
```

---

### Force Driver Offline

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/force-offline`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

---

### Get Driver Availability

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/availability`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Driver Live Location

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/live-location`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Driver Current Trip

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/current-trip`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### List Driver Sessions

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/sessions`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Logout All Driver Sessions

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/logout-all`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

---

### Assign Vehicle

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/assign-vehicle`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "vehicleId": "{{vehicleId}}"
}
```

---

### Unassign Vehicle

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/unassign-vehicle`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

---

### Get Driver Trips

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/trips`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Driver Earnings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/earnings`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Driver Ratings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/ratings`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

## 66 - Admin Driver KYC & Documents


### List Driver KYC Submissions

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/kyc?status=PENDING&page=1&limit=20`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Latest Driver KYC

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/kyc`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get KYC Submission

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/kyc/{{kycId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Start KYC Review

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/kyc/{{kycId}}/review`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

---

### Approve KYC by Submission

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/kyc/{{kycId}}/approve`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "reason": "All mandatory documents verified"
}
```

---

### Reject KYC by Submission

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/kyc/{{kycId}}/reject`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "reason": "Driving licence image is unclear",
  "documents": [
    {
      "documentType": "DRIVING_LICENSE",
      "reason": "Image is blurred"
    }
  ]
}
```

---

### Suspend Approved KYC

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/kyc/{{kycId}}/suspend`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "reason": "Compliance investigation opened"
}
```

---

### Get KYC Audit Logs

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/kyc/{{kycId}}/logs`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Review KYC Submission

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/kyc/review`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "notes": "Documents check"
}
```

---

### Approve KYC Submission

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/kyc/approve`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

---

### Reject KYC Submission

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/kyc/reject`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "rejectionReason": "Invalid license image"
}
```

---

### Get Driver Documents

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/drivers/{{driverId}}/documents`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Verify Driver Document

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/driver-documents/{{driverDocumentId}}/verification`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "status": "VERIFIED"
}
```

---

## 77 - Admin Dispatch & Rules


### Get Dispatch Settings

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/dispatch-settings`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Update Dispatch Settings

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/dispatch-settings`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "radiusMeters": 5000,
  "maxAttempts": 3,
  "timeoutSeconds": 30
}
```

---

### List Surge Rules

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/surge-rules?page=1&limit=20`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Surge Rule

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/surge-rules/{{surgeId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Create Surge Rule

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/surge-rules`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "vehicleCategoryId": "{{categoryId}}",
  "name": "Peak Hour Surge",
  "multiplier": 1.5,
  "startsAt": "2026-12-01T17:00:00.000Z",
  "endsAt": "2026-12-01T21:00:00.000Z",
  "isActive": true
}
```

---

### Update Surge Rule

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/surge-rules/{{surgeId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "multiplier": 1.75,
  "isActive": true
}
```

---

### Delete Surge Rule

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/admin/surge-rules/{{surgeId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

---

### List Cancellation Reasons

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-reasons`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Cancellation Reason

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-reasons/{{cancellationReasonId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Create Cancellation Reason

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-reasons`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "code": "DRIVER_DELAYED",
  "description": "Driver arrival was delayed",
  "type": "CUSTOMER",
  "isActive": true
}
```

---

### Update Cancellation Reason

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-reasons/{{cancellationReasonId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "description": "Driver arrival exceeded the expected time"
}
```

---

### Delete Cancellation Reason

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-reasons/{{cancellationReasonId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

---

### List Cancellation Rules

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-rules`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Get Cancellation Rule

**Method:** `GET`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-rules/{{cancellationRuleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |

---

### Create Cancellation Rule

**Method:** `POST`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-rules`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "name": "Standard Cancellation Rule",
  "description": "Standard cancellation policy",
  "vehicleCategoryId": "{{categoryId}}",
  "serviceAreaId": "{{serviceAreaId}}",
  "freeWindowMinutes": 5,
  "chargeAmount": 50,
  "driverCompensation": 25,
  "isActive": true
}
```

---

### Update Cancellation Rule

**Method:** `PATCH`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-rules/{{cancellationRuleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

**Request Body:**
```json
{
  "freeWindowMinutes": 10,
  "chargeAmount": 75
}
```

---

### Delete Cancellation Rule

**Method:** `DELETE`

**URL:** `{{baseUrl}}/api/v1/admin/cancellation-rules/{{cancellationRuleId}}`

**Headers:**
| Key | Value |
|---|---|
| Content-Type | application/json |
| x-csrf-token | {{adminCsrfToken}} |

---
