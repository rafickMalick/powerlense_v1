import { api } from './api';
import type { Building, BuildingPowerStatus, Room } from '@/types/models';

export async function getBuildings(): Promise<Building[]> {
  const { data } = await api.get<Building[]>('/buildings');
  return data;
}

export async function getBuilding(id: string): Promise<Building> {
  const { data } = await api.get<Building>(`/buildings/${id}`);
  return data;
}

export async function getBuildingRooms(id: string): Promise<Room[]> {
  const { data } = await api.get<Room[]>(`/buildings/${id}/rooms`);
  return data;
}

export interface UpdateBuildingPayload {
  name?: string;
  location?: string;
  description?: string;
}

export async function updateBuilding(
  id: string,
  payload: UpdateBuildingPayload,
): Promise<Building> {
  const { data } = await api.patch<Building>(`/buildings/${id}`, payload);
  return data;
}

export async function setBuildingPowerStatus(
  id: string,
  status: BuildingPowerStatus,
): Promise<Building> {
  const { data } = await api.patch<Building>(`/buildings/${id}/power-status`, { status });
  return data;
}
