-- This migration supports both a clean migration history and installations
-- where DispatchCycle/DispatchOffer were previously introduced with db push.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DriverAssignmentStatus') THEN
    CREATE TYPE "DriverAssignmentStatus" AS ENUM (
      'OFFERED', 'ACCEPTED', 'REJECTED', 'TIMED_OUT',
      'ACTIVE', 'COMPLETED', 'RELEASED', 'CANCELLED'
    );
  ELSE
    ALTER TYPE "DriverAssignmentStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
    ALTER TYPE "DriverAssignmentStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
    ALTER TYPE "DriverAssignmentStatus" ADD VALUE IF NOT EXISTS 'RELEASED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchCycleStatus') THEN
    CREATE TYPE "DispatchCycleStatus" AS ENUM (
      'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchOfferStatus') THEN
    CREATE TYPE "DispatchOfferStatus" AS ENUM (
      'OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'INVALIDATED'
    );
  END IF;
END $$;

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "assignedDriverId" UUID,
  ADD COLUMN IF NOT EXISTS "assignedVehicleId" UUID;

ALTER TABLE "Trip"
  ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "DispatchCycle" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "cycleNumber" INTEGER NOT NULL DEFAULT 1,
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "radiusMeters" INTEGER NOT NULL,
  "status" "DispatchCycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "failureReason" VARCHAR(100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DispatchCycle_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DispatchCycle"
  ADD COLUMN IF NOT EXISTS "cycleNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failureReason" VARCHAR(100);

ALTER TABLE "DispatchCycle" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "DispatchCycle"
  ALTER COLUMN "status" TYPE "DispatchCycleStatus"
  USING ("status"::text::"DispatchCycleStatus");
ALTER TABLE "DispatchCycle" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "bookingId" ORDER BY "createdAt", "id"
    )::integer AS cycle_number
  FROM "DispatchCycle"
)
UPDATE "DispatchCycle" AS cycle
SET "cycleNumber" = ranked.cycle_number
FROM ranked
WHERE cycle."id" = ranked."id";

CREATE TABLE IF NOT EXISTS "DispatchOffer" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "dispatchCycleId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "DispatchOfferStatus" NOT NULL DEFAULT 'OFFERED',
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "rejectionReason" VARCHAR(100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DispatchOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriverAssignment" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "dispatchOfferId" UUID,
  "batchNo" INTEGER,
  "status" "DriverAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" VARCHAR(100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverAssignment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DriverAssignment"
  ALTER COLUMN "batchNo" DROP NOT NULL,
  ALTER COLUMN "expiresAt" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "dispatchOfferId" UUID,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "releaseReason" VARCHAR(100);

UPDATE "DriverAssignment"
SET
  "status" = 'ACTIVE',
  "assignedAt" = COALESCE("respondedAt", "offeredAt", "createdAt")
WHERE "status"::text = 'ACCEPTED';

ALTER TABLE "DriverAssignment" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP INDEX IF EXISTS "DriverAssignment_bookingId_driverId_key";
DROP INDEX IF EXISTS "DispatchOffer_bookingId_driverId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "DispatchCycle_bookingId_cycleNumber_key"
  ON "DispatchCycle"("bookingId", "cycleNumber");
CREATE INDEX IF NOT EXISTS "DispatchCycle_bookingId_status_createdAt_idx"
  ON "DispatchCycle"("bookingId", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "DispatchOffer_dispatchCycleId_driverId_key"
  ON "DispatchOffer"("dispatchCycleId", "driverId");
CREATE INDEX IF NOT EXISTS "DispatchOffer_bookingId_status_idx"
  ON "DispatchOffer"("bookingId", "status");
CREATE INDEX IF NOT EXISTS "DispatchOffer_driverId_status_idx"
  ON "DispatchOffer"("driverId", "status");
CREATE INDEX IF NOT EXISTS "DispatchOffer_dispatchCycleId_idx"
  ON "DispatchOffer"("dispatchCycleId");
CREATE UNIQUE INDEX IF NOT EXISTS "DriverAssignment_dispatchOfferId_key"
  ON "DriverAssignment"("dispatchOfferId");
CREATE INDEX IF NOT EXISTS "DriverAssignment_bookingId_status_idx"
  ON "DriverAssignment"("bookingId", "status");
CREATE INDEX IF NOT EXISTS "DriverAssignment_driverId_status_idx"
  ON "DriverAssignment"("driverId", "status");
CREATE INDEX IF NOT EXISTS "DriverAssignment_vehicleId_status_idx"
  ON "DriverAssignment"("vehicleId", "status");
CREATE INDEX IF NOT EXISTS "Booking_assignedDriverId_status_idx"
  ON "Booking"("assignedDriverId", "status");
CREATE INDEX IF NOT EXISTS "Booking_assignedVehicleId_status_idx"
  ON "Booking"("assignedVehicleId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_assignedDriverId_fkey') THEN
    ALTER TABLE "Booking" ADD CONSTRAINT "Booking_assignedDriverId_fkey"
      FOREIGN KEY ("assignedDriverId") REFERENCES "DriverProfile"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_assignedVehicleId_fkey') THEN
    ALTER TABLE "Booking" ADD CONSTRAINT "Booking_assignedVehicleId_fkey"
      FOREIGN KEY ("assignedVehicleId") REFERENCES "Vehicle"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DispatchCycle_bookingId_fkey') THEN
    ALTER TABLE "DispatchCycle" ADD CONSTRAINT "DispatchCycle_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DispatchOffer_bookingId_fkey') THEN
    ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DispatchOffer_dispatchCycleId_fkey') THEN
    ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_dispatchCycleId_fkey"
      FOREIGN KEY ("dispatchCycleId") REFERENCES "DispatchCycle"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DispatchOffer_driverId_fkey') THEN
    ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DispatchOffer_vehicleId_fkey') THEN
    ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverAssignment_bookingId_fkey') THEN
    ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverAssignment_driverId_fkey') THEN
    ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverAssignment_vehicleId_fkey') THEN
    ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverAssignment_dispatchOfferId_fkey') THEN
    ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_dispatchOfferId_fkey"
      FOREIGN KEY ("dispatchOfferId") REFERENCES "DispatchOffer"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

