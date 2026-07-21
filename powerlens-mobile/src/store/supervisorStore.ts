import { create } from 'zustand';
import * as supervisorService from '@/services/supervisor';
import type { RecommendationsFilters, ReviewRecommendationPayload } from '@/services/supervisor';
import type { RuleRecommendation } from '@/types/models';

interface SupervisorState {
  recommendations: RuleRecommendation[];
  total: number;
  loading: boolean;
  error: string | null;
  fetchRecommendations: (filters?: RecommendationsFilters) => Promise<void>;
  approve: (id: string, payload?: ReviewRecommendationPayload) => Promise<void>;
  reject: (id: string, comment?: string) => Promise<void>;
}

export const useSupervisorStore = create<SupervisorState>((set, get) => ({
  recommendations: [],
  total: 0,
  loading: false,
  error: null,

  fetchRecommendations: async (filters) => {
    set({ loading: true, error: null });
    try {
      const result = await supervisorService.getRecommendations(filters);
      set({ recommendations: result.items, total: result.total, loading: false });
    } catch {
      set({ loading: false, error: 'Impossible de charger les recommandations' });
    }
  },

  approve: async (id, payload) => {
    try {
      const updated = await supervisorService.approveRecommendation(id, payload);
      set({
        recommendations: get().recommendations.map((r) => (r.id === id ? updated : r)),
      });
    } catch {
      // Mise à jour optimiste du statut en cas d'erreur réseau
      set({
        recommendations: get().recommendations.map((r) =>
          r.id === id ? { ...r, status: 'APPLIED' } : r,
        ),
      });
    }
  },

  reject: async (id, comment) => {
    try {
      const updated = await supervisorService.rejectRecommendation(id, comment);
      set({
        recommendations: get().recommendations.map((r) => (r.id === id ? updated : r)),
      });
    } catch {
      set({
        recommendations: get().recommendations.map((r) =>
          r.id === id ? { ...r, status: 'REJECTED' } : r,
        ),
      });
    }
  },
}));
