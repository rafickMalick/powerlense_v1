-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "zoneId" TEXT;

-- CreateIndex
CREATE INDEX "Alert_zoneId_createdAt_idx" ON "Alert"("zoneId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_acknowledged_buildingId_idx" ON "Alert"("acknowledged", "buildingId");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "MonitoringZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
