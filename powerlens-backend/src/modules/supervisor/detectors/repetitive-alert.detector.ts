import { Injectable } from '@nestjs/common';
import { RecommendationConfidence } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RuleCondition } from '../../rules/rules-engine.service';
import { Detector, DetectionCandidate } from './types';

const ANALYSIS_WINDOW_DAYS = 90;
const ALERT_COUNT_THRESHOLD = 20;
const THRESHOLD_ADJUSTMENT_FACTOR = 1.15;

interface RepetitiveAlertGroup {
  ruleId: string | null;
  message: string;
  count: bigint;
}

@Injectable()
export class RepetitiveAlertDetector implements Detector {
  async detect(buildingId: string, prisma: PrismaService): Promise<DetectionCandidate[]> {
    const now = new Date();
    const from = new Date(now.getTime() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const groups = await prisma.$queryRaw<RepetitiveAlertGroup[]>`
      SELECT "ruleId", "message", COUNT(*) AS "count"
      FROM "Alert"
      WHERE "buildingId" = ${buildingId}
        AND "createdAt" >= ${from}
      GROUP BY "ruleId", "message"
      HAVING COUNT(*) > ${ALERT_COUNT_THRESHOLD}
    `;

    if (groups.length === 0) return [];

    const candidates: DetectionCandidate[] = [];

    for (const group of groups) {
      if (!group.ruleId) continue;

      const rule = await prisma.rule.findUnique({ where: { id: group.ruleId } });
      if (!rule || !rule.isActive || rule.ruleType !== 'THRESHOLD') continue;

      const conditions = rule.conditions as unknown as RuleCondition;
      if (conditions?.type !== 'THRESHOLD') continue;

      const count = Number(group.count);
      const adjustedValue = conditions.value * THRESHOLD_ADJUSTMENT_FACTOR;
      const proposedConditions: RuleCondition = {
        ...conditions,
        value: adjustedValue,
      };

      candidates.push({
        type: 'MODIFY_RULE',
        title: `Ajustement du seuil de la règle "${rule.name}" (alertes répétitives)`,
        justification: `L'alerte "${group.message}" liée à la règle "${rule.name}" a été générée ${count} fois au cours des ${ANALYSIS_WINDOW_DAYS} derniers jours (> ${ALERT_COUNT_THRESHOLD}). Proposition : augmenter le seuil de ${conditions.value} à ${adjustedValue.toFixed(2)} (+${((THRESHOLD_ADJUSTMENT_FACTOR - 1) * 100).toFixed(0)}%) pour réduire la fréquence des alertes.`,
        detectorKey: 'REPETITIVE_ALERT',
        proposedConditions,
        proposedActions: rule.actions as unknown as any,
        estimatedImpact: `Réduction du nombre d'alertes répétitives générées par la règle "${rule.name}"`,
        estimatedSavingsKwh: null,
        estimatedSavingsEur: null,
        confidence: RecommendationConfidence.MEDIUM,
        targetRuleId: rule.id,
        buildingId,
        detectionWindowFrom: from,
        detectionWindowTo: now,
      });
    }

    return candidates;
  }
}
