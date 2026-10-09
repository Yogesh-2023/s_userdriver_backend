/*
  Warnings:

  - You are about to drop the column `capacity` on the `VehicleCategory` table. All the data in the column will be lost.
  - You are about to drop the column `code` on the `VehicleCategory` table. All the data in the column will be lost.
  - You are about to drop the column `maxSeatingCapacity` on the `VehicleCategory` table. All the data in the column will be lost.
  - You are about to drop the column `minSeatingCapacity` on the `VehicleCategory` table. All the data in the column will be lost.
  - You are about to drop the column `sortOrder` on the `VehicleCategory` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[subscriptionId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name]` on the table `VehicleCategory` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SubscriptionDurationType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'FAILED', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "SubscriptionTripType" AS ENUM ('LIMITED', 'UNLIMITED');

-- AlterEnum
ALTER TYPE "DriverVerificationStatus" ADD VALUE 'UNDER_REVIEW';

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_bookingId_fkey";

-- DropIndex
DROP INDEX "User_status_idx";

-- DropIndex
DROP INDEX "VehicleCategory_code_key";

-- DropIndex
DROP INDEX "VehicleCategory_isActive_sortOrder_idx";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "bookingFor" JSONB,
ADD COLUMN     "luggageCount" INTEGER,
ADD COLUMN     "passengerCount" INTEGER,
ADD COLUMN     "specialRequirements" TEXT[];

-- AlterTable
ALTER TABLE "FareBreakdown" ADD COLUMN     "parkingCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tipAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "subscriptionId" UUID,
ALTER COLUMN "bookingId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ScheduledBooking" ADD COLUMN     "activationAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "dispatchStartedAt" TIMESTAMP(3),
ADD COLUMN     "lastRescheduledAt" TIMESTAMP(3),
ADD COLUMN     "recoveryAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reminderAt" TIMESTAMP(3),
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ServiceZone" ADD COLUMN     "demandLevel" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "subscriptionPlanId" UUID;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "parkingCharges" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tipAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tollCharges" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VehicleCategory" DROP COLUMN "capacity",
DROP COLUMN "code",
DROP COLUMN "maxSeatingCapacity",
DROP COLUMN "minSeatingCapacity",
DROP COLUMN "sortOrder",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "iconUrl" TEXT,
ADD COLUMN     "maxPassengers" INTEGER,
ADD COLUMN     "minPassengers" INTEGER;

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "durationType" "SubscriptionDurationType" NOT NULL,
    "durationValue" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "tripType" "SubscriptionTripType" NOT NULL,
    "numberOfTrips" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoRenewAllowed" BOOLEAN NOT NULL DEFAULT false,
    "gstOrTax" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverSubscription" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "priceAtPurchase" DECIMAL(12,2) NOT NULL,
    "taxAtPurchase" DECIMAL(12,2) NOT NULL,
    "remainingTrips" INTEGER,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "senderType" VARCHAR(20) NOT NULL,
    "senderId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgePricingLog" (
    "id" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "multiplier" DECIMAL(4,2) NOT NULL,
    "demandScore" INTEGER NOT NULL,
    "supplyScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgePricingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalPackage" (
    "id" UUID NOT NULL,
    "vehicleCategoryId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "hours" INTEGER NOT NULL,
    "distanceKm" INTEGER NOT NULL,
    "basePrice" DECIMAL(12,2) NOT NULL,
    "extraKmRate" DECIMAL(12,2) NOT NULL,
    "extraHourRate" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutstationPricing" (
    "id" UUID NOT NULL,
    "vehicleCategoryId" UUID NOT NULL,
    "roundTripPerKm" DECIMAL(12,2) NOT NULL,
    "oneWayPerKm" DECIMAL(12,2) NOT NULL,
    "driverAllowancePerDay" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutstationPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleMaintenance" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleInsurance" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "policyNo" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_SubscriptionPlanToVehicleCategory" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_SubscriptionPlanToVehicleCategory_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "DriverSubscription_driverId_status_idx" ON "DriverSubscription"("driverId", "status");

-- CreateIndex
CREATE INDEX "DriverSubscription_expiryDate_idx" ON "DriverSubscription"("expiryDate");

-- CreateIndex
CREATE INDEX "ChatMessage_bookingId_createdAt_idx" ON "ChatMessage"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "SurgePricingLog_zoneId_createdAt_idx" ON "SurgePricingLog"("zoneId", "createdAt");

-- CreateIndex
CREATE INDEX "_SubscriptionPlanToVehicleCategory_B_index" ON "_SubscriptionPlanToVehicleCategory"("B");

-- CreateIndex
CREATE INDEX "Booking_createdAt_idx" ON "Booking"("createdAt");

-- CreateIndex
CREATE INDEX "DriverProfile_verificationStatus_createdAt_idx" ON "DriverProfile"("verificationStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_subscriptionId_key" ON "Payment"("subscriptionId");

-- CreateIndex
CREATE INDEX "Refund_status_processedAt_idx" ON "Refund"("status", "processedAt");

-- CreateIndex
CREATE INDEX "Trip_status_completedAt_idx" ON "Trip"("status", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCategory_name_key" ON "VehicleCategory"("name");

-- CreateIndex
CREATE INDEX "VehicleCategory_isActive_displayOrder_idx" ON "VehicleCategory"("isActive", "displayOrder");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "DriverSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceZone" ADD CONSTRAINT "ServiceZone_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSubscription" ADD CONSTRAINT "DriverSubscription_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSubscription" ADD CONSTRAINT "DriverSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgePricingLog" ADD CONSTRAINT "SurgePricingLog_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ServiceZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPackage" ADD CONSTRAINT "RentalPackage_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstationPricing" ADD CONSTRAINT "OutstationPricing_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenance" ADD CONSTRAINT "VehicleMaintenance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleInsurance" ADD CONSTRAINT "VehicleInsurance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SubscriptionPlanToVehicleCategory" ADD CONSTRAINT "_SubscriptionPlanToVehicleCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SubscriptionPlanToVehicleCategory" ADD CONSTRAINT "_SubscriptionPlanToVehicleCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "VehicleCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
