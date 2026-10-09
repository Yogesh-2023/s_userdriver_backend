-- DropForeignKey
ALTER TABLE "Vehicle" DROP CONSTRAINT "Vehicle_categoryId_fkey";

-- AlterTable
ALTER TABLE "Vehicle" ALTER COLUMN "categoryId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
