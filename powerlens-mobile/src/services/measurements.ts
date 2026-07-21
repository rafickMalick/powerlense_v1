import { api } from './api';

export type MeasurementGranularity = 'hour' | 'day' | 'week' | 'month';

export interface MeasurementsQuery {
  from?: string;
  to?: string;
  granularity?: MeasurementGranularity;
}

/** Consommation réelle depuis minuit (diff de compteur cumulatif, pas une somme d'échantillons). */
export async function getEnergyToday(buildingId: string): Promise<{ totalKwh: number }> {
  const { data } = await api.get<{ totalKwh: number }>('/measurements/energy-today', {
    params: { buildingId },
  });
  return data;
}
