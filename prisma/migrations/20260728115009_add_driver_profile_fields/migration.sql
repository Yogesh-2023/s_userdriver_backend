-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "EmergencyContactRelation" AS ENUM ('PARENT', 'SPOUSE', 'SIBLING', 'FRIEND', 'RELATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "NavigationPreference" AS ENUM ('GOOGLE_MAPS', 'APPLE_MAPS', 'IN_APP');

-- CreateEnum
CREATE TYPE "DriverOnboardingStatus" AS ENUM ('ACCOUNT_CREATED', 'PROFILE_PENDING', 'PROFILE_COMPLETED', 'KYC_PENDING', 'KYC_UNDER_REVIEW', 'KYC_APPROVED', 'VEHICLE_PENDING', 'VEHICLE_UNDER_REVIEW', 'READY_TO_DRIVE', 'REJECTED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "drivingExperienceYears" INTEGER,
ADD COLUMN     "drivingLicenseExpiryDate" DATE,
ADD COLUMN     "drivingLicenseIssueDate" DATE,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "emergencyContactRelation" "EmergencyContactRelation",
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "navigationPreference" "NavigationPreference",
ADD COLUMN     "onboardingStatus" "DriverOnboardingStatus" NOT NULL DEFAULT 'ACCOUNT_CREATED',
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "preferredLanguage" TEXT,
ADD COLUMN     "serviceAreaId" UUID,
ADD COLUMN     "state" TEXT;
