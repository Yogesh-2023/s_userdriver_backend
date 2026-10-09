-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('ONE_WAY', 'RETURN');

-- CreateEnum
CREATE TYPE "TripLeg" AS ENUM ('OUTBOUND', 'RETURN');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "parentBookingId" UUID,
ADD COLUMN     "returnBookingId" UUID,
ADD COLUMN     "returnDateTime" TIMESTAMP(3),
ADD COLUMN     "tripLeg" "TripLeg",
ADD COLUMN     "tripType" "TripType" NOT NULL DEFAULT 'ONE_WAY';

-- CreateIndex
CREATE INDEX "Booking_tripType_tripLeg_idx" ON "Booking"("tripType", "tripLeg");

-- CreateIndex
CREATE INDEX "Booking_parentBookingId_idx" ON "Booking"("parentBookingId");

-- CreateIndex
CREATE INDEX "Booking_returnBookingId_idx" ON "Booking"("returnBookingId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_parentBookingId_fkey" FOREIGN KEY ("parentBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_returnBookingId_fkey" FOREIGN KEY ("returnBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
