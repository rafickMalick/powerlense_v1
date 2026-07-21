-- CreateEnum
CREATE TYPE "TariffCategory" AS ENUM ('BT2_PRO');

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "tariffPlanId" TEXT;

-- CreateTable
CREATE TABLE "TariffPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TariffCategory" NOT NULL DEFAULT 'BT2_PRO',
    "pricePerKwhFcfa" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TariffPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRecord" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "tariffPlanId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalKwh" DOUBLE PRECISION NOT NULL,
    "totalCostFcfa" DOUBLE PRECISION NOT NULL,
    "pricePerKwhFcfa" DOUBLE PRECISION NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingRecord_buildingId_periodStart_idx" ON "BillingRecord"("buildingId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "BillingRecord_buildingId_periodStart_key" ON "BillingRecord"("buildingId", "periodStart");

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_tariffPlanId_fkey" FOREIGN KEY ("tariffPlanId") REFERENCES "TariffPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRecord" ADD CONSTRAINT "BillingRecord_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRecord" ADD CONSTRAINT "BillingRecord_tariffPlanId_fkey" FOREIGN KEY ("tariffPlanId") REFERENCES "TariffPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
