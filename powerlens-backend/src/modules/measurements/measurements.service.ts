import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, EnergyMeasurement, ZoneType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  GRANULARITIES,
  MeasurementGranularity,
  MeasurementsQueryDto,
} from './dto/measurements-query.dto';

/**
 * `EnergyMeasurement.id` est un BigInt (auto-incrément) : non sérialisable
 * en JSON tel quel, on le convertit en string pour l'API.
 */
function serializeMeasurement(measurement: EnergyMeasurement) {
  return { ...measurement, id: measurement.id.toString() };
}

@Injectable()
export class MeasurementsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: MeasurementsQueryDto) {
    const measurements = await this.prisma.energyMeasurement.findMany({
      where: this.buildWhere(query),
      orderBy: { measuredAt: 'asc' },
    });
    return measurements.map(serializeMeasurement);
  }

  /** @deprecated Les circuits ne sont plus mesurés individuellement depuis V4 — ne renvoie que l'historique pré-migration (ou []). */
  async findByCircuit(circuitId: string, query: MeasurementsQueryDto) {
    if (query.granularity) {
      return this.aggregateByZone([circuitId], query.granularity, query.from, query.to, true);
    }

    const measurements = await this.prisma.energyMeasurement.findMany({
      where: { ...this.buildWhere(query), circuitId },
      orderBy: { measuredAt: 'asc' },
    });
    return measurements.map(serializeMeasurement);
  }

  /**
   * Mesures d'une zone. Les zones BUILDING n'ont pas toujours de capteur
   * dédié : si un module matériel (ou le simulateur) a déjà publié au moins
   * une mesure directe pour cette zone (départ général), on l'utilise comme
   * n'importe quelle autre zone ; sinon on retombe sur une agrégation
   * calculée en lecture (somme/moyenne des zones ROOM/CORRIDOR du même
   * bâtiment, par bucket temporel — des mesures brutes de zones différentes
   * n'étant pas exploitables telles quelles sans agrégation).
   */
  async findByZone(zoneId: string, query: MeasurementsQueryDto) {
    const zone = await this.prisma.monitoringZone.findUnique({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException('Zone not found');

    if (zone.type === ZoneType.BUILDING) {
      const hasDirectMeasurement = await this.prisma.energyMeasurement.findFirst({
        where: { zoneId },
        select: { id: true },
      });
      if (!hasDirectMeasurement) {
        return this.findBuildingAggregate(zone.buildingId, query);
      }
      // Une mesure directe existe (module "départ général") — traiter cette
      // zone BUILDING comme n'importe quelle zone mesurée ci-dessous.
    }

    if (query.granularity) {
      return this.aggregateByZone([zoneId], query.granularity, query.from, query.to, false);
    }

    const measurements = await this.prisma.energyMeasurement.findMany({
      where: { ...this.buildWhere(query), zoneId },
      orderBy: { measuredAt: 'asc' },
    });
    return measurements.map(serializeMeasurement);
  }

  /** @deprecated use findByZone — kept for /rooms backward-compat route */
  findByRoom(roomId: string, query: MeasurementsQueryDto) {
    return this.findByZone(roomId, query);
  }

  /**
   * Énergie (kWh) consommée par un bâtiment sur une période, pour la
   * facturation. `energyKwh` est un compteur CUMULATIF (comme un vrai
   * compteur électrique, cf. `energyAccum`/`energyByZone` dans le seed et le
   * simulateur) : la consommation d'une période est l'écart entre le dernier
   * relevé de la période et le dernier relevé précédent — jamais une SUM.
   */
  async sumEnergyKwh(buildingId: string, from: Date, to: Date): Promise<number> {
    const zones = await this.prisma.monitoringZone.findMany({
      where: { buildingId, type: { in: [ZoneType.ROOM, ZoneType.CORRIDOR] } },
      select: { id: true },
    });
    if (zones.length === 0) return 0;

    let total = 0;
    for (const zone of zones) {
      const [startReading, endReading] = await Promise.all([
        this.prisma.energyMeasurement.findFirst({
          where: { zoneId: zone.id, measuredAt: { lt: from } },
          orderBy: { measuredAt: 'desc' },
          select: { energyKwh: true },
        }),
        this.prisma.energyMeasurement.findFirst({
          where: { zoneId: zone.id, measuredAt: { lte: to } },
          orderBy: { measuredAt: 'desc' },
          select: { energyKwh: true },
        }),
      ]);
      const startValue = startReading?.energyKwh ?? 0;
      const endValue = endReading?.energyKwh ?? startValue;
      // Math.max(0, ...) absorbe un éventuel reset de compteur (redémarrage simulateur/device).
      total += Math.max(0, endValue - startValue);
    }
    return total;
  }

  /** Consommation réelle depuis minuit (heure serveur) — pour le Dashboard ("Conso. Journée"), distinct de sumEnergyKwh (facturation, période arbitraire). */
  async getEnergyToday(buildingId: string): Promise<{ totalKwh: number }> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const totalKwh = await this.sumEnergyKwh(buildingId, startOfDay, now);
    return { totalKwh };
  }

  private async findBuildingAggregate(buildingId: string, query: MeasurementsQueryDto) {
    const zones = await this.prisma.monitoringZone.findMany({
      where: { buildingId, type: { in: [ZoneType.ROOM, ZoneType.CORRIDOR] } },
      select: { id: true },
    });
    if (zones.length === 0) return [];

    const granularity = query.granularity ?? 'hour';
    return this.aggregateBuildingTotal(
      zones.map((z) => z.id),
      granularity,
      query.from,
      query.to,
    );
  }

  /**
   * Agrégation PAR ZONE et par "bucket" temporel (heure/jour/semaine/mois)
   * via date_trunc PostgreSQL. `byCircuit` bascule sur la colonne legacy
   * `circuitId` pour l'historique pré-V4 (GET /circuits/:id/measurements).
   */
  async aggregateByZone(
    ids: string[],
    granularity: MeasurementGranularity,
    from?: string,
    to?: string,
    byCircuit = false,
  ) {
    if (!GRANULARITIES.includes(granularity)) {
      granularity = 'day';
    }

    const fromDate = from ? new Date(from) : new Date(0);
    const toDate = to ? new Date(to) : new Date();
    const column = byCircuit ? Prisma.sql`"circuitId"` : Prisma.sql`"zoneId"`;

    return this.prisma.$queryRaw`
      SELECT
        ${column} AS "id",
        date_trunc(${granularity}, "measuredAt") AS "bucket",
        AVG(power) AS "avgPower",
        MAX(power) AS "maxPower",
        AVG(voltage) AS "avgVoltage",
        AVG(current) AS "avgCurrent",
        SUM("energyKwh") AS "totalEnergyKwh",
        AVG(frequency) AS "avgFrequency",
        AVG("powerFactor") AS "avgPowerFactor",
        AVG(luminosity) AS "avgLuminosity",
        AVG(temperature) AS "avgTemperature"
      FROM "EnergyMeasurement"
      WHERE ${column} IN (${Prisma.join(ids)})
        AND "measuredAt" BETWEEN ${fromDate} AND ${toDate}
      GROUP BY ${column}, "bucket"
      ORDER BY "bucket" ASC
    `;
  }

  /**
   * Agrégation BÂTIMENT : somme/moyenne à travers plusieurs zones par
   * bucket temporel, pour produire UNE série (pas une série par zone) —
   * c'est la "mesure" de la zone BUILDING.
   */
  private async aggregateBuildingTotal(
    zoneIds: string[],
    granularity: MeasurementGranularity,
    from?: string,
    to?: string,
  ) {
    const safeGranularity = GRANULARITIES.includes(granularity) ? granularity : 'hour';
    const fromDate = from ? new Date(from) : new Date(0);
    const toDate = to ? new Date(to) : new Date();

    // Étape 1 (per_timestamp) : somme l'instantané de toutes les zones au
    // même "measuredAt" (les zones d'un même tick partagent exactement le
    // même timestamp — simulateur ET historique seedé). Étape 2 : moyenne
    // ces instantanés déjà sommés par bucket. Sommer directement power
    // GROUP BY bucket serait faux : ça mélangerait "somme entre zones" et
    // "somme entre échantillons temporels", inflatant le total selon le
    // nombre d'échantillons tombés dans le bucket. Champs de sortie
    // identiques à aggregateByZone (avgPower/maxPower/...) pour que le
    // frontend traite les deux formes de façon uniforme.
    return this.prisma.$queryRaw`
      WITH per_timestamp AS (
        SELECT
          "measuredAt",
          SUM(power) AS power,
          AVG(voltage) AS voltage,
          SUM(current) AS current,
          SUM("energyKwh") AS "energyKwh",
          AVG(frequency) AS frequency,
          AVG("powerFactor") AS "powerFactor"
        FROM "EnergyMeasurement"
        WHERE "zoneId" IN (${Prisma.join(zoneIds)})
          AND "measuredAt" BETWEEN ${fromDate} AND ${toDate}
        GROUP BY "measuredAt"
      )
      SELECT
        date_trunc(${safeGranularity}, "measuredAt") AS "bucket",
        AVG(power) AS "avgPower",
        MAX(power) AS "maxPower",
        AVG(voltage) AS "avgVoltage",
        AVG(current) AS "avgCurrent",
        SUM("energyKwh") AS "totalEnergyKwh",
        AVG(frequency) AS "avgFrequency",
        AVG("powerFactor") AS "avgPowerFactor"
      FROM per_timestamp
      GROUP BY "bucket"
      ORDER BY "bucket" ASC
    `;
  }

  private buildWhere(
    query: MeasurementsQueryDto,
  ): Prisma.EnergyMeasurementWhereInput {
    const where: Prisma.EnergyMeasurementWhereInput = {};

    if (query.circuitId) {
      where.circuitId = query.circuitId;
    }
    if (query.zoneId) {
      where.zoneId = query.zoneId;
    }

    if (query.from || query.to) {
      where.measuredAt = {};
      if (query.from) where.measuredAt.gte = new Date(query.from);
      if (query.to) where.measuredAt.lte = new Date(query.to);
    }

    return where;
  }
}
