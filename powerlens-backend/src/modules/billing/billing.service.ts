import { Injectable, NotFoundException } from '@nestjs/common';
import { BillingRecord, TariffCategory, TariffPlan } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MeasurementsService } from '../measurements/measurements.service';

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function previousMonthRange(date: Date): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const periodEnd = new Date(date.getFullYear(), date.getMonth(), 1);
  return { periodStart, periodEnd };
}

// ─── Grille tarifaire SBEE Base Tension (FCFA/kWh, réglementée) ────────────────
// Ces prix sont fixés par la SBEE — codés en dur, sélectionnés par la catégorie
// du tarif du bâtiment. Les charges fixes (D/E/F) et la TVA viennent, elles, du
// TariffPlan (variables selon l'abonné).
const BT1_SOCIAL_FCFA = 86; //  ≤ 20 kWh/30 j — exonéré de TVA
const BT1_T1_FCFA = 125; //  20 < Q ≤ 250 kWh
const BT1_T2_FCFA = 148; //  au-delà de 250 kWh
const BT1_SOCIAL_CAP_KWH = 20;
const BT1_T1_CAP_KWH = 250;
const BT2_FCFA = 125; //  professionnel, tranche unique
const BT3_FCFA = 133; //  éclairage public, tranche unique

export interface SbeeBill {
  totalKwh: number;
  category: TariffCategory;
  /** Coût de la consommation seule (avant charges fixes et TVA). */
  consumptionCostFcfa: number;
  /** Prix moyen effectif du kWh sur la consommation (consumptionCost / kWh). */
  currentPricePerKwhFcfa: number;
  fixedChargeDFcfa: number; // D — assujettie TVA
  taxEFcfa: number; // E — hors TVA
  taxFFcfa: number; // F — hors TVA
  /** Assiette de TVA = consommation taxable + D (la tranche sociale est exonérée). */
  vatBaseFcfa: number;
  vatRate: number;
  /** Montant hors taxes M = consommation + D + E + F. */
  montantHTFcfa: number;
  /** TVA H = assiette × taux. */
  tvaFcfa: number;
  /** Net à payer = M + H. Exposé aussi comme `totalCostFcfa` (compat app). */
  netAPayerFcfa: number;
  totalCostFcfa: number;
}

/**
 * Facture SBEE Base Tension conforme à la grille officielle :
 *  - BT1 (domestique) : tranche sociale ≤20 kWh (86, exonérée TVA), sinon toute
 *    la consommation à 125 (>20, ≤250), puis 125×250 + surplus à 148 (>250) ;
 *  - BT2 (pro) : 125 FCFA/kWh à tranche unique ;
 *  - BT3 (éclairage public) : 133 FCFA/kWh à tranche unique.
 * Puis, pour toutes les tranches assujetties : M = conso + D + E + F,
 * H = (conso_taxable + D) × TVA, Net à payer = M + H.
 */
export function computeSbeeBill(totalKwh: number, tariff: TariffPlan): SbeeBill {
  const q = Math.max(0, totalKwh);
  const D = tariff.fixedChargeDFcfa;
  const E = tariff.taxEFcfa;
  const F = tariff.taxFFcfa;
  const vatRate = tariff.vatRate;

  let consumptionCostFcfa = 0;
  let vatableConsumptionFcfa = 0; // part de la consommation soumise à la TVA

  switch (tariff.category) {
    case 'BT1_DOMESTIC': {
      if (q <= BT1_SOCIAL_CAP_KWH) {
        // Tranche sociale : exonérée de TVA.
        consumptionCostFcfa = BT1_SOCIAL_FCFA * q;
        vatableConsumptionFcfa = 0;
      } else if (q <= BT1_T1_CAP_KWH) {
        // Dès qu'on dépasse 20 kWh, TOUTE la consommation est facturée à 125.
        consumptionCostFcfa = BT1_T1_FCFA * q;
        vatableConsumptionFcfa = consumptionCostFcfa;
      } else {
        // Marginal au-delà de 250 kWh : 125×250 puis 148 sur le surplus.
        consumptionCostFcfa =
          BT1_T1_FCFA * BT1_T1_CAP_KWH + BT1_T2_FCFA * (q - BT1_T1_CAP_KWH);
        vatableConsumptionFcfa = consumptionCostFcfa;
      }
      break;
    }
    case 'BT3_PUBLIC': {
      consumptionCostFcfa = BT3_FCFA * q;
      vatableConsumptionFcfa = consumptionCostFcfa;
      break;
    }
    case 'BT2_PRO':
    default: {
      consumptionCostFcfa = BT2_FCFA * q;
      vatableConsumptionFcfa = consumptionCostFcfa;
      break;
    }
  }

  const vatBaseFcfa = vatableConsumptionFcfa + D; // D est assujettie à la TVA
  const tvaFcfa = vatBaseFcfa * vatRate;
  const montantHTFcfa = consumptionCostFcfa + D + E + F;
  const netAPayerFcfa = montantHTFcfa + tvaFcfa;
  const currentPricePerKwhFcfa = q > 0 ? consumptionCostFcfa / q : 0;

  return {
    totalKwh: q,
    category: tariff.category,
    consumptionCostFcfa,
    currentPricePerKwhFcfa,
    fixedChargeDFcfa: D,
    taxEFcfa: E,
    taxFFcfa: F,
    vatBaseFcfa,
    vatRate,
    montantHTFcfa,
    tvaFcfa,
    netAPayerFcfa,
    totalCostFcfa: netAPayerFcfa, // compat : l'app lit `totalCostFcfa`
  };
}

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private measurementsService: MeasurementsService,
  ) {}

  async getActiveTariff(buildingId: string) {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      include: { tariffPlan: true },
    });
    if (!building) throw new NotFoundException('Building not found');
    if (!building.tariffPlan) throw new NotFoundException('No tariff plan assigned to this building');
    return building.tariffPlan;
  }

  async computeCost(buildingId: string, from: Date, to: Date) {
    const tariff = await this.getActiveTariff(buildingId);
    const totalKwh = await this.measurementsService.sumEnergyKwh(buildingId, from, to);
    const bill = computeSbeeBill(totalKwh, tariff);
    return {
      ...bill, // totalKwh, coût conso, D/E/F, HT, TVA, net (= totalCostFcfa)…
      basePricePerKwhFcfa: tariff.pricePerKwhFcfa,
      tariffName: tariff.name,
    };
  }

  async getCurrentMonthEstimate(buildingId: string) {
    const now = new Date();
    const periodStart = startOfMonth(now);
    const cost = await this.computeCost(buildingId, periodStart, now);

    const [lastRecord, estimatedSavingsFcfa] = await Promise.all([
      this.prisma.billingRecord.findFirst({
        where: { buildingId },
        orderBy: { periodStart: 'desc' },
      }),
      this.sumEstimatedSavings(buildingId, periodStart, now),
    ]);

    const variationPercent =
      lastRecord && lastRecord.totalCostFcfa > 0
        ? ((cost.totalCostFcfa - lastRecord.totalCostFcfa) / lastRecord.totalCostFcfa) * 100
        : null;

    return { periodStart, periodEnd: now, ...cost, variationPercent, estimatedSavingsFcfa };
  }

  async getHistory(buildingId: string) {
    const records = await this.prisma.billingRecord.findMany({
      where: { buildingId },
      orderBy: { periodStart: 'desc' },
    });
    return this.enrichHistory(records);
  }

  /**
   * Enrichit chaque ligne d'historique avec variation (vs mois précédent
   * dans la même liste), économie estimée (recommandations APPLIED dont
   * `appliedAt` tombe dans la période), et prévision du mois suivant
   * (attachée uniquement à l'enregistrement le plus récent). N'altère AUCUN
   * champ existant — ajoute uniquement des clés nouvelles, cf. STATE.md V10
   * (mission RC1 2.5 — pas de nouvelle colonne sur BillingRecord, calcul à
   * la volée pour éviter la staleness d'un snapshot immuable).
   */
  private async enrichHistory(records: BillingRecord[]) {
    const withVariation = records.map((record, i) => {
      const previous = records[i + 1]; // records est trié desc → i+1 = mois précédent
      const variationPercent =
        previous && previous.totalCostFcfa > 0
          ? ((record.totalCostFcfa - previous.totalCostFcfa) / previous.totalCostFcfa) * 100
          : null;
      return { ...record, variationPercent };
    });

    const withSavings = await Promise.all(
      withVariation.map(async (record) => ({
        ...record,
        estimatedSavingsFcfa: await this.sumEstimatedSavings(
          record.buildingId,
          record.periodStart,
          record.periodEnd,
        ),
      })),
    );

    const forecastNextMonthFcfa = this.computeForecast(records);
    return withSavings.map((r, i) =>
      i === 0 ? { ...r, forecastNextMonthFcfa } : { ...r, forecastNextMonthFcfa: null },
    );
  }

  /**
   * ⚠️ `RuleRecommendation.estimatedSavingsEur` est nommé `*Eur` mais tout
   * le système de facturation est en FCFA (SBEE) — à vérifier avant mise en
   * production que ces valeurs sont bien déjà exprimées en FCFA, sinon ce
   * chiffre affiché à l'utilisateur serait faux (cf. STATE.md V10).
   */
  private async sumEstimatedSavings(buildingId: string, from: Date, to: Date): Promise<number> {
    const result = await this.prisma.ruleRecommendation.aggregate({
      _sum: { estimatedSavingsEur: true },
      where: { buildingId, status: 'APPLIED', appliedAt: { gte: from, lt: to } },
    });
    return result._sum.estimatedSavingsEur ?? 0;
  }

  /** Extrapolation simple : tendance linéaire sur les 3 derniers mois (report à plat si un seul point). */
  private computeForecast(records: BillingRecord[]): number | null {
    const recent = records.slice(0, 3); // records triés desc
    if (recent.length === 0) return null;
    if (recent.length === 1) return recent[0].totalCostFcfa;

    const chronological = [...recent].reverse();
    const deltas = chronological.slice(1).map((r, i) => r.totalCostFcfa - chronological[i].totalCostFcfa);
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    return Math.max(0, chronological[chronological.length - 1].totalCostFcfa + avgDelta);
  }

  /** Idempotent : une seule facture par bâtiment et par mois (`@@unique([buildingId, periodStart])`). */
  async generateMonthlyRecord(buildingId: string, periodStart: Date, periodEnd: Date) {
    const tariff = await this.getActiveTariff(buildingId);
    const totalKwh = await this.measurementsService.sumEnergyKwh(buildingId, periodStart, periodEnd);
    const bill = computeSbeeBill(totalKwh, tariff);

    const snapshot = {
      totalKwh,
      totalCostFcfa: bill.netAPayerFcfa, // on stocke le NET à payer (M + H)
      pricePerKwhFcfa: bill.currentPricePerKwhFcfa,
      growthCoefficientFcfa: tariff.growthCoefficientFcfa,
      tariffPlanId: tariff.id,
    };

    return this.prisma.billingRecord.upsert({
      where: { buildingId_periodStart: { buildingId, periodStart } },
      update: snapshot,
      create: { buildingId, periodStart, periodEnd, ...snapshot },
    });
  }

  async generatePreviousMonthForAllBuildings() {
    const { periodStart, periodEnd } = previousMonthRange(new Date());
    const buildings = await this.prisma.building.findMany({
      where: { tariffPlanId: { not: null } },
      select: { id: true },
    });

    const results: Awaited<ReturnType<typeof this.generateMonthlyRecord>>[] = [];
    for (const building of buildings) {
      results.push(await this.generateMonthlyRecord(building.id, periodStart, periodEnd));
    }
    return results;
  }

  async generateForPeriod(buildingId: string, period?: string) {
    if (!period) {
      const { periodStart, periodEnd } = previousMonthRange(new Date());
      return this.generateMonthlyRecord(buildingId, periodStart, periodEnd);
    }

    const [year, month] = period.split('-').map(Number);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);
    return this.generateMonthlyRecord(buildingId, periodStart, periodEnd);
  }
}
