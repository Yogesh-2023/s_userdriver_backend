-- CreateEnum
CREATE TYPE "SosRequesterType" AS ENUM ('USER', 'DRIVER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "SosStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "SosStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "SosRequest" ADD COLUMN "assignedAdminId" UUID,
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "locationUpdatedAt" TIMESTAMP(3),
ADD COLUMN "priority" "SupportPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "requesterType" "SosRequesterType" NOT NULL DEFAULT 'USER',
ADD COLUMN "resolution" TEXT,
ADD COLUMN "sosNumber" VARCHAR(16);

-- Backfill unique SOS numbers for existing alerts (collision-safe base36 suffix)
DO $$
DECLARE
  s RECORD;
  candidate VARCHAR(16);
  taken BOOLEAN;
  attempts INT;
BEGIN
  FOR s IN SELECT "id" FROM "SosRequest" WHERE "sosNumber" IS NULL LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      candidate := 'S' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
      SELECT EXISTS(
        SELECT 1 FROM "SosRequest" WHERE "sosNumber" = candidate AND "id" <> s."id"
      ) INTO taken;
      EXIT WHEN NOT taken OR attempts >= 10;
    END LOOP;
    UPDATE "SosRequest" SET "sosNumber" = candidate WHERE "id" = s."id";
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "SosRequest" ALTER COLUMN "sosNumber" SET NOT NULL;

-- Align SupportMessageRead id default drift (Prisma uuid() default is client-side)
ALTER TABLE "SupportMessageRead" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "EmergencySosMessage" (
    "id" UUID NOT NULL,
    "sosId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencySosMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosUserMessageRead" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sosRequestId" UUID NOT NULL,

    CONSTRAINT "SosUserMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosAdminMessageRead" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sosRequestId" UUID NOT NULL,

    CONSTRAINT "SosAdminMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmergencySosMessage_sosId_createdAt_idx" ON "EmergencySosMessage"("sosId", "createdAt");

-- CreateIndex
CREATE INDEX "SosUserMessageRead_userId_readAt_idx" ON "SosUserMessageRead"("userId", "readAt");

-- CreateIndex
CREATE INDEX "SosUserMessageRead_messageId_idx" ON "SosUserMessageRead"("messageId");

-- CreateIndex
CREATE INDEX "SosUserMessageRead_sosRequestId_userId_readAt_idx" ON "SosUserMessageRead"("sosRequestId", "userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "SosUserMessageRead_userId_messageId_key" ON "SosUserMessageRead"("userId", "messageId");

-- CreateIndex
CREATE INDEX "SosAdminMessageRead_adminId_readAt_idx" ON "SosAdminMessageRead"("adminId", "readAt");

-- CreateIndex
CREATE INDEX "SosAdminMessageRead_messageId_idx" ON "SosAdminMessageRead"("messageId");

-- CreateIndex
CREATE INDEX "SosAdminMessageRead_sosRequestId_adminId_readAt_idx" ON "SosAdminMessageRead"("sosRequestId", "adminId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "SosAdminMessageRead_adminId_messageId_key" ON "SosAdminMessageRead"("adminId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "SosRequest_sosNumber_key" ON "SosRequest"("sosNumber");

-- CreateIndex
CREATE INDEX "SosRequest_createdByUserId_createdAt_idx" ON "SosRequest"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SosRequest_requesterType_status_idx" ON "SosRequest"("requesterType", "status");

-- CreateIndex
CREATE INDEX "SosRequest_assignedAdminId_status_idx" ON "SosRequest"("assignedAdminId", "status");

-- CreateIndex
CREATE INDEX "SosRequest_priority_status_createdAt_idx" ON "SosRequest"("priority", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "SosRequest" ADD CONSTRAINT "SosRequest_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencySosMessage" ADD CONSTRAINT "EmergencySosMessage_sosId_fkey" FOREIGN KEY ("sosId") REFERENCES "SosRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencySosMessage" ADD CONSTRAINT "EmergencySosMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosUserMessageRead" ADD CONSTRAINT "SosUserMessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosUserMessageRead" ADD CONSTRAINT "SosUserMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmergencySosMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosUserMessageRead" ADD CONSTRAINT "SosUserMessageRead_sosRequestId_fkey" FOREIGN KEY ("sosRequestId") REFERENCES "SosRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAdminMessageRead" ADD CONSTRAINT "SosAdminMessageRead_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAdminMessageRead" ADD CONSTRAINT "SosAdminMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmergencySosMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAdminMessageRead" ADD CONSTRAINT "SosAdminMessageRead_sosRequestId_fkey" FOREIGN KEY ("sosRequestId") REFERENCES "SosRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;