-- ============================================================
-- Migration: v3_zone_hierarchy
-- Purpose: Replace Room with generic MonitoringZone entity to
--   support 3-level supervision hierarchy (Building/Corridor/Room).
--   Adds CircuitType, extends EnergyMeasurement, introduces Channel
--   catalog table.
-- Data preservation: Room IDs are reused as MonitoringZone IDs
--   (no Circuit.zoneId remapping needed). Circuits previously
--   without a Room are attached to a synthetic BUILDING-type zone.
-- Destructive: DROP TABLE "Room" — fully justified because all rows
--   are migrated to "MonitoringZone" with identical IDs above.
-- ============================================================

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('BUILDING', 'CORRIDOR', 'ROOM');

-- CreateEnum
CREATE TYPE "CircuitType" AS ENUM ('LIGHTING', 'SOCKET', 'HVAC', 'FAN');

-- CreateTable MonitoringZone
CREATE TABLE "MonitoringZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ZoneType" NOT NULL,
    "floor" INTEGER,
    "buildingId" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringZone_pkey" PRIMARY KEY ("id")
);

-- Data migration: migrate existing Room rows -> MonitoringZone (preserving IDs)
INSERT INTO "MonitoringZone" ("id", "name", "type", "floor", "buildingId", "parentId", "createdAt")
SELECT "id", "name", 'ROOM'::"ZoneType", "floor", "buildingId", NULL, NOW()
FROM "Room";

-- Data migration: create one BUILDING-type zone per existing Building
-- (used to host circuits that had no roomId)
INSERT INTO "MonitoringZone" ("id", "name", "type", "floor", "buildingId", "parentId", "createdAt")
SELECT gen_random_uuid(), "name" || ' - Global', 'BUILDING'::"ZoneType", NULL, "id", NULL, NOW()
FROM "Building";

-- AddColumn Circuit.type (nullable first to allow backfill)
ALTER TABLE "Circuit" ADD COLUMN "type" "CircuitType";

-- Data migration: backfill Circuit.type from name heuristic
UPDATE "Circuit" SET "type" = 'LIGHTING'::"CircuitType"
  WHERE LOWER("name") SIMILAR TO '%(lampe|lumiere|lumière|eclairage|éclairage|light|lighting)%';

UPDATE "Circuit" SET "type" = 'HVAC'::"CircuitType"
  WHERE "type" IS NULL AND LOWER("name") SIMILAR TO '%(clim|climatisation|air conditionn|hvac|chauffage)%';

UPDATE "Circuit" SET "type" = 'FAN'::"CircuitType"
  WHERE "type" IS NULL AND LOWER("name") SIMILAR TO '%(brasseur|ventil|fan|ventilateur)%';

-- Default remaining (prise/socket or unknown) to SOCKET
UPDATE "Circuit" SET "type" = 'SOCKET'::"CircuitType" WHERE "type" IS NULL;

-- Make Circuit.type NOT NULL
ALTER TABLE "Circuit" ALTER COLUMN "type" SET NOT NULL;

-- AddColumn Circuit.zoneId (nullable first to allow backfill)
ALTER TABLE "Circuit" ADD COLUMN "zoneId" TEXT;

-- Data migration: circuits with a roomId -> use the MonitoringZone with same ID
UPDATE "Circuit" SET "zoneId" = "roomId" WHERE "roomId" IS NOT NULL;

-- Data migration: circuits without roomId -> attach to their building's BUILDING-type zone
-- (found via Device.buildingId since Circuit.deviceId is always set)
UPDATE "Circuit" c
SET "zoneId" = mz."id"
FROM "Device" d
JOIN "MonitoringZone" mz ON mz."buildingId" = d."buildingId" AND mz."type" = 'BUILDING'
WHERE c."deviceId" = d."id"
  AND c."zoneId" IS NULL;

-- Make Circuit.zoneId NOT NULL
ALTER TABLE "Circuit" ALTER COLUMN "zoneId" SET NOT NULL;

-- Drop old Room FK on Circuit before removing the column and table
ALTER TABLE "Circuit" DROP CONSTRAINT IF EXISTS "Circuit_roomId_fkey";
ALTER TABLE "Circuit" DROP COLUMN "roomId";

-- Drop Room FK from Room.buildingId before dropping the table
ALTER TABLE "Room" DROP CONSTRAINT IF EXISTS "Room_buildingId_fkey";
DROP TABLE "Room";

-- AddForeignKey MonitoringZone -> Building
ALTER TABLE "MonitoringZone" ADD CONSTRAINT "MonitoringZone_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey MonitoringZone self-referential (parentId)
ALTER TABLE "MonitoringZone" ADD CONSTRAINT "MonitoringZone_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "MonitoringZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey Circuit -> MonitoringZone
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "MonitoringZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable EnergyMeasurement: add new nullable measurement columns
ALTER TABLE "EnergyMeasurement"
  ADD COLUMN "frequency"   DOUBLE PRECISION,
  ADD COLUMN "powerFactor" DOUBLE PRECISION,
  ADD COLUMN "luminosity"  DOUBLE PRECISION,
  ADD COLUMN "presence"    BOOLEAN,
  ADD COLUMN "temperature" DOUBLE PRECISION;

-- CreateTable Channel (catalog of measurement channels per circuit)
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "mqttTopic" TEXT,
    "circuitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- Data migration: seed Channel rows for every existing circuit
-- Base electrical channels for all circuits
INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'voltage',     'V',    c."id" FROM "Circuit" c;

INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'current',     'A',    c."id" FROM "Circuit" c;

INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'power',       'W',    c."id" FROM "Circuit" c;

INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'energy',      'kWh',  c."id" FROM "Circuit" c;

INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'frequency',   'Hz',   c."id" FROM "Circuit" c;

INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'powerFactor', '',     c."id" FROM "Circuit" c;

-- Environmental channels for LIGHTING and all circuits in ROOM zones (luminosity, presence)
INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'luminosity', 'lux', c."id"
FROM "Circuit" c
WHERE c."type" = 'LIGHTING';

INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'presence', 'bool', c."id"
FROM "Circuit" c
JOIN "MonitoringZone" mz ON mz."id" = c."zoneId"
WHERE mz."type" = 'ROOM';

-- Temperature channel only for circuits in ROOM zones
INSERT INTO "Channel" ("id", "type", "unit", "circuitId")
SELECT gen_random_uuid(), 'temperature', '°C', c."id"
FROM "Circuit" c
JOIN "MonitoringZone" mz ON mz."id" = c."zoneId"
WHERE mz."type" = 'ROOM';

-- AddForeignKey Channel -> Circuit
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_circuitId_fkey"
  FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Index for Channel lookups
CREATE INDEX "Channel_circuitId_idx" ON "Channel"("circuitId");
