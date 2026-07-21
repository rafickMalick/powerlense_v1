import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface OnboardingState {
  hasSeenIntro: boolean;
  dismissedTooltips: Record<string, boolean>;
  completeIntro: () => void;
  dismissTooltip: (key: string) => void;
  resetOnboarding: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      hasSeenIntro: false,
      dismissedTooltips: {},

      completeIntro: () => set({ hasSeenIntro: true }),

      dismissTooltip: (key) =>
        set((state) => ({ dismissedTooltips: { ...state.dismissedTooltips, [key]: true } })),

      /** Utile en démo live pour rejouer l'introduction sur scène. */
      resetOnboarding: () => set({ hasSeenIntro: false, dismissedTooltips: {} }),
    }),
    {
      name: 'powerlens-onboarding',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
