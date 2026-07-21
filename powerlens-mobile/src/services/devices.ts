import { api } from './api';
import type { Device } from '@/types/models';

/** Liste des boîtiers enregistrés (auto-déclarés) + leurs charges. */
export async function getDevices(): Promise<Device[]> {
  const { data } = await api.get<Device[]>('/devices');
  return data;
}
