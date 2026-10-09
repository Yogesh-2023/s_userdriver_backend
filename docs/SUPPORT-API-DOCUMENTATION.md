# Support / Raise Ticket — API Documentation

Complete reference for the Help & Support / Raise Ticket module across the three surfaces of the `Taxi` backend:

- **Customer app (Flutter)** → `/api/v1/customer/support/...`
- **Driver app (Flutter)** → `/api/v1/driver/support/...`
- **Admin panel (tuktuk-admin)** → `/api/v1/admin/support/...` and `/api/v1/admin/tickets/...`
- **Generic (any logged-in user)** → `/api/v1/support/...`

Base URL (local): `http://localhost:5000` · API prefix: `/api/v1`
All responses use the standard envelope: `{ "success": true, "message": "...", "data": ..., "meta": { page, limit, total, totalPages }? }`

---

## 1. Authentication & headers

| Surface | Auth | CSRF |
|---|---|---|
| Customer / Driver | Session cookie (set after OTP login) | Writes require `x-csrf-token` header (`guards(true)`) |
| Admin | `Authorization: Bearer <admin-token>` + session | Writes also send `x-csrf-token` |
| Generic `/api/v1/support` | Session cookie only | Not required (plain `requireSession`) |

CSRF tokens are returned on login/OTP responses and the backend rotates them; mobile clients must read the header from auth responses and echo it back on mutating requests.

---

## 2. Customer endpoints — `/api/v1/customer/support`

### 2.1 List support categories
`GET /api/v1/customer/support/categories`

```bash
curl -s http://localhost:5000/api/v1/customer/support/categories -H "Cookie: $SESSION"
```

Response `data` (array):
```json
[{ "id": "uuid", "code": "GENERAL", "name": "General", "description": "General queries" }]
```

### 2.2 Create ticket
`POST /api/v1/customer/support/tickets`  (auth + CSRF)

Body — `categoryId` **optional** (falls back to auto-created `GENERAL`); `subject` OR `title` required; at most 5 attachments (each `{ url, name? }`) or a single URL string via `attachmentUrl`.

```bash
curl -s -X POST http://localhost:5000/api/v1/customer/support/tickets \
  -H "Cookie: $SESSION" -H "x-csrf-token: $CSRF" -H "Content-Type: application/json" \
  -d '{
    "subject": "Refund for ride rejected",
    "description": "My last trip was charged twice.",
    "bookingId": "00000000-0000-0000-0000-000000000000",
    "attachments": [{ "url": "https://cdn.example/photo.jpg", "name": "photo.jpg" }]
  }'
```

Response `data`:
```json
{
  "id": "uuid", "ticketNumber": "#A8K2M9",
  "title": "Refund for ride rejected", "subject": "Refund for ride rejected",
  "description": "My last trip was charged twice.", "status": "OPEN", "priority": "MEDIUM",
  "category": "General", "categoryId": "uuid", "attachments": [{ "url": "...", "name": "photo.jpg" }],
  "bookingId": "uuid", "tripId": null, "paymentId": null,
  "createdAt": "2026-09-21T10:00:00.000Z", "updatedAt": "2026-09-21T10:00:00.000Z"
}
```

Errors: 400 (validation), 404 (`Support category not found`), 403 (booking/trip/payment access denied).

### 2.3 List my tickets (paginated)
`GET /api/v1/customer/support/tickets?page=1&limit=20`

Response `meta`: `{ page, limit, total, totalPages }`. Each item includes `unreadMessages` (messages from support not yet read).

### 2.4 Upload an attachment
`POST /api/v1/customer/support/attachments` (auth + CSRF, `multipart/form-data`)
- Prefix rules: JPEG/PNG/WebP image or PDF, max 5 MB.
```bash
curl -s -X POST http://localhost:5000/api/v1/customer/support/attachments \
  -H "Cookie: $SESSION" -H "x-csrf-token: $CSRF" \
  -F "attachment=@screenshot.png;type=image/png"
```
Response `data`:
```json
{ "url": "http://localhost:5000/images/support-attachments/<uuid>/<uuid>.png",
  "name": "screenshot.png", "key": "support-attachments/<uuid>/<uuid>.png",
  "contentType": "image/png", "sizeBytes": 12345 }
```
Then pass the returned `url` (and optional `name`) into `attachments` when creating a ticket/message.

### 2.5 Ticket detail
`GET /api/v1/customer/support/tickets/:ticketId`

The `data` includes `customer`, `unreadMessages`, and ordered `messages[]`:
```json
{
  "id": "uuid", "ticketNumber": "#A8K2M9", "status": "OPEN", "...": "...",
  "unreadMessages": 2,
  "customer": { "id": "uuid", "displayName": "Ravi", "phone": "+919999999999" },
  "messages": [{
    "id": "uuid", "ticketId": "uuid", "senderId": "uuid", "senderType": "USER" | "SUPPORT",
    "message": "...", "attachments": null,
    "createdAt": "2026-09-21T10:00:00.000Z", "updatedAt": "2026-09-21T10:00:00.000Z"
  }]
}
```
Internal admin notes are never exposed here.

### 2.6 List messages only
`GET /api/v1/customer/support/tickets/:ticketId/messages` → `data` is the `messages[]` array (same shape).

### 2.7 Send a message
`POST /api/v1/customer/support/tickets/:ticketId/messages` (auth + CSRF)
Body: `{ "message": "string (1..4000)", "attachments": [...], "attachmentUrl": "url?" }`.
Fails with 409 on `RESOLVED`/`CLOSED` tickets (`Cannot send messages to a resolved ticket`).
Emits realtime event `support:message` to room `ticket:{ticketId}`.

### 2.8 Mark my messages read
`PATCH /api/v1/customer/support/tickets/:ticketId/messages/read` (auth + CSRF)
Response `data`: `{ "markedRead": 3, "unreadCount": 0 }`.

### 2.9 Close / mark completed
`POST /api/v1/customer/support/tickets/:ticketId/close` (auth + CSRF)
Response `data`: `{ "success": true }`.

---

## 3. Driver endpoints — `/api/v1/driver/support`

Same semantics (ownership scoped to driver account):
- `GET  /support/categories`
- `POST /support/tickets` — body `{ categoryId?, subject, description, bookingId?, attachments? }`
- `GET  /support/tickets?page=&limit=`
- `GET  /support/tickets/:ticketId`
- `GET  /support/tickets/:ticketId/messages` — message thread (driver-visible only)
- `POST /support/tickets/:ticketId/messages` — `{ message, attachments? }`
- `PATCH /support/tickets/:ticketId/messages/read` — mark my messages as read
- `POST /support/attachments` — multipart upload (jpg/png/webp/pdf ≤ 10MB), returns `{ url, name, key }`
- `POST /support/tickets/:ticketId/close` — close ticket (owner)

---

## 4. Generic (any authenticated user) — `/api/v1/support`

- `POST /support/tickets` — schema requires `categoryId` (uuid), `subject` (3..160), `message` (1..10000), optionals `bookingId`, `tripId`, `paymentId`, `attachments[]` (key+name, max 10).
- `GET  /support/tickets?page=&limit=` → paginated list (envelope meta).
- `GET  /support/tickets/:ticketId` → detail **including** internal messages (raw thread).
- `POST /support/tickets/:ticketId/reply` — `{ message, attachments? }` (adds to thread).

---

## 5. Admin endpoints — `/api/v1/admin/support` (and aliases under `/api/v1/admin/tickets`)

Permissions: `support:read`, `support:reply`, `support:close`, `support:assign` (via RBAC guards).

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/support/tickets?page&limit&search&status&priority&assignedAdminId&requesterType&from&to` | List tickets (admin-scoped visibility). `requesterType` = `USER`/`DRIVER`; `from`/`to` = ISO dates filter `createdAt`. Aliases: `/admin/tickets`, `/admin/tickets/search?q=`, `/admin/tickets/filter` |
| GET | `/admin/support/tickets/:ticketId` | Full detail incl. messages + createdBy. Alias `/admin/tickets/:ticketId` |
| POST | `/admin/support/tickets` · Alias `/admin/tickets` | Create ticket for a user (`{ userId, categoryId, title, description, priority }`) |
| PUT | `/admin/support/tickets/:ticketId` | Update `title/description/categoryId/priority` |
| DELETE | `/admin/support/tickets/:ticketId` | Delete ticket |
| POST | `/admin/support/tickets/:ticketId/reply` | Agent reply `{ message }` (`support:reply`) |
| PATCH | `/admin/support/tickets/:ticketId/status` | `{ status, reason }` — valid transitions below |
| PATCH | `/admin/support/tickets/:ticketId/priority` | `{ priority, reason }` |
| POST | `/admin/support/tickets/:ticketId/assign` | `{ adminId, reason? }` (advisory lock; records history) |
| POST | `/admin/support/tickets/:ticketId/escalate` | `{ reason }` → status `ESCALATED` |
| POST | `/admin/support/tickets/:ticketId/internal-note` | Internal note (not visible to user) |
| PATCH | `/admin/tickets/:ticketId/close` · `/open` | Close/reopen |
| GET | `/admin/support/tickets/statistics` | Grouped counts by status & priority |
| GET | `/admin/support/tickets/export` | Raw CSV/export rows |
| GET | `/admin/support/inbox?page&limit` | Sequential support message inbox (admin read-tracking) |
| GET | `/admin/support/inbox/unread-count` | `{ unreadCount }` |
| PATCH | `/admin/support/inbox/:messageId/read` · `/inbox/read-all` | Mark admin-read |
| GET | `/admin/support/categories` · POST · PATCH `/:categoryId` | Category CRUD (`{ code, name, description?, isActive }`) |

**Status transitions (stored in `SupportStatusHistory`):**
`OPEN→{IN_PROGRESS,WAITING_FOR_CUSTOMER,RESOLVED,ESCALATED}` · `IN_PROGRESS→{WAITING_FOR_CUSTOMER,RESOLVED,ESCALATED}` · `WAITING_FOR_CUSTOMER→{IN_PROGRESS,RESOLVED,ESCALATED}` · `RESOLVED→{CLOSED,IN_PROGRESS}` · `CLOSED→{}` · `ESCALATED→{IN_PROGRESS,RESOLVED,CLOSED}`.

**Admin reply (cURL):**
```bash
curl -s -X POST http://localhost:5000/api/v1/admin/support/tickets/<ticketId>/reply \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "x-csrf-token: $CSRF" -H "Content-Type: application/json" \
  -d '{"message": "We have refunded the charge. Please check."}'
```

**Admin detail response (`data`)** includes list shape for the admin UI:
```json
{
  "id": "uuid", "ticketNumber": "#A8K2M9", "subject": "...", "category": "General",
  "priority": "HIGH", "status": "IN_PROGRESS", "createdAt": "...", "updatedAt": "...",
  "createdByUserId": "uuid",
  "createdBy": {
    "id": "uuid", "displayName": "Ravi", "phone": "+919999999999", "email": null,
    "customerProfile": { "id": "uuid" }, "driverProfile": null, "adminProfile": null
  },
  "assignedAdmin": { "id": "uuid", "title": "Support Lead", "user": { "id": "uuid", "displayName": "Anita" } },
  "categoryDefinition": { "id": "uuid", "name": "General" },
  "messages": [{
    "id": "uuid", "senderUserId": "uuid", "message": "...", "isInternal": false, "attachments": null,
    "createdAt": "...", "sender": { "id": "uuid", "displayName": "Anita", "adminProfile": { "id": "uuid" } }
  }],
  "assignmentHistory": [], "statusHistory": []
}
```
The admin UI derives `userType` from which of `customerProfile/driverProfile/adminProfile` is present, and message `senderRole = AGENT` when `sender.adminProfile` exists.

---

## 6. Schema changes (Prisma)

- `SupportTicket.ticketNumber String @unique @db.VarChar(16)` — `#XXXXXX` generated by `src/modules/support/ticket-number.ts` (`generateTicketNumber`), collision-safe via `withUniqueTicketNumber` (retry on P2002).
- New `SupportMessageRead` (`@@unique([userId, messageId])`) — user-side read/unread. Admin tracking already used `AdminSupportMessageRead`.
- `SupportCategory.createdByAdminId` now nullable so system-seeded defaults have no admin owner.
- Default categories seeded at startup (`src/main.ts` → `ensureSupportCategories`): `GENERAL`, `PAYMENT`, `RIDE_ISSUE`, `TECHNICAL`, `OTHER`. Upsert is idempotent.
- Migration: `prisma/migrations/20260921000000_add_support_ticket_number_and_user_reads`.

## 7. Realtime (Socket.IO)

- Event `support:join` (`{ ticketId: uuid }`, client → server): verifies ownership, joins room `ticket:{ticketId}`. Implemented for customer (`customer.handler.ts`) and driver (`driver.handler.ts`).
- Room `ticket:{ticketId}` broadcasts:
  - `support:message` — new message payload (from `CustomerSupportService.createMessage`, `AdminSupportService` emits `support:ticket-updated`)
  - `support:ticket-updated` — status/assignment changes (`AdminSupportService.emit`)
- Other rooms: `user:{userId}` (per-user), `admin:support` (admin room) with `admin:support:ticket-created` / `admin:support:ticket-updated`.

## 8. Attachment storage

`storage.ts → uploadSupportAttachment(ownerId, contentType, body, filename)`:
- Allowed: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`; max 5 MB.
- Local driver writes to `.uploads/support-attachments/{ownerId}/{uuid}.{ext}` served under `/images/...`; S3 branch is present but disabled.
- Attachments are stored as JSON on the first ticket message / each chat message (`SupportMessage.attachments`), normalized to `[{ url, name }]` (max 5 per create, 10 per generic reply).

## 9. Notes / contract

- `ticketNumber` is generated server-side; clients must not send it.
- Customer & driver write endpoints require CSRF header; the mobile client must capture and replay the CSRF token from auth responses.
- `listTickets` item shape (customer/driver): `{ id, ticketNumber, title, subject, description, status, priority, category, categoryId, attachments, bookingId, tripId, paymentId, createdAt, updatedAt, unreadMessages }`.
- Resolved/closed tickets reject user messages (409); admin replies only blocked on `CLOSED`.
- Admin list visibibility: super admin sees all; others see `isRestricted=false` OR tickets assigned to them.