-- DropForeignKey
ALTER TABLE "SupportCategory" DROP CONSTRAINT "SupportCategory_createdByAdminId_fkey";

-- AddForeignKey
ALTER TABLE "SupportCategory" ADD CONSTRAINT "SupportCategory_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
