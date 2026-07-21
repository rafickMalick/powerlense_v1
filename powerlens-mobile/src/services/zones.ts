import { api } from './api';
import type {
  MonitoringZone,
  Circuit,
  EnergyMeasurement,
  MeasurementAggregate,
  ZoneType,
  BuildingPowerStatus,
} from '@/types/models';
import type { MeasurementsQuery } from './measurements';

export interface FindZonesParams {
  buildingId?: string;
  type?: ZoneType;
  floor?: number;
}

export async function getZones(params?: FindZonesParams): Promise<MonitoringZone[]> {
  const { data } = await api.get<MonitoringZone[]>('/zones', { params });
  return data;
}

export async function getZone(zoneId: string): Promise<MonitoringZone> {
  const { data } = await api.get<MonitoringZone>(`/zones/${zoneId}`);
  return data;
}

export async function getZoneCircuits(zoneId: string): Promise<Circuit[]> {
  const { data } = await api.get<Circuit[]>(`/zones/${zoneId}/circuits`);
  return data;
}

export async function getZoneMeasurements(
  zoneId: string,
  query?: MeasurementsQuery,
): Promise<EnergyMeasurement[] | MeasurementAggregate[]> {
  const { data } = await api.get(`/zones/${zoneId}/measurements`, { params: query });
  return data;
}

/** Bascule groupée de l'alimentation d'une salle/couloir — une seule commande auditée côté backend. */
export async function setZonePowerStatus(
  zoneId: string,
  status: BuildingPowerStatus,
): Promise<{ zoneId: string; status: BuildingPowerStatus; affectedCircuitIds: string[] }> {
  const { data } = await api.patch(`/zones/${zoneId}/power-status`, { status });
  return data;
}
