import { api } from './api';
import type { Rule, RuleAction, RuleCondition, RuleType } from '@/types/models';

export interface CreateRulePayload {
  name: string;
  ruleType: RuleType;
  conditions: RuleCondition;
  actions: RuleAction[];
  buildingId: string;
}

export type UpdateRulePayload = Partial<CreateRulePayload> & { isActive?: boolean };

export async function getRules(): Promise<Rule[]> {
  const { data } = await api.get<Rule[]>('/rules');
  return data;
}

export async function getRule(id: string): Promise<Rule> {
  const { data } = await api.get<Rule>(`/rules/${id}`);
  return data;
}

export async function createRule(payload: CreateRulePayload): Promise<Rule> {
  const { data } = await api.post<Rule>('/rules', payload);
  return data;
}

export async function updateRule(id: string, payload: UpdateRulePayload): Promise<Rule> {
  const { data } = await api.patch<Rule>(`/rules/${id}`, payload);
  return data;
}

/** DELETE /rules/:id désactive la règle (isActive=false) côté backend. */
export async function disableRule(id: string): Promise<Rule> {
  const { data } = await api.delete<Rule>(`/rules/${id}`);
  return data;
}
