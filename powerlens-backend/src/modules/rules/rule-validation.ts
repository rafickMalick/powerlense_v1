// rule-validation.ts
import { BadRequestException } from '@nestjs/common';
import { RuleAction, RuleCondition } from './rules-engine.service';

// Valide toute la grammaire du moteur (pas seulement le sous-ensemble que
// l'assistant de création sait produire) : UnderusedEquipmentDetector (IA)
// produit par exemple THRESHOLD avec field:'energyKwh', hors des 4 capteurs
// proposés côté UI — `field` reste donc une chaîne libre ici, jamais une enum.
const CONDITION_TYPES = ['THRESHOLD', 'SCHEDULE', 'AND', 'OR', 'EVENT', 'PRESENCE'];
const ACTION_TYPES = ['SWITCH_OFF', 'ALERT', 'MAINTAIN'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DEPTH = 10;

export function validateRuleCondition(input: unknown, depth = 0): RuleCondition {
  if (depth > MAX_DEPTH) {
    throw new BadRequestException('Profondeur de condition excessive');
  }
  if (typeof input !== 'object' || input === null) {
    throw new BadRequestException('conditions doit être un objet');
  }
  const c = input as Record<string, unknown>;
  if (!CONDITION_TYPES.includes(c.type as string)) {
    throw new BadRequestException(`conditions.type invalide : "${String(c.type)}"`);
  }

  switch (c.type) {
    case 'THRESHOLD':
      if (!['>', '<', '=='].includes(c.operator as string)) {
        throw new BadRequestException('conditions.operator doit être >, < ou ==');
      }
      if (typeof c.value !== 'number' || Number.isNaN(c.value)) {
        throw new BadRequestException('conditions.value doit être un nombre');
      }
      if (c.field !== undefined && typeof c.field !== 'string') {
        throw new BadRequestException('conditions.field doit être une chaîne');
      }
      if (c.zoneId !== undefined && typeof c.zoneId !== 'string') {
        throw new BadRequestException('conditions.zoneId doit être une chaîne');
      }
      break;

    case 'SCHEDULE':
      if (typeof c.startTime !== 'string' || !TIME_RE.test(c.startTime)) {
        throw new BadRequestException('conditions.startTime doit être au format HH:MM');
      }
      if (typeof c.endTime !== 'string' || !TIME_RE.test(c.endTime)) {
        throw new BadRequestException('conditions.endTime doit être au format HH:MM');
      }
      if (
        c.days !== undefined &&
        (!Array.isArray(c.days) ||
          !c.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      ) {
        throw new BadRequestException("conditions.days doit être un tableau d'entiers 0-6");
      }
      break;

    case 'PRESENCE':
      if (c.expected !== undefined && !['ABSENT', 'PRESENT'].includes(c.expected as string)) {
        throw new BadRequestException('conditions.expected doit être ABSENT ou PRESENT');
      }
      if (c.zoneId !== undefined && typeof c.zoneId !== 'string') {
        throw new BadRequestException('conditions.zoneId doit être une chaîne');
      }
      break;

    case 'EVENT':
      if (typeof c.eventName !== 'string' || !c.eventName) {
        throw new BadRequestException('conditions.eventName requis');
      }
      break;

    case 'AND':
    case 'OR':
      if (!Array.isArray(c.criteria) || c.criteria.length === 0) {
        throw new BadRequestException('conditions.criteria doit être un tableau non vide');
      }
      c.criteria.forEach((sub) => validateRuleCondition(sub, depth + 1));
      break;
  }

  return c as unknown as RuleCondition;
}

export function validateRuleActions(input: unknown): RuleAction[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestException('actions doit être un tableau non vide');
  }
  return input.map((a, i) => {
    if (typeof a !== 'object' || a === null) {
      throw new BadRequestException(`actions[${i}] doit être un objet`);
    }
    const action = a as Record<string, unknown>;
    if (!ACTION_TYPES.includes(action.type as string)) {
      throw new BadRequestException(`actions[${i}].type invalide : "${String(action.type)}"`);
    }
    if (
      action.targetType !== undefined &&
      !['CIRCUIT', 'ZONE'].includes(action.targetType as string)
    ) {
      throw new BadRequestException(`actions[${i}].targetType doit être CIRCUIT ou ZONE`);
    }
    if (action.targetId !== undefined && typeof action.targetId !== 'string') {
      throw new BadRequestException(`actions[${i}].targetId doit être une chaîne`);
    }
    return action as unknown as RuleAction;
  });
}
