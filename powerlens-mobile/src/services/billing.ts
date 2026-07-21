import { api } from './api';

export interface TariffPlan {
  id: string;
  name: string;
  category: string;
  pricePerKwhFcfa: number;
  growthCoefficientFcfa: number;
  currency: string;
  isActive: boolean;
  effectiveFrom: string;
  createdAt: string;
}

export interface BillingEstimate {
  periodStart: string;
  periodEnd: string;
  totalKwh: number;
  /** Net à payer (M + H) — alias historique du champ. */
  totalCostFcfa: number;
  basePricePerKwhFcfa: number;
  currentPricePerKwhFcfa: number;
  tariffName: string;
  category?: 'BT1_DOMESTIC' | 'BT2_PRO' | 'BT3_PUBLIC';
  // Détail SBEE
  consumptionCostFcfa?: number; // coût de la consommation seule
  fixedChargeDFcfa?: number; // prime fixe D
  taxEFcfa?: number; // taxe électricité E
  taxFFcfa?: number; // fonds rural F
  vatRate?: number;
  montantHTFcfa?: number; // M = conso + D + E + F
  tvaFcfa?: number; // H = (conso taxable + D) × TVA
  netAPayerFcfa?: number; // Net = M + H
  /** RC1 — vs le dernier relevé de l'historique, null si aucun historique. */
  variationPercent?: number | null;
  /** RC1 — recommandations Smart Supervisor APPLIED sur la période. */
  estimatedSavingsFcfa?: number;
}

export interface BillingRecord {
  id: string;
  buildingId: string;
  tariffPlanId: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: number;
  totalCostFcfa: number;
  pricePerKwhFcfa: number;
  growthCoefficientFcfa: number;
  generatedAt: string;
  /** RC1 — champs additifs calculés à la volée par le backend (voir STATE.md V10). */
  variationPercent?: number | null;
  estimatedSavingsFcfa?: number;
  /** Uniquement présent sur le relevé le plus récent de l'historique. */
  forecastNextMonthFcfa?: number | null;
}

export async function getTariff(buildingId: string): Promise<TariffPlan> {
  const { data } = await api.get<TariffPlan>('/billing/tariff', { params: { buildingId } });
  return data;
}

export async function getCurrentEstimate(buildingId: string): Promise<BillingEstimate> {
  const { data } = await api.get<BillingEstimate>('/billing/current', { params: { buildingId } });
  return data;
}

export async function getHistory(buildingId: string): Promise<BillingRecord[]> {
  const { data } = await api.get<BillingRecord[]>('/billing/history', { params: { buildingId } });
  return data;
}
