import { Injectable } from '@nestjs/common';
import { RecommendationConfidence } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RuleCondition } from '../../rules/rules-engine.service';
import { Detector, DetectionCandidate } from './types';

const ANALYSIS_WINDOW_DAYS = 90;
const TRIGGER_COUNT_THRESHOLD = 20;
const STALE_RULE_AGE_DAYS = 180;
const THRESHOLD_ADJUSTMENT_FACTOR = 1.15;

interface TriggerCount {
  count: bigint;
}

@Injectable()
export class InefficientRuleDetector implements Detector {
  async detect(buildingId: string, prisma: PrismaService): Promise<DetectionCandidate[]> {
    const now = new Date();
    const from = new Date(now.getTime() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const staleBefore = new Date(now.getTime() - STALE_RULE_AGE_DAYS * 24 * 60 * 60 * 1000);

    const rules = await prisma.rule.findMany({
      where: {
        buildingId,
        isActive: true,
        ruleType: 'THRESHOLD',
      },
    });

    if (rules.length === 0) return [];

    const candidates: DetectionCandidate[] = [];

    for (const rule of rules) {
      const [{ count }] = await prisma.$queryRaw<TriggerCount[]>`
        SELECT COUNT(*) AS "count"
        FROM "AuditLog"
        WHERE "action" = 'SWITCH_OFF_SENT'
          AND "metadata"->>'ruleId' = ${rule.id}
          AND "createdAt" >= ${from}
      `;

      const triggerCount = Number(count);

      if (triggerCount > TRIGGER_COUNT_THRESHOLD) {
        const conditions = rule.conditions as unknown as RuleCondition;
        if (conditions?.type !== 'THRESHOLD') continue;

        const adjustedValue = conditions.value * THRESHOLD_ADJUSTMENT_FACTOR;
        const proposedConditions: RuleCondition = {
          ...conditions,
          value: adjustedValue,
        };

        candidates.push({
          type: 'MODIFY_RULE',
          title: `Ajustement du seuil de la règle "${rule.name}"`,
          justification: `La règle "${rule.name}" s'est déclenchée ${triggerCount} fois au cours des ${ANALYSIS_WINDOW_DAYS} derniers jours (> ${TRIGGER_COUNT_THRESHOLD}, soit environ ${(triggerCount / (ANALYSIS_WINDOW_DAYS / 7)).toFixed(1)} fois/semaine). Le seuil semble trop sensible. Proposition : augmenter le seuil de ${(conditions.value)} à ${adjustedValue.toFixed(2)} (+${((THRESHOLD_ADJUSTMENT_FACTOR - 1) * 100).toFixed(0)}%).`,
          detectorKey: 'INEFFICIENT_RULE',
          proposedConditions,
          proposedActions: rule.actions as unknown as any,
          estimatedImpact: `Réduction du nombre de déclenchements de la règle "${rule.name}"`,
          estimatedSavingsKwh: null,
          estimatedSavingsEur: null,
          confidence: RecommendationConfidence.MEDIUM,
          targetRuleId: rule.id,
          buildingId,
          detectionWindowFrom: from,
          detectionWindowTo: now,
        });
      } else if (triggerCount === 0 && rule.createdAt <= staleBefore) {
        candidates.push({
          type: 'DELETE_RULE',
          title: `Suppression de la règle inutilisée "${rule.name}"`,
          justification: `La règle "${rule.name}" (créée le ${rule.createdAt.toLocaleDateString('fr-FR')}) ne s'est jamais déclenchée au cours des ${ANALYSIS_WINDOW_DAYS} derniers jours et a plus de ${STALE_RULE_AGE_DAYS} jours. Elle semble inefficace ou obsolète.`,
          detectorKey: 'INEFFICIENT_RULE',
          proposedConditions: null,
          proposedActions: null,
          estimatedImpact: `Nettoyage des règles inutilisées du bâtiment`,
          estimatedSavingsKwh: null,
          estimatedSavingsEur: null,
          confidence: RecommendationConfidence.HIGH,
          targetRuleId: rule.id,
          buildingId,
          detectionWindowFrom: from,
          detectionWindowTo: now,
        });
      }
    }

    return candidates;
  }
}
