import { api } from './api';
import type { Channel, Circuit, EnergyMeasurement, MeasurementAggregate } from '@/types/models';
import type { MeasurementsQuery } from './measurements';

export async function getCircuit(id: string): Promise<Circuit> {
  const { data } = await api.get<Circuit>(`/circuits/${id}`);
  return data;
}

export async function getCircuitChannels(id: string): Promise<Channel[]> {
  const { data } = await api.get<Channel[]>(`/circuits/${id}/channels`);
  return data;
}

export async function getCircuitMeasurements(
  id: string,
  query?: MeasurementsQuery,
): Promise<EnergyMeasurement[] | MeasurementAggregate[]> {
  const { data } = await api.get(`/circuits/${id}/measurements`, { params: query });
  return data;
}

export interface UpdateCircuitPayload {
  name?: string;
  maxPowerWatt?: number;
}

export async function updateCircuit(id: string, payload: UpdateCircuitPayload): Promise<Circuit> {
  const { data } = await api.patch<Circuit>(`/circuits/${id}`, payload);
  return data;
}

export async function activateCircuit(id: string): Promise<Circuit> {
  const { data } = await api.patch<Circuit>(`/circuits/${id}/activate`);
  return data;
}

export async function deactivateCircuit(id: string): Promise<Circuit> {
  const { data } = await api.patch<Circuit>(`/circuits/${id}/deactivate`);
  return data;
}
