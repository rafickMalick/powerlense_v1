import { Injectable } from '@nestjs/common';
import { Prisma, RecommendationConfidence } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RuleCondition } from '../../rules/rules-engine.service';
import { Detector, DetectionCandidate } from './types';

const ANALYSIS_WINDOW_DAYS = 30;
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;
const EXCESS_RATIO_THRESHOLD = 1.5;
const MIN_OCCURRENCES_PER_WEEK = 4;
const ENERGY_PRICE_EUR_PER_KWH = Number(
  process.env.SUPERVISOR_ENERGY_PRICE_EUR_PER_KWH ?? '0.20',
);

interface ZoneHourlyAverage {
  zoneId: string;
  hour: number;
  occurrences: bigint;
  avgPower: number | null;
}

interface ZoneGlobalAverage {
  zoneId: string;
  avgPower: number | null;
}

/**
 * Détecte les zones (ROOM/CORRIDOR — les mesures n'existent qu'à ce niveau
 * depuis V4) dont la consommation est anormalement élevée à certaines
 * heures. Propose une extinction programmée ciblant la ZONE (tous ses
 * circuits actifs non-critiques — cf. targetType 'ZONE' dans
 * measurement.listener.ts, qui exclut déjà les circuits critiques).
 */
@Injectable()
export class ExcessiveConsumptionDetector implements Detector {
  async detect(buildingId: string, prisma: PrismaService): Promise<DetectionCandidate[]> {
    const now = new Date();
    const from = new Date(now.getTime() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const zones = await prisma.monitoringZone.findMany({
      where: {
        buildingId,
        type: { in: ['ROOM', 'CORRIDOR'] },
      },
      include: { circuits: true },
    });

    if (zones.length === 0) return [];

    const zoneIds = zones.map((z) => z.id);

    const globalAverages = await prisma.$queryRaw<ZoneGlobalAverage[]>`
      SELECT "zoneId", AVG(power) AS "avgPower"
      FROM "EnergyMeasurement"
      WHERE "zoneId" IN (${Prisma.join(zoneIds)})
        AND "measuredAt" BETWEEN ${from} AND ${now}
      GROUP BY "zoneId"
    `;

    const hourlyAverages = await prisma.$queryRaw<ZoneHourlyAverage[]>`
      SELECT
        "zoneId",
        EXTRACT(hour FROM "measuredAt")::int AS "hour",
        COUNT(DISTINCT date_trunc('day', "measuredAt")) AS "occurrences",
        AVG(power) AS "avgPower"
      FROM "EnergyMeasurement"
      WHERE "zoneId" IN (${Prisma.join(zoneIds)})
        AND "measuredAt" BETWEEN ${from} AND ${now}
        AND (EXTRACT(hour FROM "measuredAt")::int >= ${NIGHT_START_HOUR}
          OR EXTRACT(hour FROM "measuredAt")::int < ${NIGHT_END_HOUR})
      GROUP BY "zoneId", "hour"
    `;

    const globalAvgByZone = new Map<string, number>();
    for (const row of globalAverages) {
      if (row.avgPower !== null) globalAvgByZone.set(row.zoneId, Number(row.avgPower));
    }

    const candidates: DetectionCandidate[] = [];

    for (const zone of zones) {
      const globalAvg = globalAvgByZone.get(zone.id);
      if (!globalAvg || globalAvg <= 0) continue;

      const zoneHours = hourlyAverages.filter((h) => h.zoneId === zone.id);
      const excessiveHours = zoneHours.filter((h) => {
        const occurrencesPerWeek = (Number(h.occurrences) / ANALYSIS_WINDOW_DAYS) * 7;
        return (
          h.avgPower !== null &&
          Number(h.avgPower) > globalAvg * EXCESS_RATIO_THRESHOLD &&
          occurrencesPerWeek >= MIN_OCCURRENCES_PER_WEEK
        );
      });

      if (excessiveHours.length === 0) continue;

      const existingScheduleRule = await prisma.rule.findFirst({
        where: {
          buildingId,
          isActive: true,
          ruleType: 'SCHEDULE',
        },
      });

      const coveredByExistingRule = existingScheduleRule
        ? this.ruleCoversZoneAndWindow(existingScheduleRule, zone.id)
        : false;

      if (coveredByExistingRule) continue;

      const sortedHours = excessiveHours.map((h) => h.hour).sort((a, b) => a - b);
      const startHour = sortedHours[0];
      const endHour = sortedHours[sortedHours.length - 1] + 1;
      const startTime = `${startHour.toString().padStart(2, '0')}:00`;
      const endTime = `${(endHour % 24).toString().padStart(2, '0')}:00`;

      const avgExcessPower =
        excessiveHours.reduce((sum, h) => sum + (Number(h.avgPower) - globalAvg), 0) /
        excessiveHours.length;
      const hoursConcerned = excessiveHours.length;
      const estimatedSavingsKwh =
        (avgExcessPower * hoursConcerned * ANALYSIS_WINDOW_DAYS) / 1000;
      const estimatedSavingsEur = estimatedSavingsKwh * ENERGY_PRICE_EUR_PER_KWH;

      // Une zone contenant un circuit critique (ex. HVAC) peut voir son
      // excès dominé par ce circuit, jamais coupé par l'action ZONE —
      // confiance réduite pour inciter à une vérification manuelle.
      const hasCriticalCircuit = zone.circuits.some((c) => c.isCritical);

      candidates.push({
        type: 'CREATE_RULE',
        title: `Extinction programmée de la zone "${zone.name}"`,
        justification: hasCriticalCircuit
          ? `Zone contenant un équipement critique : consommation anormalement élevée (>${EXCESS_RATIO_THRESHOLD}x la moyenne) entre ${startTime} et ${endTime} sur ${ANALYSIS_WINDOW_DAYS} jours. Recommandation à confiance réduite : l'action ZONE proposée ne coupe jamais les circuits critiques, elle pourrait donc ne pas résorber l'excès si celui-ci provient du circuit critique — vérification manuelle requise.`
          : `Consommation moyenne ${EXCESS_RATIO_THRESHOLD}x supérieure à la moyenne de la zone entre ${startTime} et ${endTime}, observée au moins ${MIN_OCCURRENCES_PER_WEEK} fois/semaine sur les ${ANALYSIS_WINDOW_DAYS} derniers jours, sans règle d'extinction programmée existante.`,
        detectorKey: 'EXCESSIVE_CONSUMPTION',
        proposedConditions: {
          type: 'SCHEDULE',
          startTime,
          endTime,
        } as RuleCondition,
        proposedActions: [{ type: 'SWITCH_OFF', targetType: 'ZONE', targetId: zone.id }],
        estimatedImpact: `Réduction de la consommation nocturne de la zone "${zone.name}"`,
        estimatedSavingsKwh,
        estimatedSavingsEur,
        confidence: hasCriticalCircuit ? RecommendationConfidence.LOW : RecommendationConfidence.MEDIUM,
        buildingId,
        detectionWindowFrom: from,
        detectionWindowTo: now,
      });
    }

    return candidates;
  }

  private ruleCoversZoneAndWindow(
    rule: { conditions: unknown; actions: unknown },
    zoneId: string,
  ): boolean {
    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    const hasSwitchOffForZone = actions.some(
      (a: any) => a?.type === 'SWITCH_OFF' && a?.targetType === 'ZONE' && a?.targetId === zoneId,
    );
    if (!hasSwitchOffForZone) return false;

    const conditions = rule.conditions as any;
    return conditions?.type === 'SCHEDULE';
  }
}
