-- AlterTable
ALTER TABLE "SupportCategory" ALTER COLUMN "createdByAdminId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN "ticketNumber" VARCHAR(16);

-- Backfill unique ticket numbers for existing tickets (collision-safe base36 suffix)
DO $$
DECLARE
  t RECORD;
  candidate VARCHAR(16);
  taken BOOLEAN;
  attempts INT;
BEGIN
  FOR t IN SELECT "id" FROM "SupportTicket" WHERE "ticketNumber" IS NULL LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      candidate := '#' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
      SELECT EXISTS(
        SELECT 1 FROM "SupportTicket" WHERE "ticketNumber" = candidate AND "id" <> t."id"
      ) INTO taken;
      EXIT WHEN NOT taken OR attempts >= 10;
    END LOOP;
    UPDATE "SupportTicket" SET "ticketNumber" = candidate WHERE "id" = t."id";
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "SupportTicket" ALTER COLUMN "ticketNumber" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");

-- CreateTable
CREATE TABLE "SupportMessageRead" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessageRead_userId_messageId_key"
  ON "SupportMessageRead"("userId", "messageId");

CREATE INDEX "SupportMessageRead_userId_readAt_idx"
  ON "SupportMessageRead"("userId", "readAt");

CREATE INDEX "SupportMessageRead_messageId_idx"
  ON "SupportMessageRead"("messageId");

-- AddForeignKey
ALTER TABLE "SupportMessageRead" ADD CONSTRAINT "SupportMessageRead_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportMessageRead" ADD CONSTRAINT "SupportMessageRead_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;