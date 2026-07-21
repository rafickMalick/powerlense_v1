import axios from 'axios';

/**
 * Client HTTP central vers l'API NestJS PowerLens.
 *
 * Règle d'architecture (cf. claude.md) : l'app mobile ne parle JAMAIS
 * directement au broker MQTT ni au matériel ESP32. Toute commande ou
 * lecture passe par cette API REST (ou par le WebSocket pour le temps
 * réel, voir services/websocket.ts).
 */

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);
