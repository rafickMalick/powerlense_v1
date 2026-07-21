import { api } from './api';
import type {
  PaginatedRecommendations,
  RecommendationConfidence,
  RecommendationStatus,
  RecommendationType,
  RuleAction,
  RuleCondition,
  RuleRecommendation,
  SupervisorRun,
} from '@/types/models';

export interface RecommendationsFilters {
  status?: RecommendationStatus;
  buildingId?: string;
  type?: RecommendationType;
  confidence?: RecommendationConfidence;
  page?: number;
  pageSize?: number;
}

export interface ReviewRecommendationPayload {
  comment?: string;
  overrideConditions?: RuleCondition;
  overrideActions?: RuleAction[];
}

export async function getRecommendations(
  filters?: RecommendationsFilters,
): Promise<PaginatedRecommendations> {
  const { data } = await api.get<PaginatedRecommendations>('/supervisor/recommendations', {
    params: filters,
  });
  return data;
}

export async function getRecommendation(id: string): Promise<RuleRecommendation> {
  const { data } = await api.get<RuleRecommendation>(`/supervisor/recommendations/${id}`);
  return data;
}

export async function approveRecommendation(
  id: string,
  payload?: ReviewRecommendationPayload,
): Promise<RuleRecommendation> {
  const { data } = await api.patch<RuleRecommendation>(
    `/supervisor/recommendations/${id}/approve`,
    payload ?? {},
  );
  return data;
}

export async function rejectRecommendation(
  id: string,
  comment?: string,
): Promise<RuleRecommendation> {
  const { data } = await api.patch<RuleRecommendation>(
    `/supervisor/recommendations/${id}/reject`,
    { comment },
  );
  return data;
}

export async function getSupervisorRuns(limit?: number): Promise<SupervisorRun[]> {
  const { data } = await api.get<SupervisorRun[]>('/supervisor/runs', { params: { limit } });
  return data;
}

export async function triggerSupervisorRun(): Promise<{ runId: string }> {
  const { data } = await api.post<{ runId: string }>('/supervisor/runs/trigger');
  return data;
}
