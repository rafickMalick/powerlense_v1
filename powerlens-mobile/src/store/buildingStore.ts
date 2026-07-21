import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as buildingsService from '@/services/buildings';
import type { Building, BuildingPowerStatus } from '@/types/models';

export interface BuildingUi extends Building {
  maxPower: number;
  currentPower: number;
}

export interface BuildingFormInput {
  name: string;
  location: string;
  maxPower: number;
}

interface BuildingState {
  buildings: BuildingUi[];
  activeBuildingId: string | null;
  loading: boolean;
  error: string | null;
  fetchBuildings: () => Promise<void>;
  setActiveBuilding: (id: string) => void;
  /** PATCH /buildings/:id (name/location). */
  updateBuildingInfo: (id: string, input: BuildingFormInput) => Promise<void>;
  /** PATCH /buildings/:id/power-status — bascule réelle côté backend (Control Center). */
  setBuildingPowerStatus: (id: string, status: BuildingPowerStatus) => Promise<void>;
}

function withUiDefaults(building: Building): BuildingUi {
  return { ...building, maxPower: 0, currentPower: 0 };
}

export const useBuildingStore = create<BuildingState>()(
  persist(
    (set, get) => ({
      buildings: [],
      activeBuildingId: null,
      loading: false,
      error: null,

      fetchBuildings: async () => {
        set({ loading: true, error: null });
        try {
          const buildings = await buildingsService.getBuildings();
          const buildingsUi = buildings.map(withUiDefaults);
          set((state) => {
            // L'id actif est PERSISTÉ dans le navigateur : il peut pointer sur un
            // bâtiment qui n'existe plus (base réinitialisée, bâtiment supprimé).
            // Dans ce cas on retombe sur le premier disponible, sinon l'app reste
            // bloquée sur « Aucun bâtiment sélectionné » avec tous les écrans vides.
            const activeStillExists = buildingsUi.some((b) => b.id === state.activeBuildingId);
            return {
              buildings: buildingsUi,
              activeBuildingId: activeStillExists
                ? state.activeBuildingId
                : (buildingsUi[0]?.id ?? null),
              loading: false,
            };
          });
        } catch {
          set({ loading: false, error: 'Impossible de charger les bâtiments' });
        }
      },

      setActiveBuilding: (id) => set({ activeBuildingId: id }),

      updateBuildingInfo: async (id, input) => {
        const updated = await buildingsService.updateBuilding(id, { name: input.name, location: input.location });
        set({
          buildings: get().buildings.map((b) =>
            b.id === id ? { ...b, ...updated, maxPower: input.maxPower } : b,
          ),
        });
      },

      setBuildingPowerStatus: async (id, status) => {
        const updated = await buildingsService.setBuildingPowerStatus(id, status);
        set({
          buildings: get().buildings.map((b) => (b.id === id ? { ...b, ...updated } : b)),
        });
      },
    }),
    {
      name: 'powerlens-building',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ activeBuildingId: state.activeBuildingId }),
    },
  ),
);

export function useActiveBuilding(): BuildingUi | null {
  return useBuildingStore((state) => state.buildings.find((b) => b.id === state.activeBuildingId) ?? null);
}
