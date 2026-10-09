-- AlterTable
ALTER TABLE "FareBreakdown" ADD COLUMN     "referralDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "referralId" UUID;
