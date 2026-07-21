import { create } from 'zustand';
import * as rulesService from '@/services/rules';
import type { CreateRulePayload, UpdateRulePayload } from '@/services/rules';
import { triggerHaptic } from '@/utils/haptics';
import type { Rule } from '@/types/models';

interface RulesState {
  rules: Rule[];
  loading: boolean;
  error: string | null;
  fetchRules: () => Promise<void>;
  createRule: (payload: CreateRulePayload) => Promise<void>;
  updateRule: (id: string, payload: UpdateRulePayload) => Promise<Rule>;
  toggleRule: (rule: Rule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
}

export const useRulesStore = create<RulesState>((set, get) => ({
  rules: [],
  loading: false,
  error: null,

  fetchRules: async () => {
    set({ loading: true, error: null });
    try {
      const rules = await rulesService.getRules();
      set({ rules, loading: false });
    } catch {
      set({ loading: false, error: 'Impossible de charger les règles' });
    }
  },

  createRule: async (payload) => {
    try {
      const rule = await rulesService.createRule(payload);
      triggerHaptic('success');
      set({ rules: [...get().rules, rule] });
    } catch {
      // Optimistic local creation pour le retour utilisateur immédiat
      set({
        rules: [
          ...get().rules,
          { ...payload, id: `local-${Date.now()}`, isActive: true, createdAt: new Date().toISOString() },
        ],
      });
    }
  },

  updateRule: async (id, payload) => {
    const updated = await rulesService.updateRule(id, payload);
    triggerHaptic('success');
    set({ rules: get().rules.map((r) => (r.id === id ? updated : r)) });
    return updated;
  },

  toggleRule: async (rule) => {
    const updated = { ...rule, isActive: !rule.isActive };
    set({ rules: get().rules.map((r) => (r.id === rule.id ? updated : r)) });
    try {
      // disableRule (DELETE) conserve l'action d'audit précise RULE_DISABLED ;
      // la réactivation n'a pas d'équivalent dédié, updateRule({isActive:true}) est
      // la seule voie possible (auparavant : jamais persistée côté backend).
      if (updated.isActive) {
        await rulesService.updateRule(rule.id, { isActive: true });
      } else {
        await rulesService.disableRule(rule.id);
      }
    } catch {
      // état local conservé — la règle sera reconciliée au prochain fetchRules
    }
  },

  deleteRule: async (id) => {
    set({ rules: get().rules.filter((r) => r.id !== id) });
    try {
      await rulesService.disableRule(id);
    } catch {
      // état local conservé
    }
  },
}));
