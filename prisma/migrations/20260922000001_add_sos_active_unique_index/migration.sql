-- One active SOS per requester per booking (DB-level duplicate protection).
-- Runs in its own transaction after the new SosStatus enum values are committed.
CREATE UNIQUE INDEX "SosRequest_single_active_per_requester_booking"
  ON "SosRequest"("createdByUserId", "bookingId")
  WHERE "status" IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS');