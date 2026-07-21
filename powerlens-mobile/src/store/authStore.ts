import { create } from 'zustand';
import * as authService from '@/services/auth';
import { setUnauthorizedHandler } from '@/services/api';
import type { User } from '@/types/models';

interface AuthState {
  user: User | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'idle',
  error: null,

  login: async (email, password) => {
    set({ status: 'loading', error: null });
    try {
      const user = await authService.login(email, password);
      set({ user, status: 'authenticated' });
    } catch (e) {
      console.error('[Login] Erreur réelle:', e);
      set({ status: 'unauthenticated', error: 'Identifiants invalides' });
      throw new Error('Identifiants invalides');
    }
  },

  logout: async () => {
    await authService.logout();
    set({ user: null, status: 'unauthenticated' });
  },

  restore: async () => {
    set({ status: 'loading' });
    try {
      const user = await authService.restoreSession();
      set({ user, status: user ? 'authenticated' : 'unauthenticated' });
    } catch {
      set({ user: null, status: 'unauthenticated' });
    }
  },
}));

// Déconnexion automatique si l'API renvoie 401 (JWT expiré, cf. rapport Phase A).
setUnauthorizedHandler(() => {
  useAuthStore.setState({ user: null, status: 'unauthenticated' });
});
