-- Delete existing data because we are adding a NOT NULL constraint without a default
DELETE FROM "ManufacturerYear";

-- DropIndex
DROP INDEX IF EXISTS "ManufacturerYear_year_key";

-- AlterTable
ALTER TABLE "ManufacturerYear" ADD COLUMN IF NOT EXISTS "modelId" UUID NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ManufacturerYear_modelId_year_key" ON "ManufacturerYear"("modelId", "year");

-- AddForeignKey (Postgres doesn't support IF NOT EXISTS for ADD CONSTRAINT natively in a single simple command, but we can ignore duplicate constraint errors or just leave it as is. Usually foreign keys are the last to fail).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ManufacturerYear_modelId_fkey') THEN
        ALTER TABLE "ManufacturerYear" ADD CONSTRAINT "ManufacturerYear_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
