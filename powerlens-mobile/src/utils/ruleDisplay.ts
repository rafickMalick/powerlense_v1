import type { RuleAction, RuleCondition } from '@/types/models';

export interface ConditionDisplay {
  label: string;
  value: string;
}

export interface ActionDisplay {
  label: string;
  color: string;
  target: string;
}

/** Format des conditions aligné sur powerlens-backend/src/modules/rules/rules-engine.service.ts. */
export function getConditionDisplay(condition: RuleCondition): ConditionDisplay {
  switch (condition.type) {
    case 'THRESHOLD':
      return { label: 'Seuil', value: `${condition.field ?? 'power'} ${condition.operator} ${condition.value}` };
    case 'SCHEDULE':
      return { label: 'Heure', value: `${condition.startTime} - ${condition.endTime}` };
    case 'EVENT':
      return { label: 'État', value: condition.eventName };
    case 'AND':
    case 'OR':
      return { label: 'Combiné', value: `${condition.criteria.length} conditions (${condition.type})` };
    case 'PRESENCE':
      return {
        label: 'Présence',
        value: condition.expected === 'ABSENT' ? 'Absence détectée' : 'Présence détectée',
      };
  }
}

/** Format des actions aligné sur powerlens-backend/src/modules/rules/rules-engine.service.ts. */
export function getActionDisplay(action: RuleAction): ActionDisplay {
  if (action.type === 'SWITCH_OFF') {
    return { label: 'Couper', color: 'bg-danger', target: action.targetId ?? '' };
  }
  if (action.type === 'MAINTAIN') {
    return {
      label: 'Maintenir',
      color: 'bg-success',
      target: action.targetType === 'ZONE' ? 'Toute la zone' : (action.targetId ?? ''),
    };
  }
  const level = action.payload?.level ?? 'INFO';
  return {
    label: level === 'CRITICAL' ? 'Couper' : level === 'WARNING' ? 'Limiter' : 'Maintenir',
    color: level === 'CRITICAL' ? 'bg-danger' : level === 'WARNING' ? 'bg-warning' : 'bg-success',
    target: action.payload?.message ?? '',
  };
}
