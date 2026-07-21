import type { MeasurementAggregate, EnergyMeasurement } from '@/types/models';
import type { MeasurementGranularity } from './measurements';
import type { ConsumptionPoint } from '@/store/measurementsStore';
import { getRoomMeasurements } from './rooms';
import { getAuditLogs } from './auditLogs';

export interface PeriodConfig {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  granularity: MeasurementGranularity;
  formatBucket: (bucket: string) => string;
  periodLabel: string;
}

export function getPeriodConfig(period: string): PeriodConfig {
  const now = new Date();

  switch (period) {
    case 'day': {
      const from = new Date(now); from.setHours(0, 0, 0, 0);
      const prev = new Date(from); prev.setDate(prev.getDate() - 1);
      return {
        from, to: now,
        previousFrom: prev, previousTo: from,
        granularity: 'hour',
        formatBucket: (b) => `${new Date(b).getHours()}h`,
        periodLabel: "Aujourd'hui",
      };
    }
    case 'week': {
      const from = new Date(now);
      from.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // lundi
      from.setHours(0, 0, 0, 0);
      const prev = new Date(from); prev.setDate(prev.getDate() - 7);
      return {
        from, to: now,
        previousFrom: prev, previousTo: from,
        granularity: 'day',
        formatBucket: (b) => new Date(b).toLocaleDateString('fr-FR', { weekday: 'short' }),
        periodLabel: 'Cette semaine',
      };
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevTo = new Date(from);
      return {
        from, to: now,
        previousFrom: prev, previousTo: prevTo,
        granularity: 'day',
        formatBucket: (b) => `${new Date(b).getDate()}`,
        periodLabel: 'Ce mois',
      };
    }
    case 'year':
    default: {
      const from = new Date(now.getFullYear(), 0, 1);
      const prev = new Date(now.getFullYear() - 1, 0, 1);
      const prevTo = new Date(from);
      return {
        from, to: now,
        previousFrom: prev, previousTo: prevTo,
        granularity: 'month',
        formatBucket: (b) => new Date(b).toLocaleDateString('fr-FR', { month: 'short' }),
        periodLabel: 'Cette année',
      };
    }
  }
}

function isAggregate(d: EnergyMeasurement | MeasurementAggregate): d is MeasurementAggregate {
  return 'bucket' in d;
}

function sumKwh(data: (EnergyMeasurement | MeasurementAggregate)[]): number {
  return data.reduce((acc, d) => {
    const kwh = isAggregate(d) ? (d.totalEnergyKwh ?? 0) : (d.energyKwh ?? 0);
    return acc + kwh;
  }, 0);
}

export interface RoomReportData {
  roomId: string;
  roomName: string;
  currentKwh: number;
  previousKwh: number;
  timeSeries: ConsumptionPoint[];
}

export interface ReportData {
  rooms: RoomReportData[];
  totalCurrentKwh: number;
  totalPreviousKwh: number;
  /** Série temporelle globale (somme de toutes les salles par bucket) */
  globalTimeSeries: ConsumptionPoint[];
  actionCount: number;
  auditRows: { date: string; action: string; actor: string }[];
}

const EMPTY: ReportData = {
  rooms: [],
  totalCurrentKwh: 0,
  totalPreviousKwh: 0,
  globalTimeSeries: [],
  actionCount: 0,
  auditRows: [],
};

export function formatAction(action: string, targetType: string): string {
  const map: Record<string, string> = {
    CIRCUIT_TOGGLE: 'Circuit basculé',
    RULE_CREATED: 'Règle créée',
    RULE_DELETED: 'Règle supprimée',
    RULE_TRIGGERED: 'Règle déclenchée',
    RECOMMENDATION_APPROVED: 'Recommandation approuvée',
    RECOMMENDATION_REJECTED: 'Recommandation rejetée',
    SUPERVISOR_ANALYSIS_COMPLETED: 'Analyse superviseur terminée',
    LOGIN: 'Connexion',
  };
  const label = map[action] ?? action.replace(/_/g, ' ');
  return targetType && targetType !== 'SYSTEM' ? `${label} (${targetType})` : label;
}

export async function fetchReportData(
  rooms: { id: string; name: string }[],
  cfg: PeriodConfig,
): Promise<ReportData> {
  if (rooms.length === 0) return EMPTY;

  const query = (from: Date, to: Date) => ({
    from: from.toISOString(),
    to: to.toISOString(),
    granularity: cfg.granularity,
  });

  // Fetch current + previous period pour chaque salle en parallèle
  const results = await Promise.allSettled(
    rooms.flatMap((room) => [
      getRoomMeasurements(room.id, query(cfg.from, cfg.to)),
      getRoomMeasurements(room.id, query(cfg.previousFrom, cfg.previousTo)),
    ]),
  );

  // Agréger par bucket pour la série temporelle globale
  const bucketMap = new Map<string, number>();

  const roomData: RoomReportData[] = rooms.map((room, i) => {
    const currentRaw = results[i * 2];
    const previousRaw = results[i * 2 + 1];

    const current: (EnergyMeasurement | MeasurementAggregate)[] =
      currentRaw.status === 'fulfilled' ? (currentRaw.value ?? []) : [];
    const previous: (EnergyMeasurement | MeasurementAggregate)[] =
      previousRaw.status === 'fulfilled' ? (previousRaw.value ?? []) : [];

    // Construire la série temporelle de cette salle + l'ajouter au global
    const timeSeries = current.map((d) => {
      const bucket = isAggregate(d) ? d.bucket : d.measuredAt;
      const label = cfg.formatBucket(bucket);
      const value = Math.round(isAggregate(d) ? (d.avgPower ?? 0) : (d.power ?? 0));
      bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + value);
      return { time: label, value };
    });

    return {
      roomId: room.id,
      roomName: room.name,
      currentKwh: sumKwh(current),
      previousKwh: sumKwh(previous),
      timeSeries,
    };
  });

  // Série globale triée chronologiquement
  const globalTimeSeries = [...bucketMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => ({ time: cfg.formatBucket(bucket), value }));

  // Audit logs filtrés par période
  let auditRows: ReportData['auditRows'] = [];
  let actionCount = 0;
  try {
    const logs = await getAuditLogs(100); // le backend plafonne `limit` à 100 (AuditLogsQueryDto)
    const filtered = logs.filter((l) => new Date(l.createdAt) >= cfg.from);
    actionCount = filtered.length;
    auditRows = filtered.slice(0, 50).map((l) => ({
      date: new Date(l.createdAt).toLocaleString('fr-FR'),
      action: formatAction(l.action, l.targetType),
      actor: l.actorType === 'SYSTEM' ? 'Règle automatique' : (l.actorId ?? l.actorType),
    }));
  } catch { /* non bloquant */ }

  return {
    rooms: roomData,
    totalCurrentKwh: roomData.reduce((s, r) => s + r.currentKwh, 0),
    totalPreviousKwh: roomData.reduce((s, r) => s + r.previousKwh, 0),
    globalTimeSeries,
    actionCount,
    auditRows,
  };
}

/** Génère et déclenche le téléchargement d'un CSV sur web */
export function exportCSV(data: ReportData, period: string): void {
  const rows: string[][] = [['Salle', 'Consommation (kWh)', 'Période précédente (kWh)', 'Δ (kWh)']];
  data.rooms.forEach((r) => {
    rows.push([
      r.roomName,
      r.currentKwh.toFixed(3),
      r.previousKwh.toFixed(3),
      (r.currentKwh - r.previousKwh).toFixed(3),
    ]);
  });
  rows.push([]);
  rows.push(['Date', 'Action', 'Acteur']);
  data.auditRows.forEach((a) => rows.push([a.date, a.action, a.actor]));

  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `powerlens-rapport-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
