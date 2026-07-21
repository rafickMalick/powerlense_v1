import { api } from './api';
import type { Circuit, MeasurementAggregate, EnergyMeasurement, Room } from '@/types/models';
import type { MeasurementsQuery } from './measurements';

export interface FindRoomsParams {
  buildingId?: string;
  floor?: number;
}

export async function getRooms(params?: FindRoomsParams): Promise<Room[]> {
  const { data } = await api.get<Room[]>('/rooms', { params });
  return data;
}

export async function getRoomCircuits(roomId: string): Promise<Circuit[]> {
  const { data } = await api.get<Circuit[]>(`/rooms/${roomId}/circuits`);
  return data;
}

export async function getRoomMeasurements(
  roomId: string,
  query?: MeasurementsQuery,
): Promise<EnergyMeasurement[] | MeasurementAggregate[]> {
  const { data } = await api.get(`/rooms/${roomId}/measurements`, { params: query });
  return data;
}
