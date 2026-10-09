-- PostgreSQL cannot use an enum label added with ALTER TYPE in the same
-- migration transaction. Convert the legacy enum ahead of the foundation
-- migration so both clean installs and drifted databases are supported.
DO $$
DECLARE
  has_active boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'DriverAssignmentStatus'
  ) THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_type type
      JOIN pg_enum value ON value.enumtypid = type.oid
      WHERE type.typname = 'DriverAssignmentStatus'
        AND value.enumlabel = 'ACTIVE'
    ) INTO has_active;

    IF NOT has_active THEN
      ALTER TYPE "DriverAssignmentStatus"
        RENAME TO "DriverAssignmentStatus_legacy";
      CREATE TYPE "DriverAssignmentStatus" AS ENUM (
        'OFFERED', 'ACCEPTED', 'REJECTED', 'TIMED_OUT',
        'ACTIVE', 'COMPLETED', 'RELEASED', 'CANCELLED'
      );
    END IF;
  ELSE
    CREATE TYPE "DriverAssignmentStatus" AS ENUM (
      'OFFERED', 'ACCEPTED', 'REJECTED', 'TIMED_OUT',
      'ACTIVE', 'COMPLETED', 'RELEASED', 'CANCELLED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'DriverAssignment'
      AND column_name = 'status'
      AND udt_name = 'DriverAssignmentStatus_legacy'
  ) THEN
    ALTER TABLE "DriverAssignment" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "DriverAssignment"
      ALTER COLUMN "status" TYPE "DriverAssignmentStatus"
      USING ("status"::text::"DriverAssignmentStatus");
    ALTER TABLE "DriverAssignment"
      ALTER COLUMN "status" SET DEFAULT 'OFFERED';
  END IF;
END $$;

DROP TYPE IF EXISTS "DriverAssignmentStatus_legacy";
