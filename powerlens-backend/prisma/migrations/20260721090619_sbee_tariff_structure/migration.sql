-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TariffCategory" ADD VALUE 'BT1_DOMESTIC';
ALTER TYPE "TariffCategory" ADD VALUE 'BT3_PUBLIC';

-- AlterTable
ALTER TABLE "TariffPlan" ADD COLUMN     "fixedChargeDFcfa" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "taxEFcfa" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "taxFFcfa" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.18;
