import { getCircuit } from '@/services/circuits';
import type { Rule, RuleAction, RuleCondition, RuleType } from '@/types/models';

export type WizardConditionType = 'THRESHOLD' | 'SCHEDULE' | 'PRESENCE';
export type ThresholdFieldValue = 'voltage' | 'current' | 'power' | 'temperature';
export type SchedDaysPreset = 'ALL' | 'WEEKDAYS' | 'WEEKEND';
export type ChargeMode = 'ZONE' | 'CIRCUITS';
export type WizardActionType = 'SWITCH_OFF' | 'MAINTAIN';

export const THRESHOLD_FIELDS: { label: string; value: ThresholdFieldValue; unit: string }[] = [
  { label: 'Tension', value: 'voltage', unit: 'V' },
  { label: 'Courant', value: 'current', unit: 'A' },
  { label: 'Puissance', value: 'power', unit: 'W' },
  { label: 'Température', value: 'temperature', unit: '°C' },
];

const CURATED_THRESHOLD_FIELDS = new Set<string>(THRESHOLD_FIELDS.map((f) => f.value));

export interface WizardState {
  name: string;
  conditionType: WizardConditionType;
  threshold: { field: ThresholdFieldValue; operator: '>' | '<'; value: string };
  schedule: { startTime: string; endTime: string; daysPreset: SchedDaysPreset };
  presence: { expected: 'PRESENT' | 'ABSENT' };
  zoneId: string | null;
  chargeMode: ChargeMode;
  circuitIds: string[];
  action: WizardActionType;
  /** Actions non représentables par l'assistant (ex. une ALERT conservée sur
   * une règle migrée) — jamais reconstruites depuis les champs du formulaire,
   * réinjectées telles quelles à la sauvegarde pour ne perdre aucune donnée. */
  preservedTailActions: RuleAction[];
}

export function createDefaultWizardState(): WizardState {
  return {
    name: '',
    conditionType: 'THRESHOLD',
    threshold: { field: 'power', operator: '>', value: '' },
    schedule: { startTime: '19:30', endTime: '07:30', daysPreset: 'ALL' },
    presence: { expected: 'ABSENT' },
    zoneId: null,
    chargeMode: 'CIRCUITS',
    circuitIds: [],
    action: 'SWITCH_OFF',
    preservedTailActions: [],
  };
}

function daysForPreset(preset: SchedDaysPreset): number[] | undefined {
  switch (preset) {
    case 'WEEKDAYS':
      return [1, 2, 3, 4, 5];
    case 'WEEKEND':
      return [0, 6];
    case 'ALL':
      return undefined;
  }
}

/** Retourne 'ALL' aussi bien pour "pas de restriction" que pour "combinaison
 * de jours non représentée par les 3 préréglages" — les deux cas sont
 * distingués par l'appelant selon que `days` était défini ou non en entrée. */
function presetForDays(days: number[] | undefined): SchedDaysPreset {
  if (!days || days.length === 0) return 'ALL';
  const set = new Set(days);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'WEEKDAYS';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'WEEKEND';
  return 'ALL';
}

export function buildConditionFromWizard(state: WizardState): RuleCondition {
  switch (state.conditionType) {
    case 'THRESHOLD':
      return {
        type: 'THRESHOLD',
        field: state.threshold.field,
        operator: state.threshold.operator,
        value: Number(state.threshold.value) || 0,
        zoneId: state.zoneId ?? undefined,
      };
    case 'SCHEDULE': {
      const days = daysForPreset(state.schedule.daysPreset);
      return {
        type: 'SCHEDULE',
        startTime: state.schedule.startTime,
        endTime: state.schedule.endTime,
        ...(days ? { days } : {}),
      };
    }
    case 'PRESENCE':
      return { type: 'PRESENCE', expected: state.presence.expected, zoneId: state.zoneId ?? undefined };
  }
}

export function buildActionsFromWizard(state: WizardState): RuleAction[] {
  const mainActions: RuleAction[] =
    state.chargeMode === 'ZONE'
      ? [{ type: state.action, targetType: 'ZONE', targetId: state.zoneId ?? undefined }]
      : state.circuitIds.map((id) => ({ type: state.action, targetType: 'CIRCUIT', targetId: id }));
  return [...mainActions, ...state.preservedTailActions];
}

export function ruleTypeFromWizard(conditionType: WizardConditionType): RuleType {
  return conditionType;
}

export type ConformanceResult =
  | { conforming: true; state: WizardState }
  | { conforming: false; reason: string };

/**
 * Reconstruit l'état de l'assistant à partir d'une règle existante, pour
 * l'édition. Ne renvoie JAMAIS un état partiel/approximatif : soit la règle
 * est entièrement représentable par l'assistant guidé (conforming:true), soit
 * elle ne l'est pas et aucune sauvegarde n'est possible (conforming:false) —
 * ça évite de tronquer silencieusement une règle que l'assistant ne comprend
 * pas entièrement (ex. combinaison AND/OR, cibles sur plusieurs zones).
 */
export async function mapRuleToWizardState(rule: Rule): Promise<ConformanceResult> {
  const condition = rule.conditions;

  if (condition.type === 'THRESHOLD') {
    if (condition.operator !== '>' && condition.operator !== '<') {
      return { conforming: false, reason: `Opérateur "${condition.operator}" non pris en charge par l'assistant guidé.` };
    }
    const field = condition.field ?? 'power';
    if (!CURATED_THRESHOLD_FIELDS.has(field)) {
      return { conforming: false, reason: `Capteur "${field}" non pris en charge par l'assistant guidé.` };
    }
    if (!condition.zoneId) {
      return { conforming: false, reason: 'Condition de seuil sans zone associée (portée large) non prise en charge par l\'assistant guidé.' };
    }
  } else if (condition.type === 'SCHEDULE') {
    if (condition.days !== undefined && presetForDays(condition.days) === 'ALL') {
      return { conforming: false, reason: "Sélection de jours personnalisée non prise en charge par l'assistant guidé." };
    }
  } else if (condition.type === 'PRESENCE') {
    if (condition.field !== undefined && condition.field !== 'presence') {
      return { conforming: false, reason: `Capteur de présence personnalisé ("${condition.field}") non pris en charge par l'assistant guidé.` };
    }
    if (condition.threshold !== undefined || condition.durationMinutes !== undefined) {
      return { conforming: false, reason: "Options avancées de présence non prises en charge par l'assistant guidé." };
    }
    if (!condition.zoneId) {
      return { conforming: false, reason: 'Condition de présence sans zone associée (portée large) non prise en charge par l\'assistant guidé.' };
    }
  } else {
    return { conforming: false, reason: `Type de condition "${condition.type}" non pris en charge par l'assistant guidé.` };
  }

  const actions = rule.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return { conforming: false, reason: 'Aucune action définie sur cette règle.' };
  }

  const hasTailAlert = actions[actions.length - 1]?.type === 'ALERT';
  const preservedTailActions = hasTailAlert ? [actions[actions.length - 1]] : [];
  const mainActions = hasTailAlert ? actions.slice(0, -1) : actions;
  if (mainActions.length === 0) {
    return { conforming: false, reason: "Cette règle ne contient qu'une alerte, sans action de contrôle." };
  }

  const actionTypes = new Set(mainActions.map((a) => a.type));
  if (actionTypes.size !== 1 || !(actionTypes.has('SWITCH_OFF') || actionTypes.has('MAINTAIN'))) {
    return { conforming: false, reason: "Actions hétérogènes non prises en charge par l'assistant guidé." };
  }
  const action = [...actionTypes][0] as WizardActionType;

  let zoneId: string | undefined;
  let chargeMode: ChargeMode;
  let circuitIds: string[] = [];

  if (mainActions.length === 1 && mainActions[0].targetType === 'ZONE') {
    zoneId = mainActions[0].targetId;
    chargeMode = 'ZONE';
  } else if (mainActions.every((a) => (a.targetType ?? 'CIRCUIT') === 'CIRCUIT' && a.targetId)) {
    let circuits;
    try {
      circuits = await Promise.all(mainActions.map((a) => getCircuit(a.targetId as string)));
    } catch {
      return { conforming: false, reason: 'Impossible de résoudre les charges ciblées par cette règle.' };
    }
    const zoneIds = new Set(circuits.map((c) => c.zoneId));
    if (zoneIds.size !== 1) {
      return { conforming: false, reason: 'Les charges de cette règle appartiennent à plusieurs zones différentes.' };
    }
    zoneId = circuits[0].zoneId;
    chargeMode = 'CIRCUITS';
    circuitIds = mainActions.map((a) => a.targetId as string);
  } else {
    return { conforming: false, reason: "Cibles d'action non prises en charge par l'assistant guidé." };
  }

  if (!zoneId) {
    return { conforming: false, reason: 'Zone cible introuvable pour cette règle.' };
  }

  const conditionZoneId = condition.type === 'THRESHOLD' || condition.type === 'PRESENCE' ? condition.zoneId : undefined;
  if (conditionZoneId && conditionZoneId !== zoneId) {
    return { conforming: false, reason: 'La zone de la condition ne correspond pas à la zone de la charge.' };
  }

  const defaults = createDefaultWizardState();
  const state: WizardState = {
    name: rule.name,
    conditionType: condition.type,
    threshold:
      condition.type === 'THRESHOLD'
        ? { field: (condition.field ?? 'power') as ThresholdFieldValue, operator: condition.operator as '>' | '<', value: String(condition.value) }
        : defaults.threshold,
    schedule:
      condition.type === 'SCHEDULE'
        ? { startTime: condition.startTime, endTime: condition.endTime, daysPreset: presetForDays(condition.days) }
        : defaults.schedule,
    presence: condition.type === 'PRESENCE' ? { expected: condition.expected ?? 'PRESENT' } : defaults.presence,
    zoneId,
    chargeMode,
    circuitIds,
    action,
    preservedTailActions,
  };

  return { conforming: true, state };
}
