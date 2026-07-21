import { Injectable } from '@nestjs/common';
import { RecommendationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

const CONFIDENCE_WEIGHT: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const REPETITIVE_ALERT_WINDOW_DAYS = 90; // aligné sur RepetitiveAlertDetector.ANALYSIS_WINDOW_DAYS

interface AvgTimeToTriggerRow {
  avg_hours: number | null;
}

/**
 * Tableau d'efficacité du Smart Supervisor (RC1, mission Phase 2.3) —
 * entièrement calculé à la volée depuis les tables existantes
 * (RuleRecommendation/Alert), aucune nouvelle table. Voir STATE.md V10
 * pour la méthodologie détaillée par statistique.
 */
@Injectable()
export class SupervisorDashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(query: DashboardQueryDto) {
    const buildingId = query.buildingId;
    const from = query.from ? new Date(query.from) : new Date(0);
    const to = query.to ? new Date(query.to) : new Date();

    const [
      rulesCreated,
      accepted,
      refused,
      pending,
      savings,
      avgConfidenceScore,
      avgRelevancePercent,
      avgTimeToTriggerHours,
      avoidedAlerts,
    ] = await Promise.all([
      this.prisma.ruleRecommendation.count({
        where: { buildingId, type: 'CREATE_RULE', status: 'APPLIED', appliedAt: { gte: from, lte: to } },
      }),
      this.prisma.ruleRecommendation.count({
        where: { buildingId, status: 'APPLIED', appliedAt: { gte: from, lte: to } },
      }),
      this.prisma.ruleRecommendation.count({
        where: { buildingId, status: 'REJECTED', reviewedAt: { gte: from, lte: to } },
      }),
      this.prisma.ruleRecommendation.count({ where: { buildingId, status: 'PENDING' } }),
      this.getSavings(buildingId, from, to),
      this.getAvgConfidence(buildingId, from, to),
      this.getAvgRelevance(buildingId, from, to),
      this.getAvgTimeToTrigger(buildingId, from, to),
      this.getAvoidedAlerts(buildingId, from, to),
    ]);

    return {
      buildingId,
      period: { from, to },
      rulesCreated,
      recommendationsAccepted: accepted,
      recommendationsRefused: refused,
      recommendationsPending: pending,
      estimatedSavingsEur: savings.eur,
      energySavedKwh: savings.kwh,
      // "Consommation évitée" = même donnée qu'"énergie économisée" ; les
      // détecteurs calculent déjà les kWh non-consommés (cf. STATE.md V10).
      // Surfacé deux fois sous deux libellés pour coller au vocabulaire de
      // la mission, jamais deux calculs distincts (éviterait une
      // contradiction dans l'UI).
      avoidedConsumptionKwh: savings.kwh,
      avoidedAlerts,
      avgRelevancePercent,
      avgConfidenceScore,
      avgTimeToTriggerHours,
    };
  }

  private async getSavings(buildingId: string, from: Date, to: Date) {
    const result = await this.prisma.ruleRecommendation.aggregate({
      _sum: { estimatedSavingsEur: true, estimatedSavingsKwh: true },
      where: { buildingId, status: 'APPLIED', appliedAt: { gte: from, lte: to } },
    });
    return {
      eur: result._sum.estimatedSavingsEur ?? 0,
      kwh: result._sum.estimatedSavingsKwh ?? 0,
    };
  }

  /**
   * Score de confiance moyen : LOW=1/MEDIUM=2/HIGH=3, moyenne pondérée par
   * le nombre de recommandations de chaque niveau (Prisma ne sait pas
   * moyenner un enum en SQL sans CASE — calcul fait côté application).
   */
  private async getAvgConfidence(buildingId: string, from: Date, to: Date) {
    const grouped = await this.prisma.ruleRecommendation.groupBy({
      by: ['confidence'],
      where: { buildingId, createdAt: { gte: from, lte: to } },
      _count: true,
    });
    const total = grouped.reduce((s, g) => s + g._count, 0);
    if (total === 0) return null;
    const weightedSum = grouped.reduce(
      (s, g) => s + (CONFIDENCE_WEIGHT[g.confidence] ?? 0) * g._count,
      0,
    );
    return weightedSum / total;
  }

  /**
   * "Pertinence moyenne" — non stockée directement. Proxy documenté : taux
   * d'acceptation (APPLIED / (APPLIED + REJECTED)) par détecteur, moyenné.
   * Une recommandation approuvée est, par construction, jugée pertinente ;
   * une rejetée, non pertinente.
   */
  private async getAvgRelevance(buildingId: string, from: Date, to: Date) {
    const grouped = await this.prisma.ruleRecommendation.groupBy({
      by: ['detectorKey', 'status'],
      where: {
        buildingId,
        createdAt: { gte: from, lte: to },
        status: { in: [RecommendationStatus.APPLIED, RecommendationStatus.REJECTED] },
      },
      _count: true,
    });

    const byDetector = new Map<string, { applied: number; rejected: number }>();
    for (const g of grouped) {
      const entry = byDetector.get(g.detectorKey) ?? { applied: 0, rejected: 0 };
      if (g.status === RecommendationStatus.APPLIED) entry.applied += g._count;
      else entry.rejected += g._count;
      byDetector.set(g.detectorKey, entry);
    }

    if (byDetector.size === 0) return null;

    const rates = [...byDetector.values()].map(
      (e) => (e.applied / (e.applied + e.rejected)) * 100,
    );
    return rates.reduce((s, r) => s + r, 0) / rates.length;
  }

  private async getAvgTimeToTrigger(buildingId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<AvgTimeToTriggerRow[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("reviewedAt" - "createdAt")) / 3600.0) AS avg_hours
      FROM "RuleRecommendation"
      WHERE "buildingId" = ${buildingId}
        AND "reviewedAt" IS NOT NULL
        AND "createdAt" >= ${from}
        AND "createdAt" <= ${to}
    `;
    return rows[0]?.avg_hours ?? null;
  }

  /**
   * "Alertes évitées" — synthétique, non stocké. Approximation par
   * comparaison avant/après pour les recommandations issues du détecteur
   * REPETITIVE_ALERT uniquement (seul détecteur dont le but explicite est
   * de réduire le nombre d'alertes). Portée volontairement restreinte
   * plutôt que généralisée à tous les types de détecteurs, où "alerte
   * évitée" n'est pas un concept bien défini (cf. STATE.md V10).
   */
  private async getAvoidedAlerts(buildingId: string, from: Date, to: Date) {
    const recommendations = await this.prisma.ruleRecommendation.findMany({
      where: {
        buildingId,
        detectorKey: 'REPETITIVE_ALERT',
        status: 'APPLIED',
        appliedAt: { gte: from, lte: to, not: null },
      },
      select: { targetRuleId: true, appliedAt: true },
    });

    let totalAvoided = 0;
    let applicable = 0;
    const now = new Date();
    const windowMs = REPETITIVE_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    for (const rec of recommendations) {
      if (!rec.targetRuleId || !rec.appliedAt) continue;
      applicable++;

      const beforeFrom = new Date(rec.appliedAt.getTime() - windowMs);
      const afterTo = new Date(Math.min(rec.appliedAt.getTime() + windowMs, now.getTime()));
      const afterWindowDays = Math.max(
        (afterTo.getTime() - rec.appliedAt.getTime()) / (24 * 60 * 60 * 1000),
        0,
      );
      if (afterWindowDays <= 0) continue;

      const [alertsBefore, alertsAfter] = await Promise.all([
        this.prisma.alert.count({
          where: { ruleId: rec.targetRuleId, createdAt: { gte: beforeFrom, lt: rec.appliedAt } },
        }),
        this.prisma.alert.count({
          where: { ruleId: rec.targetRuleId, createdAt: { gte: rec.appliedAt, lt: afterTo } },
        }),
      ]);

      const normalizedAfter = alertsAfter * (REPETITIVE_ALERT_WINDOW_DAYS / afterWindowDays);
      totalAvoided += Math.max(0, alertsBefore - normalizedAfter);
    }

    return {
      value: Math.round(totalAvoided),
      methodology:
        'Comparaison avant/après (fenêtre 90j) du nombre d\'alertes liées à la règle ciblée, uniquement pour les recommandations du détecteur REPETITIVE_ALERT',
      applicableRecommendations: applicable,
    };
  }
}
