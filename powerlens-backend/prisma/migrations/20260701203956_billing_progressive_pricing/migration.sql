-- AlterTable
ALTER TABLE "BillingRecord" ADD COLUMN     "growthCoefficientFcfa" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TariffPlan" ADD COLUMN     "growthCoefficientFcfa" DOUBLE PRECISION NOT NULL DEFAULT 0;
