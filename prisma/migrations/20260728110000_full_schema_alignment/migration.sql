-- AlterTable
ALTER TABLE "AdminCredential" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "serviceAreaId" UUID;

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "categoryId" UUID,
ADD COLUMN     "newUsersOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceAreaId" UUID;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "driverId" UUID;

-- AlterTable
ALTER TABLE "VehicleCategory" ADD COLUMN     "allowedFuelTypes" TEXT[],
ADD COLUMN     "createdByAdminId" UUID,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "maxSeatingCapacity" INTEGER,
ADD COLUMN     "minSeatingCapacity" INTEGER,
ADD COLUMN     "slug" VARCHAR(80) NOT NULL DEFAULT (gen_random_uuid())::character varying,
ALTER COLUMN "capacity" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ServiceArea" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "country" VARCHAR(100) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL,
    "boundaryPolygon" JSONB NOT NULL,
    "centerLatitude" DECIMAL(10,7) NOT NULL,
    "centerLongitude" DECIMAL(10,7) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceZone" (
    "id" UUID NOT NULL,
    "serviceAreaId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "polygon" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZonePricingRule" (
    "id" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "baseFareSurge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "perKmSurge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "flatSurcharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZonePricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosActivity" (
    "id" UUID NOT NULL,
    "sosRequestId" UUID NOT NULL,
    "adminId" UUID,
    "action" VARCHAR(50) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SosActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyIncidentNote" (
    "id" UUID NOT NULL,
    "safetyIncidentId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyIncidentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentStatusHistory" (
    "id" UUID NOT NULL,
    "documentType" VARCHAR(30) NOT NULL,
    "driverDocumentId" UUID,
    "vehicleDocumentId" UUID,
    "adminId" UUID,
    "fromStatus" "DocumentStatus" NOT NULL,
    "toStatus" "DocumentStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReminder" (
    "id" UUID NOT NULL,
    "documentType" VARCHAR(30) NOT NULL,
    "driverDocumentId" UUID,
    "vehicleDocumentId" UUID,
    "remindedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "maxDiscount" DECIMAL(12,2),
    "minimumFare" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" VARCHAR(50) NOT NULL,
    "addressLine" VARCHAR(255) NOT NULL,
    "landmark" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postalCode" VARCHAR(20),
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "placeId" VARCHAR(100),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPreference" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "preferredLanguage" VARCHAR(10) NOT NULL DEFAULT 'en',
    "pushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "promotionalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rideSafetyAlerts" BOOLEAN NOT NULL DEFAULT true,
    "locationSharing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FareEstimate" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "pickupLat" DECIMAL(10,7) NOT NULL,
    "pickupLng" DECIMAL(10,7) NOT NULL,
    "dropLat" DECIMAL(10,7) NOT NULL,
    "dropLng" DECIMAL(10,7) NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "baseFare" DECIMAL(12,2) NOT NULL,
    "distanceCharge" DECIMAL(12,2) NOT NULL,
    "timeCharge" DECIMAL(12,2) NOT NULL,
    "waitingCharge" DECIMAL(12,2) NOT NULL,
    "tollEstimate" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "surgeMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "couponDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimatedFare" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "couponCode" VARCHAR(40),
    "pricingRuleId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FareEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportRequest" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "downloadUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverKycSubmission" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "DriverVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverKycSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverKycStatusHistory" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "DriverVerificationStatus" NOT NULL,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverKycStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverAvailabilityHistory" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "availability" "DriverAvailability" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverAvailabilityHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverLocationHistory" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "heading" INTEGER,
    "speed" INTEGER,
    "accuracy" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverLocationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverWallet" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverWalletTransaction" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "referenceType" VARCHAR(50) NOT NULL,
    "referenceId" UUID,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverWalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverEarning" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "grossFare" DECIMAL(12,2) NOT NULL,
    "platformCommission" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "toll" DECIMAL(12,2) NOT NULL,
    "incentive" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netEarning" DECIMAL(12,2) NOT NULL,
    "cashCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "onlineCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_SETTLEMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverSettlement" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "payoutAccountId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "referenceId" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverPayoutAccount" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "accountName" VARCHAR(100) NOT NULL,
    "accountNumber" VARCHAR(100) NOT NULL,
    "bankCode" VARCHAR(50) NOT NULL,
    "bankName" VARCHAR(100) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverPayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incentive" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(50) NOT NULL,
    "target" INTEGER NOT NULL,
    "reward" DECIMAL(12,2) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverIncentiveProgress" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "incentiveId" UUID NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverIncentiveProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverIncentiveReward" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "incentiveId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverIncentiveReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceArea_name_key" ON "ServiceArea"("name");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_isDeleted_idx" ON "CustomerAddress"("customerId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPreference_customerId_key" ON "CustomerPreference"("customerId");

-- CreateIndex
CREATE INDEX "FareEstimate_customerId_expiresAt_idx" ON "FareEstimate"("customerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverWallet_driverId_key" ON "DriverWallet"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverEarning_tripId_key" ON "DriverEarning"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverIncentiveProgress_driverId_incentiveId_key" ON "DriverIncentiveProgress"("driverId", "incentiveId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletionRequest_customerId_key" ON "AccountDeletionRequest"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCategory_slug_key" ON "VehicleCategory"("slug");

-- CreateIndex
CREATE INDEX "VehicleCategory_createdByAdminId_idx" ON "VehicleCategory"("createdByAdminId");

-- AddForeignKey
ALTER TABLE "VehicleCategory" ADD CONSTRAINT "VehicleCategory_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceZone" ADD CONSTRAINT "ServiceZone_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePricingRule" ADD CONSTRAINT "ZonePricingRule_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ServiceZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosActivity" ADD CONSTRAINT "SosActivity_sosRequestId_fkey" FOREIGN KEY ("sosRequestId") REFERENCES "SosRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosActivity" ADD CONSTRAINT "SosActivity_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncidentNote" ADD CONSTRAINT "SafetyIncidentNote_safetyIncidentId_fkey" FOREIGN KEY ("safetyIncidentId") REFERENCES "SafetyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncidentNote" ADD CONSTRAINT "SafetyIncidentNote_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentStatusHistory" ADD CONSTRAINT "DocumentStatusHistory_driverDocumentId_fkey" FOREIGN KEY ("driverDocumentId") REFERENCES "DriverDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentStatusHistory" ADD CONSTRAINT "DocumentStatusHistory_vehicleDocumentId_fkey" FOREIGN KEY ("vehicleDocumentId") REFERENCES "VehicleDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentStatusHistory" ADD CONSTRAINT "DocumentStatusHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReminder" ADD CONSTRAINT "DocumentReminder_driverDocumentId_fkey" FOREIGN KEY ("driverDocumentId") REFERENCES "DriverDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReminder" ADD CONSTRAINT "DocumentReminder_vehicleDocumentId_fkey" FOREIGN KEY ("vehicleDocumentId") REFERENCES "VehicleDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPreference" ADD CONSTRAINT "CustomerPreference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverKycSubmission" ADD CONSTRAINT "DriverKycSubmission_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverKycStatusHistory" ADD CONSTRAINT "DriverKycStatusHistory_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "DriverKycSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverKycStatusHistory" ADD CONSTRAINT "DriverKycStatusHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAvailabilityHistory" ADD CONSTRAINT "DriverAvailabilityHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLocationHistory" ADD CONSTRAINT "DriverLocationHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverWallet" ADD CONSTRAINT "DriverWallet_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverWalletTransaction" ADD CONSTRAINT "DriverWalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "DriverWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSettlement" ADD CONSTRAINT "DriverSettlement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSettlement" ADD CONSTRAINT "DriverSettlement_payoutAccountId_fkey" FOREIGN KEY ("payoutAccountId") REFERENCES "DriverPayoutAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverPayoutAccount" ADD CONSTRAINT "DriverPayoutAccount_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverIncentiveProgress" ADD CONSTRAINT "DriverIncentiveProgress_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverIncentiveProgress" ADD CONSTRAINT "DriverIncentiveProgress_incentiveId_fkey" FOREIGN KEY ("incentiveId") REFERENCES "Incentive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverIncentiveReward" ADD CONSTRAINT "DriverIncentiveReward_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverIncentiveReward" ADD CONSTRAINT "DriverIncentiveReward_incentiveId_fkey" FOREIGN KEY ("incentiveId") REFERENCES "Incentive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
