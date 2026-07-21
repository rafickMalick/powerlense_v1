import { api } from './api';
import type { Alert } from '@/types/models';

interface PaginatedAlerts {
  items: Alert[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAlerts(buildingId: string): Promise<Alert[]> {
  const { data } = await api.get<PaginatedAlerts>('/alerts', { params: { buildingId, pageSize: 50 } });
  return data.items;
}

export async function acknowledgeAlert(id: string): Promise<Alert> {
  const { data } = await api.patch<Alert>(`/alerts/${id}/acknowledge`);
  return data;
}
