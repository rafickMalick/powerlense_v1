import { useCallback, useMemo, useState } from 'react';
import { createDefaultWizardState, type WizardState } from './ruleWizardMapping';

export const WIZARD_STEP_TITLES = ['Condition', 'Salle ou couloir', 'Charge', 'Action', 'Récapitulatif'];

export function useRuleWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<WizardState>(createDefaultWizardState());

  const patch = useCallback((partial: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...partial }));
  }, []);

  const canGoNext = useMemo(() => {
    switch (stepIndex) {
      case 0:
        if (state.conditionType === 'THRESHOLD') {
          return state.threshold.value.trim() !== '' && !Number.isNaN(Number(state.threshold.value));
        }
        if (state.conditionType === 'SCHEDULE') {
          return !!state.schedule.startTime && !!state.schedule.endTime;
        }
        return true; // présence : toujours valide, choix par défaut fourni
      case 1:
        return !!state.zoneId;
      case 2:
        return state.chargeMode === 'ZONE' || state.circuitIds.length > 0;
      case 3:
        return true;
      case 4:
        return state.name.trim() !== '';
      default:
        return false;
    }
  }, [stepIndex, state]);

  const goNext = useCallback(() => setStepIndex((i) => Math.min(i + 1, WIZARD_STEP_TITLES.length - 1)), []);
  const goBack = useCallback(() => setStepIndex((i) => Math.max(i - 1, 0)), []);

  return {
    stepIndex,
    stepCount: WIZARD_STEP_TITLES.length,
    stepTitle: WIZARD_STEP_TITLES[stepIndex],
    state,
    setState,
    patch,
    canGoNext,
    goNext,
    goBack,
  };
}
