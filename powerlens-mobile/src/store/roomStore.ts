import { create } from 'zustand';
import * as roomsService from '@/services/rooms';
import * as circuitsService from '@/services/circuits';
import * as zonesService from '@/services/zones';
import { connectSocket, off, on, type CircuitStatusPayload } from '@/services/websocket';
import { useUiStore } from '@/store/uiStore';
import { triggerHaptic } from '@/utils/haptics';
import type { BuildingPowerStatus, Circuit, Room } from '@/types/models';

const COMMAND_ERROR_MESSAGE = "Échec de la commande — vérifier la connexion à l'API";

const STATUS_TO_BUILDING_STATUS: Record<RoomUi['status'], BuildingPowerStatus> = {
  powered: 'POWERED',
  limited: 'LIMITED',
  cutoff: 'CUTOFF',
};

export interface RoomUi extends Room {
  status: 'powered' | 'limited' | 'cutoff';
  isPriority: boolean;
}

interface RoomState {
  rooms: RoomUi[];
  circuitsByRoom: Record<string, Circuit[]>;
  loading: boolean;
  error: string | null;
  subscribed: boolean;
  fetchRooms: (buildingId: string) => Promise<void>;
  fetchCircuits: (roomId: string) => Promise<void>;
  /** Retourne `false` (et affiche un toast d'erreur) si la commande a échoué — l'état local est alors restauré. */
  setRoomStatus: (roomId: string, status: RoomUi['status']) => Promise<boolean>;
  toggleCircuit: (roomId: string, circuit: Circuit) => Promise<boolean>;
  subscribe: () => void;
  unsubscribe: () => void;
}

function withRoomUiDefaults(room: Room): RoomUi {
  return { ...room, status: 'powered', isPriority: false };
}

const handleCircuitStatus = ({ circuitId, isActive }: CircuitStatusPayload) => {
  useRoomStore.setState((state) => {
    const roomId = Object.keys(state.circuitsByRoom).find((id) =>
      state.circuitsByRoom[id].some((c) => c.id === circuitId),
    );
    if (!roomId) return state;
    return {
      circuitsByRoom: {
        ...state.circuitsByRoom,
        [roomId]: state.circuitsByRoom[roomId].map((c) =>
          c.id === circuitId ? { ...c, isActive } : c,
        ),
      },
    };
  });
};

export const useRoomStore = create<RoomState>((set, get) => ({
  rooms: [],
  circuitsByRoom: {},
  loading: false,
  error: null,
  subscribed: false,

  fetchRooms: async (buildingId) => {
    set({ loading: true, error: null });
    try {
      const rooms = await roomsService.getRooms({ buildingId });
      set({ rooms: rooms.map(withRoomUiDefaults), loading: false });
    } catch {
      set({ loading: false, error: 'Impossible de charger les salles' });
    }
  },

  fetchCircuits: async (roomId) => {
    try {
      const circuits = await roomsService.getRoomCircuits(roomId);
      set({ circuitsByRoom: { ...get().circuitsByRoom, [roomId]: circuits } });
    } catch {
      set({ error: 'Impossible de charger les circuits' });
    }
  },

  /**
   * Bascule groupée pour toute la salle/couloir — délègue à
   * `PATCH /zones/:id/power-status` (une seule commande auditée côté
   * backend, cohérente avec la logique isCritical déjà utilisée par le
   * Control Center pour le bâtiment) plutôt que d'enchaîner un appel HTTP
   * par circuit, ce qui évitait un état incohérent en cas d'échec partiel.
   */
  setRoomStatus: async (roomId, status) => {
    const previousRooms = get().rooms;
    const previousCircuits = get().circuitsByRoom[roomId];

    set({
      rooms: get().rooms.map((r) => (r.id === roomId ? { ...r, status } : r)),
    });

    try {
      await zonesService.setZonePowerStatus(roomId, STATUS_TO_BUILDING_STATUS[status]);
      await get().fetchCircuits(roomId);
      return true;
    } catch {
      set({
        rooms: previousRooms,
        circuitsByRoom: { ...get().circuitsByRoom, [roomId]: previousCircuits ?? [] },
      });
      useUiStore.getState().showToast(COMMAND_ERROR_MESSAGE, 'error');
      return false;
    }
  },

  toggleCircuit: async (roomId, circuit) => {
    const next = !circuit.isActive;
    set({
      circuitsByRoom: {
        ...get().circuitsByRoom,
        [roomId]: (get().circuitsByRoom[roomId] ?? []).map((c) =>
          c.id === circuit.id ? { ...c, isActive: next } : c,
        ),
      },
    });
    try {
      if (next) await circuitsService.activateCircuit(circuit.id);
      else await circuitsService.deactivateCircuit(circuit.id);
      triggerHaptic('success');
      // Confirmation visible : le retour haptique seul est invisible sur le web.
      useUiStore
        .getState()
        .showToast(`${circuit.name} — ${next ? 'allumée' : 'éteinte'}`, 'success');
      return true;
    } catch {
      set({
        circuitsByRoom: {
          ...get().circuitsByRoom,
          [roomId]: (get().circuitsByRoom[roomId] ?? []).map((c) =>
            c.id === circuit.id ? { ...c, isActive: circuit.isActive } : c,
          ),
        },
      });
      triggerHaptic('error');
      useUiStore.getState().showToast(COMMAND_ERROR_MESSAGE, 'error');
      return false;
    }
  },

  subscribe: () => {
    useRoomStore.setState((state) => {
      if (state.subscribed) return state;
      connectSocket();
      on('circuit:status', handleCircuitStatus);
      return { subscribed: true };
    });
  },

  unsubscribe: () => {
    off('circuit:status', handleCircuitStatus);
    useRoomStore.setState({ subscribed: false });
  },
}));
