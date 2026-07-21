import { Injectable } from '@nestjs/common';
import { Prisma, RecommendationConfidence } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RuleCondition } from '../../rules/rules-engine.service';
import { Detector, DetectionCandidate } from './types';

const ANALYSIS_WINDOW_DAYS = 90;
const UNUSED_ENERGY_THRESHOLD_KWH = 0.5;

interface ZoneEnergySum {
  zoneId: string;
  totalEnergyKwh: number | null;
}

/**
 * Détecte les zones (ROOM/CORRIDOR) quasi inactives sur 90 jours. Depuis V4,
 * les circuits ne sont plus mesurés individuellement — il n'est donc plus
 * possible de détecter un équipement précis en panne/débranché au sein
 * d'une zone par ailleurs utilisée ; seule une zone entière inoccupée reste
 * détectable (cf. "Limites actuelles" du README).
 */
@Injectable()
export class UnderusedEquipmentDetector implements Detector {
  async detect(buildingId: string, prisma: PrismaService): Promise<DetectionCandidate[]> {
    const now = new Date();
    const from = new Date(now.getTime() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const zones = await prisma.monitoringZone.findMany({
      where: {
        buildingId,
        type: { in: ['ROOM', 'CORRIDOR'] },
      },
    });

    if (zones.length === 0) return [];

    const zoneIds = zones.map((z) => z.id);

    const sums = await prisma.$queryRaw<ZoneEnergySum[]>`
      SELECT "zoneId", SUM("energyKwh") AS "totalEnergyKwh"
      FROM "EnergyMeasurement"
      WHERE "zoneId" IN (${Prisma.join(zoneIds)})
        AND "measuredAt" BETWEEN ${from} AND ${now}
      GROUP BY "zoneId"
    `;

    const sumByZone = new Map<string, number>();
    for (const row of sums) {
      sumByZone.set(row.zoneId, row.totalEnergyKwh !== null ? Number(row.totalEnergyKwh) : 0);
    }

    const candidates: DetectionCandidate[] = [];

    for (const zone of zones) {
      const total = sumByZone.get(zone.id) ?? 0;
      if (total >= UNUSED_ENERGY_THRESHOLD_KWH) continue;

      candidates.push({
        type: 'CREATE_RULE',
        title: `Zone potentiellement inoccupée : "${zone.name}"`,
        justification: `Aucune consommation significative (< ${UNUSED_ENERGY_THRESHOLD_KWH} kWh) détectée dans la zone "${zone.name}" depuis ${ANALYSIS_WINDOW_DAYS} jours. Vérifier si la zone est utilisée, hors service ou en panne.`,
        detectorKey: 'UNDERUSED_EQUIPMENT',
        proposedConditions: {
          type: 'THRESHOLD',
          field: 'energyKwh',
          operator: '==',
          value: 0,
          zoneId: zone.id,
        } as RuleCondition,
        proposedActions: [
          {
            type: 'ALERT',
            payload: {
              level: 'INFO',
              message: 'Zone inactive depuis 90 jours — vérifier utilité ou panne',
            },
          },
        ],
        estimatedImpact: 'Zone potentiellement inoccupée ou capteurs en panne',
        estimatedSavingsKwh: null,
        estimatedSavingsEur: null,
        confidence: RecommendationConfidence.MEDIUM,
        buildingId,
        detectionWindowFrom: from,
        detectionWindowTo: now,
      });
    }

    return candidates;
  }
}
