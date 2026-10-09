-- CreateEnum
CREATE TYPE "VehicleVerificationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "NotificationCampaignStatus" AS ENUM ('QUEUED', 'SCHEDULED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConfigValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupportTicketStatus" ADD VALUE 'WAITING_FOR_CUSTOMER';
ALTER TYPE "SupportTicketStatus" ADD VALUE 'ESCALATED';

-- AlterEnum
ALTER TYPE "VehicleStatus" ADD VALUE 'IN_SERVICE';

-- Preserve the legacy string priorities while moving to the constrained enum.
ALTER TABLE "SupportTicket"
ADD COLUMN "priority_new" "SupportPriority" NOT NULL DEFAULT 'MEDIUM';

UPDATE "SupportTicket"
SET "priority_new" = (
  CASE UPPER("priority")
    WHEN 'LOW' THEN 'LOW'
    WHEN 'HIGH' THEN 'HIGH'
    WHEN 'URGENT' THEN 'URGENT'
    ELSE 'MEDIUM'
  END
)::"SupportPriority";

ALTER TABLE "SupportTicket" DROP COLUMN "priority";
ALTER TABLE "SupportTicket" RENAME COLUMN "priority_new" TO "priority";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorRole" VARCHAR(50),
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "LoginHistory" ADD COLUMN     "deviceInfo" JSONB;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "campaignId" UUID;

-- AlterTable
ALTER TABLE "PricingRule" ADD COLUMN     "createdByAdminId" UUID,
ADD COLUMN     "driverAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nightCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "platformCommission" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "scope" JSONB,
ADD COLUMN     "scopeKey" VARCHAR(100) NOT NULL DEFAULT 'GLOBAL',
ADD COLUMN     "supersedesId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "managementId" UUID;

UPDATE "Session"
SET "managementId" = md5("id"::text)::uuid
WHERE "managementId" IS NULL;

ALTER TABLE "Session" ALTER COLUMN "managementId" SET NOT NULL;

-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN     "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "assignedAdminId" UUID,
ADD COLUMN     "categoryId" UUID,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN     "isRestricted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentId" UUID,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "tripId" UUID;

-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN     "group" VARCHAR(50) NOT NULL DEFAULT 'general',
ADD COLUMN     "updatedByAdminId" UUID,
ADD COLUMN     "valueType" "ConfigValueType" NOT NULL DEFAULT 'JSON';

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "fuelType" VARCHAR(40),
ADD COLUMN     "seatingCapacity" INTEGER,
ADD COLUMN     "verificationStatus" "VehicleVerificationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "CustomerStatusHistory" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "fromStatus" "UserStatus" NOT NULL,
    "toStatus" "UserStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverStatusHistory" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "fromStatus" "UserStatus" NOT NULL,
    "toStatus" "UserStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverVerificationHistory" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "fromStatus" "DriverVerificationStatus" NOT NULL,
    "toStatus" "DriverVerificationStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverVerificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleStatusHistory" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "fromStatus" "VehicleStatus" NOT NULL,
    "toStatus" "VehicleStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleVerificationHistory" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "fromStatus" "VehicleVerificationStatus" NOT NULL,
    "toStatus" "VehicleVerificationStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleVerificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCampaign" (
    "id" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "templateId" UUID,
    "initiatedByAdminId" UUID NOT NULL,
    "audience" JSONB NOT NULL,
    "channels" "NotificationChannel"[],
    "title" TEXT,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" "NotificationCampaignStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCategory" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAssignmentHistory" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "assignedToId" UUID,
    "previousAdminId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportStatusHistory" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "fromStatus" "SupportTicketStatus" NOT NULL,
    "toStatus" "SupportTicketStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettingHistory" (
    "id" UUID NOT NULL,
    "settingId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSettingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" UUID NOT NULL,
    "requestedByAdminId" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "format" VARCHAR(20) NOT NULL DEFAULT 'CSV',
    "filters" JSONB NOT NULL,
    "status" "ReportExportStatus" NOT NULL DEFAULT 'QUEUED',
    "fileKey" TEXT,
    "rowCount" INTEGER,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerStatusHistory_customerId_createdAt_idx" ON "CustomerStatusHistory"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerStatusHistory_adminId_createdAt_idx" ON "CustomerStatusHistory"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverStatusHistory_driverId_createdAt_idx" ON "DriverStatusHistory"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverStatusHistory_adminId_createdAt_idx" ON "DriverStatusHistory"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverVerificationHistory_driverId_createdAt_idx" ON "DriverVerificationHistory"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverVerificationHistory_adminId_createdAt_idx" ON "DriverVerificationHistory"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleStatusHistory_vehicleId_createdAt_idx" ON "VehicleStatusHistory"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleStatusHistory_adminId_createdAt_idx" ON "VehicleStatusHistory"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleVerificationHistory_vehicleId_createdAt_idx" ON "VehicleVerificationHistory"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleVerificationHistory_adminId_createdAt_idx" ON "VehicleVerificationHistory"("adminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_key_key" ON "NotificationTemplate"("key");

-- CreateIndex
CREATE INDEX "NotificationTemplate_channel_isActive_idx" ON "NotificationTemplate"("channel", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationCampaign_idempotencyKey_key" ON "NotificationCampaign"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationCampaign_status_scheduledAt_idx" ON "NotificationCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "NotificationCampaign_initiatedByAdminId_createdAt_idx" ON "NotificationCampaign"("initiatedByAdminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCategory_code_key" ON "SupportCategory"("code");

-- CreateIndex
CREATE INDEX "SupportCategory_isActive_name_idx" ON "SupportCategory"("isActive", "name");

-- CreateIndex
CREATE INDEX "SupportAssignmentHistory_ticketId_createdAt_idx" ON "SupportAssignmentHistory"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAssignmentHistory_assignedToId_createdAt_idx" ON "SupportAssignmentHistory"("assignedToId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportStatusHistory_ticketId_createdAt_idx" ON "SupportStatusHistory"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportStatusHistory_adminId_createdAt_idx" ON "SupportStatusHistory"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "SystemSettingHistory_settingId_createdAt_idx" ON "SystemSettingHistory"("settingId", "createdAt");

-- CreateIndex
CREATE INDEX "SystemSettingHistory_adminId_createdAt_idx" ON "SystemSettingHistory"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportExport_requestedByAdminId_createdAt_idx" ON "ReportExport"("requestedByAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportExport_status_createdAt_idx" ON "ReportExport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AdminNote_entityType_entityId_createdAt_idx" ON "AdminNote"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_campaignId_status_idx" ON "Notification"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_campaignId_userId_channel_key" ON "Notification"("campaignId", "userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_supersedesId_key" ON "PricingRule"("supersedesId");

-- Backfill a deterministic version chain for any existing historical rules.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "vehicleCategoryId", "rideType", "scopeKey"
      ORDER BY "effectiveFrom", "createdAt", "id"
    )::integer AS "ruleVersion",
    LAG("id") OVER (
      PARTITION BY "vehicleCategoryId", "rideType", "scopeKey"
      ORDER BY "effectiveFrom", "createdAt", "id"
    ) AS "previousId"
  FROM "PricingRule"
)
UPDATE "PricingRule" AS rule
SET
  "version" = ranked."ruleVersion",
  "supersedesId" = ranked."previousId"
FROM ranked
WHERE rule."id" = ranked."id";

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_vehicleCategoryId_rideType_scopeKey_version_key" ON "PricingRule"("vehicleCategoryId", "rideType", "scopeKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Session_managementId_key" ON "Session"("managementId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_createdAt_idx" ON "SupportTicket"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedAdminId_status_idx" ON "SupportTicket"("assignedAdminId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_createdByUserId_createdAt_idx" ON "SupportTicket"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_bookingId_idx" ON "SupportTicket"("bookingId");

-- CreateIndex
CREATE INDEX "SupportTicket_tripId_idx" ON "SupportTicket"("tripId");

-- CreateIndex
CREATE INDEX "SupportTicket_paymentId_idx" ON "SupportTicket"("paymentId");

-- CreateIndex
CREATE INDEX "SystemSetting_group_key_idx" ON "SystemSetting"("group", "key");

-- CreateIndex
CREATE INDEX "Vehicle_verificationStatus_status_idx" ON "Vehicle"("verificationStatus", "status");

-- AddForeignKey
ALTER TABLE "CustomerStatusHistory" ADD CONSTRAINT "CustomerStatusHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerStatusHistory" ADD CONSTRAINT "CustomerStatusHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverStatusHistory" ADD CONSTRAINT "DriverStatusHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverStatusHistory" ADD CONSTRAINT "DriverStatusHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverVerificationHistory" ADD CONSTRAINT "DriverVerificationHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverVerificationHistory" ADD CONSTRAINT "DriverVerificationHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleStatusHistory" ADD CONSTRAINT "VehicleStatusHistory_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleStatusHistory" ADD CONSTRAINT "VehicleStatusHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleVerificationHistory" ADD CONSTRAINT "VehicleVerificationHistory_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleVerificationHistory" ADD CONSTRAINT "VehicleVerificationHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "PricingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_initiatedByAdminId_fkey" FOREIGN KEY ("initiatedByAdminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SupportCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCategory" ADD CONSTRAINT "SupportCategory_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssignmentHistory" ADD CONSTRAINT "SupportAssignmentHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssignmentHistory" ADD CONSTRAINT "SupportAssignmentHistory_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssignmentHistory" ADD CONSTRAINT "SupportAssignmentHistory_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssignmentHistory" ADD CONSTRAINT "SupportAssignmentHistory_previousAdminId_fkey" FOREIGN KEY ("previousAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportStatusHistory" ADD CONSTRAINT "SupportStatusHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportStatusHistory" ADD CONSTRAINT "SupportStatusHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSettingHistory" ADD CONSTRAINT "SystemSettingHistory_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "SystemSetting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSettingHistory" ADD CONSTRAINT "SystemSettingHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_requestedByAdminId_fkey" FOREIGN KEY ("requestedByAdminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
