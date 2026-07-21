import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, SupervisorRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExcessiveConsumptionDetector } from './detectors/excessive-consumption.detector';
import { UnderusedEquipmentDetector } from './detectors/underused-equipment.detector';
import { InefficientRuleDetector } from './detectors/inefficient-rule.detector';
import { RepetitiveAlertDetector } from './detectors/repetitive-alert.detector';
import { DetectionCandidate, Detector } from './detectors/types';

const logger = new Logger('SupervisorAnalysisService');

@Injectable()
export class SupervisorAnalysisService {
  private detectors: Detector[];

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private excessiveConsumptionDetector: ExcessiveConsumptionDetector,
    private underusedEquipmentDetector: UnderusedEquipmentDetector,
    private inefficientRuleDetector: InefficientRuleDetector,
    private repetitiveAlertDetector: RepetitiveAlertDetector,
  ) {
    this.detectors = [
      this.excessiveConsumptionDetector,
      this.underusedEquipmentDetector,
      this.inefficientRuleDetector,
      this.repetitiveAlertDetector,
    ];
  }

  @Cron(process.env.SUPERVISOR_CRON ?? CronExpression.EVERY_DAY_AT_3AM)
  async handleCron() {
    if (process.env.SUPERVISOR_ENABLED !== 'true') return;
    await this.runAnalysis();
  }

  async runAnalysis() {
    const startedAt = Date.now();
    const run = await this.prisma.supervisorRun.create({
      data: { status: SupervisorRunStatus.RUNNING },
    });

    let buildingsScanned = 0;
    let recommendationsCreated = 0;

    try {
      const pilotBuildingIds = (process.env.SUPERVISOR_PILOT_BUILDING_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      const buildings = await this.prisma.building.findMany({
        where: pilotBuildingIds.length > 0 ? { id: { in: pilotBuildingIds } } : undefined,
      });

      for (const building of buildings) {
        buildingsScanned++;

        for (const detector of this.detectors) {
          const candidates = await detector.detect(building.id, this.prisma);

          for (const candidate of candidates) {
            const created = await this.upsertRecommendation(candidate, run.id);
            if (created) recommendationsCreated++;
          }
        }
      }

      await this.prisma.supervisorRun.update({
        where: { id: run.id },
        data: {
          status: SupervisorRunStatus.COMPLETED,
          finishedAt: new Date(),
          buildingsScanned,
          recommendationsCreated,
        },
      });

      await this.auditService.log({
        actorType: 'SYSTEM',
        action: 'SUPERVISOR_ANALYSIS_COMPLETED',
        targetType: 'SUPERVISOR_RUN',
        targetId: run.id,
        metadata: {
          recommendationsCreated,
          buildingsScanned,
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.prisma.supervisorRun.update({
        where: { id: run.id },
        data: {
          status: SupervisorRunStatus.FAILED,
          finishedAt: new Date(),
          buildingsScanned,
          recommendationsCreated,
          errorMessage,
        },
      });

      await this.auditService.log({
        actorType: 'SYSTEM',
        action: 'SUPERVISOR_ANALYSIS_FAILED',
        targetType: 'SUPERVISOR_RUN',
        targetId: run.id,
        metadata: {
          recommendationsCreated,
          buildingsScanned,
          durationMs: Date.now() - startedAt,
          error: errorMessage,
        },
      });

      logger.error(`Analyse Smart Supervisor échouée (run ${run.id})`, errorMessage);
    }

    return run.id;
  }

  /**
   * Déduplique sur (detectorKey, targetRuleId, signature des conditions/actions proposées)
   * parmi les recommandations PENDING existantes du même bâtiment.
   */
  private async upsertRecommendation(
    candidate: DetectionCandidate,
    supervisorRunId: string,
  ): Promise<boolean> {
    const signature = JSON.stringify({
      conditions: candidate.proposedConditions ?? null,
      actions: candidate.proposedActions ?? null,
    });

    const existingPending = await this.prisma.ruleRecommendation.findMany({
      where: {
        buildingId: candidate.buildingId,
        detectorKey: candidate.detectorKey,
        targetRuleId: candidate.targetRuleId ?? null,
        status: 'PENDING',
      },
    });

    const duplicate = existingPending.find(
      (existing) =>
        JSON.stringify({
          conditions: existing.proposedConditions ?? null,
          actions: existing.proposedActions ?? null,
        }) === signature,
    );

    if (duplicate) {
      await this.prisma.ruleRecommendation.update({
        where: { id: duplicate.id },
        data: { lastDetectedAt: new Date() },
      });
      return false;
    }

    await this.prisma.ruleRecommendation.create({
      data: {
        type: candidate.type,
        title: candidate.title,
        justification: candidate.justification,
        detectorKey: candidate.detectorKey,
        proposedConditions: (candidate.proposedConditions ?? undefined) as Prisma.InputJsonValue | undefined,
        proposedActions: (candidate.proposedActions ?? undefined) as Prisma.InputJsonValue | undefined,
        estimatedImpact: candidate.estimatedImpact,
        estimatedSavingsKwh: candidate.estimatedSavingsKwh ?? undefined,
        estimatedSavingsEur: candidate.estimatedSavingsEur ?? undefined,
        confidence: candidate.confidence,
        buildingId: candidate.buildingId,
        targetRuleId: candidate.targetRuleId ?? undefined,
        detectionWindowFrom: candidate.detectionWindowFrom,
        detectionWindowTo: candidate.detectionWindowTo,
        supervisorRunId,
      },
    });

    return true;
  }
}
