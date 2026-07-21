import { create } from 'zustand';
import { connectSocket, disconnectSocket, isSocketConnected, off, on, type ProviderSwitchedPayload, type DeviceStatusPayload } from '@/services/websocket';

export interface ToastData {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface UiState {
  socketConnected: boolean;
  providerMode: 'mqtt' | 'simulator';
  deviceOnline: boolean;
  /** Présence par boîtier (deviceUid → en ligne) — pour la vue « Boîtiers ». */
  devicesOnline: Record<string, boolean>;
  toast: ToastData | null;
  initSocket: () => void;
  teardownSocket: () => void;
  showToast: (message: string, type?: ToastData['type'], duration?: number) => void;
}

const handleConnect = () => useUiStore.setState({ socketConnected: true });
const handleDisconnect = () => useUiStore.setState({ socketConnected: false });
const handleProviderSwitch = (payload: ProviderSwitchedPayload) => {
  useUiStore.setState({ providerMode: payload.mode });
};
// LWT : présence matérielle de l'ESP, détectée immédiatement (plus besoin
// d'attendre le silence des mesures / ESP_TIMEOUT_MS côté backend).
const handleDeviceStatus = (payload: DeviceStatusPayload) => {
  useUiStore.setState((s) => ({
    deviceOnline: payload.online, // dernier boîtier vu (rétro-compat indicateur global)
    devicesOnline: payload.deviceUid
      ? { ...s.devicesOnline, [payload.deviceUid]: payload.online }
      : s.devicesOnline,
  }));
};

/**
 * État global de l'interface :
 * - socketConnected : connexion WebSocket active (lien app ↔ backend)
 * - providerMode : 'mqtt' = ESP32 réels, 'simulator' = données synthétiques
 * - deviceOnline : présence matérielle de l'ESP (LWT MQTT) — pilote l'indicateur
 *   "Hors ligne" et le grisage des commandes
 */
export const useUiStore = create<UiState>((set, get) => ({
  socketConnected: false,
  providerMode: 'simulator', // Valeur par défaut avant la première connexion
  deviceOnline: false, // présumé hors ligne tant qu'aucun statut LWT n'est reçu
  devicesOnline: {},
  toast: null,

  showToast: (message, type = 'info', duration = 3000) => {
    const id = Date.now();
    set({ toast: { id, message, type } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, duration);
  },

  initSocket: () => {
    const socket = connectSocket();
    set({ socketConnected: socket.connected });
    on('connect', handleConnect);
    on('disconnect', handleDisconnect);
    on('provider:switched', handleProviderSwitch);
    on('device:status', handleDeviceStatus);
  },

  teardownSocket: () => {
    off('connect', handleConnect);
    off('disconnect', handleDisconnect);
    off('provider:switched', handleProviderSwitch);
    off('device:status', handleDeviceStatus);
    disconnectSocket();
    set({ socketConnected: false, deviceOnline: false });
  },
}));

export function getSocketConnected(): boolean {
  return isSocketConnected();
}
