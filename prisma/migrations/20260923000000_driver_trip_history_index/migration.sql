-- CreateIndex
CREATE INDEX "Trip_driverId_status_createdAt_idx" ON "Trip"("driverId", "status", "createdAt");
