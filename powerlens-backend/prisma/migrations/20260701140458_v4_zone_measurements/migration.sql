-- CreateEnum
CREATE TYPE "BuildingPowerStatus" AS ENUM ('POWERED', 'LIMITED', 'CUTOFF');

-- DropForeignKey
ALTER TABLE "Channel" DROP CONSTRAINT "Channel_circuitId_fkey";

-- DropForeignKey
ALTER TABLE "EnergyMeasurement" DROP CONSTRAINT "EnergyMeasurement_circuitId_fkey";

-- DropIndex
DROP INDEX "Channel_circuitId_idx";

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "powerStatus" "BuildingPowerStatus" NOT NULL DEFAULT 'POWERED';

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "zoneId" TEXT,
ALTER COLUMN "circuitId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "EnergyMeasurement" ADD COLUMN     "zoneId" TEXT,
ALTER COLUMN "circuitId" DROP NOT NULL;

-- Backfill: rattache chaque mesure/canal historique (circuit-scoped) à la
-- zone de son circuit, pour permettre les lectures zone-scoped sur
-- l'historique pré-V4 sans perdre circuitId (conservé pour traçabilité).
UPDATE "EnergyMeasurement" em
SET "zoneId" = c."zoneId"
FROM "Circuit" c
WHERE c.id = em."circuitId" AND em."zoneId" IS NULL;

UPDATE "Channel" ch
SET "zoneId" = c."zoneId"
FROM "Circuit" c
WHERE c.id = ch."circuitId" AND ch."zoneId" IS NULL;

-- CreateIndex
CREATE INDEX "Channel_zoneId_idx" ON "Channel"("zoneId");

-- CreateIndex
CREATE INDEX "EnergyMeasurement_zoneId_measuredAt_idx" ON "EnergyMeasurement"("zoneId", "measuredAt");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "MonitoringZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyMeasurement" ADD CONSTRAINT "EnergyMeasurement_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyMeasurement" ADD CONSTRAINT "EnergyMeasurement_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "MonitoringZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
