ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_idempotencyKey_key"
  ON "Notification"("idempotencyKey");
