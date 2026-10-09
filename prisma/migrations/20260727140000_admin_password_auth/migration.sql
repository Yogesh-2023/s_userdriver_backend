-- Admin authentication credentials are isolated from profile serialization.
CREATE TABLE "AdminCredential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "adminId" UUID NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminCredential_adminId_key"
ON "AdminCredential"("adminId");

ALTER TABLE "AdminCredential"
ADD CONSTRAINT "AdminCredential_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing login-history data while supporting email identifiers.
ALTER TABLE "LoginHistory"
ADD COLUMN "identifier" VARCHAR(320);

UPDATE "LoginHistory"
SET "identifier" = "phone"
WHERE "identifier" IS NULL;

ALTER TABLE "LoginHistory"
ALTER COLUMN "identifier" SET NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL;

CREATE INDEX "LoginHistory_identifier_createdAt_idx"
ON "LoginHistory"("identifier", "createdAt");
