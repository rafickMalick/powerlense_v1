import { create } from 'zustand';
import { connectSocket, off, on } from '@/services/websocket';
import { useUiStore } from '@/store/uiStore';
import * as alertsService from '@/services/alerts';
import type { Alert, AlertUiOrigin, AlertUiType } from '@/types/models';

export interface AlertUi extends Alert {
  type: AlertUiType;
  origin: AlertUiOrigin;
  room?: string;
}

function toAlertUi(alert: Alert): AlertUi {
  const type: AlertUiType =
    alert.level === 'CRITICAL' ? 'surcharge' : alert.level === 'WARNING' ? 'limitation' : 'action';
  return { ...alert, type, origin: alert.ruleId ? 'règle' : 'manuel' };
}

interface AlertsState {
  alerts: AlertUi[];
  subscribed: boolean;
  loading: boolean;
  subscribe: () => void;
  unsubscribe: () => void;
  fetchInitial: (buildingId: string) => Promise<void>;
  acknowledge: (id: string) => Promise<void>;
  addLocalAlert: (alert: Omit<AlertUi, 'id' | 'createdAt' | 'acknowledged'>) => void;
}

const handleAlert = (payload: Alert) => {
  useAlertsStore.setState((state) => {
    if (state.alerts.some((a) => a.id === payload.id)) return state;
    return { alerts: [toAlertUi(payload), ...state.alerts] };
  });
  // Rend visible immédiatement toute alerte non-informative (ex : commande envoyée
  // au matériel mais jamais confirmée — cf. CommandTrackerService côté backend).
  if (payload.level === 'WARNING' || payload.level === 'CRITICAL') {
    useUiStore.getState().showToast(payload.message, 'error', 5000);
  }
};

export const useAlertsStore = create<AlertsState>((set, get) => ({
  alerts: [],
  subscribed: false,
  loading: false,

  subscribe: () => {
    if (get().subscribed) return;
    connectSocket();
    on('alert', handleAlert);
    set({ subscribed: true });
  },

  unsubscribe: () => {
    off('alert', handleAlert);
    set({ subscribed: false });
  },

  /** Charge l'historique persisté (GET /alerts) — complète les alertes reçues en direct par WS,
   * qui seules n'existaient qu'en mémoire depuis l'ouverture de l'app (cf. STATE.md V10). */
  fetchInitial: async (buildingId) => {
    set({ loading: true });
    try {
      const fetched = await alertsService.getAlerts(buildingId);
      set((state) => {
        const existingIds = new Set(state.alerts.map((a) => a.id));
        const merged = [
          ...state.alerts,
          ...fetched.filter((a) => !existingIds.has(a.id)).map(toAlertUi),
        ];
        merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return { alerts: merged };
      });
    } finally {
      set({ loading: false });
    }
  },

  acknowledge: async (id) => {
    const updated = await alertsService.acknowledgeAlert(id);
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === id ? { ...a, acknowledged: updated.acknowledged } : a)),
    }));
  },

  addLocalAlert: (alert) =>
    set((state) => ({
      alerts: [
        {
          ...alert,
          id: `local-${Date.now()}`,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        },
        ...state.alerts,
      ],
    })),
}));
