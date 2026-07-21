-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('CREATE_RULE', 'MODIFY_RULE', 'DELETE_RULE');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED');

-- CreateEnum
CREATE TYPE "RecommendationConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SupervisorRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Circuit" ADD COLUMN     "isCritical" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RuleRecommendation" (
    "id" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "title" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "detectorKey" TEXT NOT NULL,
    "proposedConditions" JSONB,
    "proposedActions" JSONB,
    "estimatedImpact" TEXT NOT NULL,
    "estimatedSavingsKwh" DOUBLE PRECISION,
    "estimatedSavingsEur" DOUBLE PRECISION,
    "confidence" "RecommendationConfidence" NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "author" TEXT NOT NULL DEFAULT 'AI',
    "buildingId" TEXT NOT NULL,
    "targetRuleId" TEXT,
    "appliedRuleId" TEXT,
    "approverId" TEXT,
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "detectionWindowFrom" TIMESTAMP(3) NOT NULL,
    "detectionWindowTo" TIMESTAMP(3) NOT NULL,
    "supervisorRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "RuleRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SupervisorRunStatus" NOT NULL DEFAULT 'RUNNING',
    "buildingsScanned" INTEGER NOT NULL DEFAULT 0,
    "recommendationsCreated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "SupervisorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleRecommendation_buildingId_status_idx" ON "RuleRecommendation"("buildingId", "status");

-- CreateIndex
CREATE INDEX "RuleRecommendation_status_createdAt_idx" ON "RuleRecommendation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RuleRecommendation_targetRuleId_idx" ON "RuleRecommendation"("targetRuleId");

-- CreateIndex
CREATE INDEX "SupervisorRun_startedAt_idx" ON "SupervisorRun"("startedAt");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX "Alert_buildingId_createdAt_idx" ON "Alert"("buildingId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_targetType_createdAt_idx" ON "AuditLog"("action", "targetType", "createdAt");

-- AddForeignKey
ALTER TABLE "RuleRecommendation" ADD CONSTRAINT "RuleRecommendation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleRecommendation" ADD CONSTRAINT "RuleRecommendation_targetRuleId_fkey" FOREIGN KEY ("targetRuleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleRecommendation" ADD CONSTRAINT "RuleRecommendation_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleRecommendation" ADD CONSTRAINT "RuleRecommendation_supervisorRunId_fkey" FOREIGN KEY ("supervisorRunId") REFERENCES "SupervisorRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
