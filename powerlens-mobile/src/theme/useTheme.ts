import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colorScheme } from 'nativewind';
import { palette, paletteDark, setPaletteMode } from './palette';

export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

/**
 * Applique le thème :
 *  1. à NativeWind (classe `dark` sur la racine → repeint tous les `className`) ;
 *  2. à la palette JS (couleurs des icônes lucide / SVG / graphiques).
 */
function apply(mode: ThemeMode) {
  colorScheme.set(mode);
  setPaletteMode(mode);
}

/**
 * Thème PARTAGÉ par toute l'application (exigence du handoff : un état global,
 * pas un state par écran) et PERSISTÉ : le choix survit au rechargement.
 * Les écrans n'ont rien à faire — basculer le mode repeint l'app via les
 * variables CSS (cf. src/theme/global.css).
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'light',
      setMode: (mode) => {
        apply(mode);
        set({ mode });
      },
      toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
    }),
    {
      name: 'powerlens-theme',
      storage: createJSONStorage(() => AsyncStorage),
      // Réapplique le thème enregistré une fois la persistance restaurée.
      onRehydrateStorage: () => (state) => {
        if (state) apply(state.mode);
      },
    },
  ),
);

/**
 * Couleurs à utiliser hors `className` (icônes lucide, SVG, graphiques) :
 * renvoie la palette correspondant au thème courant.
 */
export function useThemeColors() {
  const mode = useThemeStore((s) => s.mode);
  return mode === 'dark' ? paletteDark : palette;
}
