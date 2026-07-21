import { api } from './api';

export type RankingPeriod = 'week' | 'month' | 'quarter';

export interface RankingBreakdown {
  consumptionTrend: number;
  stability: number;
  alertFrequency: number;
  recommendationCompliance: number;
  efficiency: number;
}

export interface RankingEntry {
  zoneId: string;
  zoneName: string;
  zoneType: 'ROOM' | 'CORRIDOR';
  score: number;
  rank: number;
  badge: 'CHAMPION' | null;
  breakdown: RankingBreakdown;
  currentKwh: number;
  previousKwh: number;
  improvementPercent: number;
  alertCount: number;
}

export interface RankingResponse {
  buildingId: string;
  period: { type: RankingPeriod; from: string; to: string; previousFrom: string; previousTo: string };
  ranking: RankingEntry[];
  methodology: { weights: Record<string, number>; notes: string[] };
}

export async function getRanking(buildingId: string, period: RankingPeriod = 'month'): Promise<RankingResponse> {
  const { data } = await api.get<RankingResponse>('/supervisor/ranking', { params: { buildingId, period } });
  return data;
}
