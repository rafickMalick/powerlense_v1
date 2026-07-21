import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, setAuthToken } from './api';
import type { User } from '@/types/models';

const TOKEN_KEY = 'powerlens_jwt';

// expo-secure-store has no web implementation — fall back to localStorage
const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === 'web') { localStorage.removeItem(key); return; }
    await SecureStore.deleteItemAsync(key);
  },
};

interface LoginResponse {
  access_token: string;
}

/**
 * NB: le token JWT expire en 15 min (JWT_EXPIRES_IN côté backend) et il
 * n'existe pas encore d'endpoint /auth/refresh. En cas de 401, l'utilisateur
 * est redirigé vers l'écran de connexion (voir authStore + onUnauthorized).
 */
export async function login(email: string, password: string): Promise<User> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  await storage.setItem(TOKEN_KEY, data.access_token);
  setAuthToken(data.access_token);
  return fetchMe();
}

export async function fetchMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me');
  return data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // non-bloquant — la déconnexion locale doit toujours réussir
  }
  await storage.deleteItem(TOKEN_KEY);
  setAuthToken(null);
}

/** Restaure le token stocké au démarrage de l'app et tente /auth/me. */
export async function restoreSession(): Promise<User | null> {
  const token = await storage.getItem(TOKEN_KEY);
  if (!token) return null;

  setAuthToken(token);
  try {
    return await fetchMe();
  } catch {
    await storage.deleteItem(TOKEN_KEY);
    setAuthToken(null);
    return null;
  }
}
