CREATE TABLE "AdminSupportMessageRead" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "adminId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminSupportMessageRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminSupportMessageRead_adminId_messageId_key"
  ON "AdminSupportMessageRead"("adminId", "messageId");

CREATE INDEX "AdminSupportMessageRead_adminId_readAt_idx"
  ON "AdminSupportMessageRead"("adminId", "readAt");

CREATE INDEX "AdminSupportMessageRead_messageId_idx"
  ON "AdminSupportMessageRead"("messageId");

ALTER TABLE "AdminSupportMessageRead"
  ADD CONSTRAINT "AdminSupportMessageRead_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminSupportMessageRead"
  ADD CONSTRAINT "AdminSupportMessageRead_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
