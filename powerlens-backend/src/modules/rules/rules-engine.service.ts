// rule-engine.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

const MAX_CONDITION_DEPTH = 10;

export interface RuleDecision {
  ruleId: string;
  actions: RuleAction[];
}

export interface RuleAction {
  type: 'SWITCH_OFF' | 'ALERT' | 'MAINTAIN';
  /** Circuit ciblé (targetType CIRCUIT, défaut) ou zone ciblée (targetType ZONE). */
  targetId?: string;
  /** CIRCUIT (défaut, rétro-compatible) : targetId est un circuitId. ZONE : targetId est un zoneId — SWITCH_OFF s'applique alors à tous les circuits actifs non-critiques de la zone. */
  targetType?: 'CIRCUIT' | 'ZONE';
  payload?: any;
}

export interface MeasurementInput {
  zoneId?: string;
  circuitId?: string;
  buildingId?: string;
  power?: number;
  voltage?: number;
  current?: number;
  energyKwh?: number;
  eventName?: string;
  [key: string]: unknown;
}

export type RuleCondition =
  | {
      type: 'THRESHOLD';
      field?: string;
      operator: '>' | '<' | '==';
      value: number;
      /** Restreint la condition à une zone précise (salle/couloir/bâtiment) ; sinon s'applique à la mesure de n'importe quelle zone du bâtiment. */
      zoneId?: string;
    }
  | { type: 'SCHEDULE'; startTime: string; endTime: string; days?: number[] }
  | { type: 'AND'; criteria: RuleCondition[] }
  | { type: 'OR'; criteria: RuleCondition[] }
  | { type: 'EVENT'; eventName: string }
  | {
      type: 'PRESENCE';
      field?: string;
      threshold?: number;
      durationMinutes?: number;
      expected?: 'ABSENT' | 'PRESENT';
      zoneId?: string;
    };

function parseActions(actions: unknown): RuleAction[] {
  if (!Array.isArray(actions)) return [];

  return actions.filter(
    (a): a is RuleAction => typeof a === 'object' && a !== null && 'type' in a,
  );
}

@Injectable()
export class RuleEngineService {
  constructor(private prisma: PrismaService) {}
  // Stockage en mémoire (à migrer vers Redis pour la prod)
  private ruleStates = new Map<string, boolean>(); // Clé: `${zoneId|circuitId}-${ruleId}`, Valeur: true/false
  private cooldowns = new Map<string, number>();
  private COOLDOWN_MS = 30000; // 30 secondes de sécurité

  async evaluateMeasurement(
    measurement: MeasurementInput,
  ): Promise<RuleDecision[]> {
    const hasMeasure = measurement.power !== undefined;
    const hasEvent = measurement.eventName !== undefined;

    if (!hasMeasure && !hasEvent) {
      return [];
    }

    // Le bâtiment est résolu EN PRIORITÉ depuis la zone (source fiable en base).
    // Depuis l'auto-déclaration des boîtiers, le segment "bâtiment" du topic MQTT
    // n'est plus qu'un placeholder ("auto") : le boîtier ignore l'UUID réel du
    // bâtiment, que le backend lui attribue à l'enregistrement. On ne retombe sur
    // le segment du topic que s'il n'y a pas de zone exploitable.
    let buildingId: string | undefined;
    if (measurement.zoneId) {
      const zone = await this.prisma.monitoringZone.findUnique({
        where: { id: measurement.zoneId },
      });
      buildingId = zone?.buildingId;
    }
    if (!buildingId) {
      buildingId = measurement.buildingId;
    }

    if (!buildingId) {
      return [];
    }

    const rules = await this.prisma.rule.findMany({
      where: {
        isActive: true,
        buildingId,
      },
    });

    const decisions: RuleDecision[] = [];

    for (const rule of rules) {
      const isTriggered = this.evaluateCondition(
        rule.conditions as unknown as RuleCondition,
        measurement,
      );
      const stateKey = `${measurement.zoneId ?? measurement.circuitId ?? 'building'}-${rule.id}`;
      const previousState = this.ruleStates.get(stateKey) || false;
      const now = Date.now();

      // 1. Vérification du Cooldown (Hystérésis temporelle)
      const lastExecution = this.cooldowns.get(stateKey) || 0;
      if (now - lastExecution < this.COOLDOWN_MS) continue;

      // IMPORTANT: On ne déclenche l'action que si on passe de FALSE à TRUE
      if (isTriggered && !previousState) {
        this.ruleStates.set(stateKey, true); // On marque comme déclenché
        this.cooldowns.set(stateKey, now); // On met à jour le cooldown
        decisions.push({
          ruleId: rule.id,
          actions: parseActions(rule.actions),
        });
      }
      // On réinitialise quand la condition n'est plus remplie
      else if (!isTriggered && previousState) {
        this.ruleStates.set(stateKey, false);
      }
    }

    return decisions;
  }

  clearState(ruleId: string): void {
    const suffix = `-${ruleId}`;
    for (const key of this.ruleStates.keys()) {
      if (key.endsWith(suffix)) this.ruleStates.delete(key);
    }
    for (const key of this.cooldowns.keys()) {
      if (key.endsWith(suffix)) this.cooldowns.delete(key);
    }
  }

  evaluateCondition(
    condition: RuleCondition | null | undefined,
    measurement: MeasurementInput,
    depth = 0,
  ): boolean {
    if (!condition) return false;

    if (depth > MAX_CONDITION_DEPTH) {
      throw new BadRequestException(
        'Profondeur de condition de règle excessive',
      );
    }

    switch (condition.type) {
      // 1. RÈGLES DE SEUIL (THRESHOLD)
      case 'THRESHOLD': {
        if (condition.zoneId && condition.zoneId !== measurement.zoneId) return false;
        const val = measurement[condition.field || 'power'];
        if (typeof val !== 'number') return false;
        if (condition.operator === '>') return val > condition.value;
        if (condition.operator === '<') return val < condition.value;
        if (condition.operator === '==') return val === condition.value;
        return false;
      }

      // 2. RÈGLES HORAIRES (SCHEDULE)
      case 'SCHEDULE': {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        // Format attendu dans le JSON : { startTime: "08:00", endTime: "18:00", days: [1,2,3,4,5] }
        const isCorrectDay = condition.days
          ? condition.days.includes(now.getDay())
          : true;
        // startTime > endTime signifie que la plage traverse minuit (ex. 21:00-06:00) :
        // une comparaison directe currentTime>=start && currentTime<=end serait alors
        // toujours fausse (aucune valeur ne peut être à la fois >= "21:00" et <= "06:00").
        const isOvernight = condition.startTime > condition.endTime;
        const isInTimeRange = isOvernight
          ? currentTime >= condition.startTime || currentTime <= condition.endTime
          : currentTime >= condition.startTime && currentTime <= condition.endTime;
        return isCorrectDay && isInTimeRange;
      }

      // 3. RÈGLES COMBINÉES (AND / OR) - Récursivité
      case 'AND':
        // condition.criteria doit être un tableau de conditions
        return condition.criteria.every((c) =>
          this.evaluateCondition(c, measurement, depth + 1),
        );

      case 'OR':
        return condition.criteria.some((c) =>
          this.evaluateCondition(c, measurement, depth + 1),
        );

      // 4. ÉVÉNEMENTS (EVENT) - déclenché par un message d'événement MQTT
      // (ex: { eventName: 'DOOR_OPEN' }) plutôt que par une mesure de puissance.
      case 'EVENT':
        return condition.eventName === measurement.eventName;

      // 5. PRÉSENCE (PRESENCE) - disponible en V4 comme mesure de zone
      // (ROOM/CORRIDOR). Vérifie l'état instantané reçu dans la mesure ;
      // `durationMinutes` (fenêtre temporelle glissante) reste hors scope —
      // nécessiterait une requête historique async sur EnergyMeasurement.
      case 'PRESENCE': {
        if (condition.zoneId && condition.zoneId !== measurement.zoneId) return false;
        const presence = measurement[condition.field || 'presence'];
        if (typeof presence !== 'boolean') return false;
        const expected = condition.expected ?? 'PRESENT';
        return expected === 'PRESENT' ? presence : !presence;
      }

      default:
        return false;
    }
  }
}
