import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';
import type { Alert, EnergyMeasurement } from '@/types/models';

/**
 * Connexion temps réel à la RealtimeGateway (socket.io) du backend NestJS.
 * Évènements diffusés : 'measurement', 'alert', 'circuit:status', 'provider:switched', 'device:status'.
 * Pas d'authentification sur le socket pour l'instant (cf. rapport Phase A).
 */

export interface CircuitStatusPayload {
  circuitId: string;
  isActive: boolean;
}

export interface ProviderSwitchedPayload {
  mode: 'mqtt' | 'simulator';
  reason: string;
}

/**
 * Présence matérielle d'un device (LWT MQTT). `online:false` est publié par le
 * broker dès que l'ESP disparaît — détection immédiate, sans attendre le silence
 * des mesures.
 */
export interface DeviceStatusPayload {
  buildingId?: string;
  deviceUid?: string;
  online: boolean;
  at: string;
}

type Listeners = {
  measurement: (payload: EnergyMeasurement) => void;
  alert: (payload: Alert) => void;
  'circuit:status': (payload: CircuitStatusPayload) => void;
  'provider:switched': (payload: ProviderSwitchedPayload) => void;
  'device:status': (payload: DeviceStatusPayload) => void;
  connect: () => void;
  disconnect: () => void;
};

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket) return socket;
  socket = io(API_URL, { transports: ['websocket'], autoConnect: true });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function on<E extends keyof Listeners>(event: E, handler: Listeners[E]) {
  connectSocket().on(event as string, handler as (...args: unknown[]) => void);
}

export function off<E extends keyof Listeners>(event: E, handler: Listeners[E]) {
  socket?.off(event as string, handler as (...args: unknown[]) => void);
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
