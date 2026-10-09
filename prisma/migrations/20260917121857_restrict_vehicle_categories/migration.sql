/*
  Warnings:

  - Changed the type of `name` on the `VehicleCategory` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "VehicleCategoryName" AS ENUM ('SEDAN', 'SUV', 'SAWARIYAA_XL');

-- Data Migration: Standardize and merge VehicleCategory names to match the Enum
DO $$ 
DECLARE 
  cat RECORD;
  merge_target_id UUID;
  fallback_id UUID;
  allowed_names TEXT[] := ARRAY['SEDAN', 'SUV', 'SAWARIYAA_XL'];
  fallback_name TEXT := 'SEDAN';
BEGIN
  -- First ensure fallback SEDAN exists
  SELECT id INTO fallback_id FROM "VehicleCategory" WHERE UPPER(name) = fallback_name LIMIT 1;
  IF fallback_id IS NULL THEN
    INSERT INTO "VehicleCategory" (id, name, "isActive", "createdAt", "updatedAt") 
    VALUES (gen_random_uuid(), fallback_name, true, NOW(), NOW()) RETURNING id INTO fallback_id;
  END IF;

  FOR cat IN SELECT * FROM "VehicleCategory" LOOP
    IF UPPER(cat.name) = ANY(allowed_names) THEN
      IF cat.name != UPPER(cat.name) THEN
        -- Check if uppercase already exists
        SELECT id INTO merge_target_id FROM "VehicleCategory" WHERE name = UPPER(cat.name) AND id != cat.id LIMIT 1;
        IF merge_target_id IS NOT NULL THEN
          -- Merge into existing uppercase
          DELETE FROM "PricingRule" WHERE "vehicleCategoryId" = cat.id;
          DELETE FROM "SurgePricingRule" WHERE "vehicleCategoryId" = cat.id;
          UPDATE "Vehicle" SET "categoryId" = merge_target_id WHERE "categoryId" = cat.id;
          UPDATE "Booking" SET "vehicleCategoryId" = merge_target_id WHERE "vehicleCategoryId" = cat.id;
          UPDATE "Coupon" SET "categoryId" = merge_target_id WHERE "categoryId" = cat.id;
          DELETE FROM "VehicleCategory" WHERE id = cat.id;
        ELSE
          -- Safe to rename
          UPDATE "VehicleCategory" SET name = UPPER(cat.name) WHERE id = cat.id;
        END IF;
      END IF;
    ELSE
      -- Merge this invalid category into fallback_id
      -- Delete conflicting PricingRules and SurgePricingRules
      DELETE FROM "PricingRule" WHERE "vehicleCategoryId" = cat.id;
      DELETE FROM "SurgePricingRule" WHERE "vehicleCategoryId" = cat.id;
      
      -- Move other dependencies
      UPDATE "Vehicle" SET "categoryId" = fallback_id WHERE "categoryId" = cat.id;
      UPDATE "Booking" SET "vehicleCategoryId" = fallback_id WHERE "vehicleCategoryId" = cat.id;
      UPDATE "Coupon" SET "categoryId" = fallback_id WHERE "categoryId" = cat.id;
      
      -- Finally, delete the invalid category
      DELETE FROM "VehicleCategory" WHERE id = cat.id;
    END IF;
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "VehicleCategory" ALTER COLUMN "name" TYPE "VehicleCategoryName" USING "name"::"text"::"VehicleCategoryName";

