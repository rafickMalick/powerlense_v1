import { Injectable } from '@nestjs/common';
import { RecommendationStatus, ZoneType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { RankingQueryDto } from './dto/ranking-query.dto';

/**
 * Classement salles/couloirs (mission Phase 2.4) — formule composite
 * documentée et non-arbitraire, calculée à la volée (aucune nouvelle
 * table). Voir STATE.md V10 pour la justification des poids.
 */
const WEIGHTS = {
  consumptionTrend: 0.3,
  stability: 0.2,
  alertFrequency: 0.2,
  recommendationCompliance: 0.15,
  efficiency: 0.15,
};

const WEIGHT_NOTES = [
  'consumptionTrend (30%) : KPI central — amélioration de la consommation mois vs mois précédent.',
  'stability (20%) : pénalise la consommation erratique/non maîtrisée, même si la tendance moyenne est bonne.',
  'alertFrequency (20%) : les alertes signalent un usage anormal/à risque, indépendamment du kWh.',
  'recommendationCompliance (15%) : récompense la collaboration avec le Smart Supervisor (règles approuvées vs rejetées).',
  'efficiency (15%) : facteur de puissance — surtout une propriété de l\'équipement installé, donc pondéré plus bas (moins actionnable par l\'occupant).',
];

interface StabilityRow {
  mean: number | null;
  stddev: number | null;
}
interface EfficiencyRow {
  avg_pf: number | null;
}

/**
 * `previousFrom`/`previousTo` doivent couvrir la période calendaire
 * complète précédente (mois/trimestre entier précédent), PAS une fenêtre
 * de même durée que le temps déjà écoulé dans la période courante — bug
 * trouvé en usage réel : avec `from = 1er juillet` et `now = 2 juillet`,
 * `msLength` ne valait qu'~1 jour, donnant un `previousFrom` de la veille
 * du 1er juillet au lieu du 1er juin (mois précédent). Même pattern déjà
 * correct dans `services/reports.ts` (mobile) — repris ici à l'identique.
 */
function periodRange(period: 'week' | 'month' | 'quarter' = 'month') {
  const now = new Date();
  let from: Date;
  let previousFrom: Date;

  if (period === 'week') {
    from = new Date(now);
    from.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    from.setHours(0, 0, 0, 0);
    previousFrom = new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'quarter') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    from = new Date(now.getFullYear(), quarterStartMonth, 1);
    previousFrom = new Date(now.getFullYear(), quarterStartMonth - 3, 1);
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    previousFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }

  const to = now;
  const previousTo = from;
  return { from, to, previousFrom, previousTo };
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

@Injectable()
export class SupervisorRankingService {
  constructor(private prisma: PrismaService) {}

  async getRanking(query: RankingQueryDto) {
    const buildingId = query.buildingId;
    const { from, to, previousFrom, previousTo } = periodRange(query.period);

    const zones = await this.prisma.monitoringZone.findMany({
      where: { buildingId, type: { in: [ZoneType.ROOM, ZoneType.CORRIDOR] } },
    });

    const perZone = await Promise.all(
      zones.map(async (zone) => {
        const [currentKwh, previousKwh, stability, efficiency, alertCount, compliance] =
          await Promise.all([
            this.getZoneEnergyKwh(zone.id, from, to),
            this.getZoneEnergyKwh(zone.id, previousFrom, previousTo),
            this.getStabilityScore(zone.id, from, to),
            this.getEfficiencyScore(zone.id, from, to),
            this.prisma.alert.count({ where: { zoneId: zone.id, createdAt: { gte: from, lte: to } } }),
            this.getComplianceScore(buildingId, zone.id, from, to),
          ]);

        return { zone, currentKwh, previousKwh, stability, efficiency, alertCount, compliance };
      }),
    );

    // Zones sans historique précédent = zones nouvelles, exclues du
    // classement (règle déjà identifiée dans le stub frontend d'origine).
    const eligible = perZone.filter((z) => z.previousKwh > 0);
    const maxAlertCount = Math.max(1, ...eligible.map((z) => z.alertCount));

    const scored = eligible.map((z) => {
      const improvementPercent = ((z.previousKwh - z.currentKwh) / z.previousKwh) * 100;
      const consumptionTrend = clamp(50 + improvementPercent);
      const alertFrequency = clamp(100 * (1 - z.alertCount / maxAlertCount));

      const breakdown = {
        consumptionTrend,
        stability: z.stability,
        alertFrequency,
        recommendationCompliance: z.compliance,
        efficiency: z.efficiency,
      };

      const score =
        WEIGHTS.consumptionTrend * breakdown.consumptionTrend +
        WEIGHTS.stability * breakdown.stability +
        WEIGHTS.alertFrequency * breakdown.alertFrequency +
        WEIGHTS.recommendationCompliance * breakdown.recommendationCompliance +
        WEIGHTS.efficiency * breakdown.efficiency;

      return {
        zoneId: z.zone.id,
        zoneName: z.zone.name,
        zoneType: z.zone.type,
        score: Math.round(score * 10) / 10,
        breakdown,
        currentKwh: z.currentKwh,
        previousKwh: z.previousKwh,
        improvementPercent: Math.round(improvementPercent * 10) / 10,
        alertCount: z.alertCount,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const ranking = scored.map((z, i) => ({
      ...z,
      rank: i + 1,
      badge: i === 0 ? 'CHAMPION' : null,
    }));

    return {
      buildingId,
      period: { type: query.period ?? 'month', from, to, previousFrom, previousTo },
      ranking,
      methodology: { weights: WEIGHTS, notes: WEIGHT_NOTES },
    };
  }

  /** Diff de compteur (même technique que MeasurementsService.sumEnergyKwh, appliquée à UNE zone). */
  private async getZoneEnergyKwh(zoneId: string, from: Date, to: Date): Promise<number> {
    const [startReading, endReading] = await Promise.all([
      this.prisma.energyMeasurement.findFirst({
        where: { zoneId, measuredAt: { lt: from } },
        orderBy: { measuredAt: 'desc' },
        select: { energyKwh: true },
      }),
      this.prisma.energyMeasurement.findFirst({
        where: { zoneId, measuredAt: { lte: to } },
        orderBy: { measuredAt: 'desc' },
        select: { energyKwh: true },
      }),
    ]);
    const startValue = startReading?.energyKwh ?? 0;
    const endValue = endReading?.energyKwh ?? startValue;
    return Math.max(0, endValue - startValue);
  }

  private async getStabilityScore(zoneId: string, from: Date, to: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<StabilityRow[]>`
      SELECT AVG(power) AS mean, STDDEV(power) AS stddev
      FROM "EnergyMeasurement"
      WHERE "zoneId" = ${zoneId} AND "measuredAt" BETWEEN ${from} AND ${to}
    `;
    const mean = rows[0]?.mean;
    const stddev = rows[0]?.stddev;
    if (!mean || mean <= 0 || stddev === null || stddev === undefined) return 100;
    const coefficientOfVariation = stddev / mean;
    return clamp(100 - coefficientOfVariation * 100);
  }

  private async getEfficiencyScore(zoneId: string, from: Date, to: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<EfficiencyRow[]>`
      SELECT AVG("powerFactor") AS avg_pf
      FROM "EnergyMeasurement"
      WHERE "zoneId" = ${zoneId} AND "measuredAt" BETWEEN ${from} AND ${to}
    `;
    const avgPf = rows[0]?.avg_pf;
    if (avgPf === null || avgPf === undefined) return 50; // neutre si aucune donnée
    return clamp(((avgPf - 0.7) / 0.3) * 100);
  }

  /**
   * Approximation best-effort : une recommandation "concerne" une zone si
   * ses proposedActions/proposedConditions référencent un circuit de cette
   * zone ou la zone elle-même. RuleRecommendation n'a pas de FK zoneId
   * directe (portée bâtiment) — documenté comme approximation, pas une
   * vérité stockée.
   */
  private async getComplianceScore(
    buildingId: string,
    zoneId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const [zoneCircuits, recommendations] = await Promise.all([
      this.prisma.circuit.findMany({ where: { zoneId }, select: { id: true } }),
      this.prisma.ruleRecommendation.findMany({
        where: {
          buildingId,
          createdAt: { gte: from, lte: to },
          status: { in: [RecommendationStatus.APPLIED, RecommendationStatus.REJECTED] },
        },
        select: { status: true, proposedConditions: true, proposedActions: true },
      }),
    ]);

    const circuitIds = new Set(zoneCircuits.map((c) => c.id));
    const targetsZone = (value: unknown): boolean => {
      if (!value) return false;
      if (Array.isArray(value)) return value.some(targetsZone);
      if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (obj.zoneId === zoneId) return true;
        if (obj.targetId === zoneId) return true;
        if (typeof obj.targetId === 'string' && circuitIds.has(obj.targetId)) return true;
        if (obj.conditions) return targetsZone(obj.conditions);
      }
      return false;
    };

    const relevant = recommendations.filter(
      (r) => targetsZone(r.proposedConditions) || targetsZone(r.proposedActions),
    );

    if (relevant.length === 0) return 50; // neutre : absence de preuve != non-conformité
    const applied = relevant.filter((r) => r.status === RecommendationStatus.APPLIED).length;
    return clamp((applied / relevant.length) * 100);
  }
}
