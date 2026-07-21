import { create } from 'zustand';
import * as zonesService from '@/services/zones';
import * as measurementsService from '@/services/measurements';
import { connectSocket, off, on } from '@/services/websocket';
import type { EnergyMeasurement, MeasurementAggregate } from '@/types/models';

export interface ConsumptionPoint {
  time: string;
  value: number;
}

interface MeasurementsState {
  consumption24h: ConsumptionPoint[];
  latestByZone: Record<string, EnergyMeasurement>;
  totalPower: number;
  /** Consommation réelle depuis minuit (kWh) — distinct de la somme des compteurs cumulatifs de latestByZone. */
  energyTodayKwh: number;
  loading: boolean;
  subscribed: boolean;
  fetchConsumption24h: (zoneId: string) => Promise<void>;
  fetchEnergyToday: (buildingId: string) => Promise<void>;
  subscribe: () => void;
  unsubscribe: () => void;
}

function computeTotalPower(byZone: Record<string, EnergyMeasurement>): number {
  return Object.values(byZone).reduce((sum, m) => sum + (m.power ?? 0), 0);
}

function applyMeasurement(payload: EnergyMeasurement) {
  useMeasurementsStore.setState((state) => {
    const latestByZone = { ...state.latestByZone, [payload.zoneId]: payload };
    return { latestByZone, totalPower: computeTotalPower(latestByZone) };
  });
}

/**
 * Throttle par zone (max ~1 mise à jour store / 500ms) — recommandé par
 * docs/websocket.md mais jamais implémenté jusqu'ici. Le simulateur peut
 * publier toutes les 200ms (mode démo), ce qui re-rendrait le Dashboard et
 * les deux écrans Twin à chaque tick sans throttle.
 */
const THROTTLE_MS = 500;
const lastAppliedAtByZone: Record<string, number> = {};
const pendingTimerByZone: Record<string, ReturnType<typeof setTimeout>> = {};
const pendingPayloadByZone: Record<string, EnergyMeasurement> = {};

const handleMeasurement = (payload: EnergyMeasurement) => {
  const zoneId = payload.zoneId;
  const now = Date.now();
  const elapsed = now - (lastAppliedAtByZone[zoneId] ?? 0);

  if (elapsed >= THROTTLE_MS) {
    lastAppliedAtByZone[zoneId] = now;
    applyMeasurement(payload);
    return;
  }

  pendingPayloadByZone[zoneId] = payload;
  if (!pendingTimerByZone[zoneId]) {
    pendingTimerByZone[zoneId] = setTimeout(() => {
      delete pendingTimerByZone[zoneId];
      lastAppliedAtByZone[zoneId] = Date.now();
      applyMeasurement(pendingPayloadByZone[zoneId]);
    }, THROTTLE_MS - elapsed);
  }
};

function isAggregate(value: unknown): value is MeasurementAggregate {
  return typeof value === 'object' && value !== null && 'bucket' in value;
}

export const useMeasurementsStore = create<MeasurementsState>((set) => ({
  consumption24h: [],
  latestByZone: {},
  totalPower: 0,
  energyTodayKwh: 0,
  loading: false,
  subscribed: false,

  fetchConsumption24h: async (zoneId) => {
    set({ loading: true });
    try {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const data = await zonesService.getZoneMeasurements(zoneId, {
        granularity: 'hour',
        from,
      });

      const points: ConsumptionPoint[] = data.map((d) => {
        const date = new Date(isAggregate(d) ? d.bucket : d.measuredAt);
        const power = isAggregate(d) ? (d.avgPower ?? 0) : (d.power ?? 0);
        return { time: `${date.getHours().toString().padStart(2, '0')}h`, value: Math.round(power) };
      });
      set({ consumption24h: points, loading: false });
    } catch {
      set({ consumption24h: [], loading: false });
    }
  },

  fetchEnergyToday: async (buildingId) => {
    try {
      const { totalKwh } = await measurementsService.getEnergyToday(buildingId);
      set({ energyTodayKwh: totalKwh });
    } catch {
      set({ energyTodayKwh: 0 });
    }
  },

  subscribe: () => {
    useMeasurementsStore.setState((state) => {
      if (state.subscribed) return state;
      connectSocket();
      on('measurement', handleMeasurement);
      return { subscribed: true };
    });
  },

  unsubscribe: () => {
    off('measurement', handleMeasurement);
    useMeasurementsStore.setState({ subscribed: false });
  },
}));
