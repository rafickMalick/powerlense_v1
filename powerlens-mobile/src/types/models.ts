/**
 * Types partagés, miroir des modèles Prisma exposés par powerlens-backend.
 * Toute donnée affichée dans l'app mobile doit être typée ici - aucune
 * structure ad-hoc dans les écrans.
 *
 * Les types suffixés `*UiStatus` / les champs marqués `// TODO backend`
 * n'existent pas dans le schéma Prisma actuel et sont calculés/mockés
 * côté mobile en attendant une évolution du backend (voir
 * services/README.md pour le détail des écarts).
 */

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'VIEWER';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
}

export type BuildingPowerStatus = 'POWERED' | 'LIMITED' | 'CUTOFF';

export interface Building {
  id: string;
  name: string;
  location: string;
  description?: string | null;
  powerStatus: BuildingPowerStatus;
  createdAt: string;
}

export type ZoneType = 'BUILDING' | 'CORRIDOR' | 'ROOM';

export interface MonitoringZone {
  id: string;
  name: string;
  type: ZoneType;
  floor?: number | null;
  buildingId: string;
  parentId?: string | null;
  createdAt: string;
}

/** @deprecated Use MonitoringZone — Room is now a zone of type ROOM. */
export type Room = MonitoringZone;

export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';

export interface Device {
  id: string;
  deviceUid: string;
  firmwareVersion?: string | null;
  lastSeen?: string | null;
  status: DeviceStatus;
  buildingId: string;
}

export type CircuitType = 'LIGHTING' | 'SOCKET' | 'HVAC' | 'FAN';

/** Boîtier (device) auto-déclaré — vue « Boîtiers ». */
export interface Device {
  id: string;
  deviceUid: string;
  name?: string | null;
  firmwareVersion?: string | null;
  lastSeen?: string | null;
  buildingId: string;
  building?: { id: string; name: string };
  circuits: Circuit[];
}

export interface Circuit {
  id: string;
  name: string;
  type: CircuitType;
  maxPowerWatt?: number | null;
  /** Pin physique du relais sur le device, remontée par l'ESP (null si non rapportée). */
  pin?: number | null;
  isActive: boolean;
  isCritical: boolean;
  deviceId: string;
  zoneId: string;
  /** Présent sur GET /circuits/:id (include: zone) — absent des listes /zones/:id/circuits. */
  zone?: MonitoringZone;
}

/** GET /zones/:id/channels (canonique) ou /circuits/:id/channels (compat, résout vers la zone du circuit). */
export interface Channel {
  id: string;
  type: string;
  unit: string;
  mqttTopic?: string | null;
  circuitId?: string | null;
  zoneId?: string | null;
  topic?: string;
}

/** Mesures rattachées à une ZONE (Salle/Couloir/Bâtiment) depuis V4 — les circuits ne sont plus mesurés individuellement. */
export interface EnergyMeasurement {
  id: string;
  voltage?: number | null;
  current?: number | null;
  power?: number | null;
  energyKwh?: number | null;
  frequency?: number | null;
  powerFactor?: number | null;
  luminosity?: number | null;
  presence?: boolean | null;
  temperature?: number | null;
  measuredAt: string;
  zoneId: string;
  /** @deprecated historique pré-V4 uniquement */
  circuitId?: string | null;
}

/**
 * `id` = zoneId de l'agrégation (absent pour l'agrégat BÂTIMENT, qui combine
 * plusieurs zones en une seule série — cf. GET /zones/:id/measurements sur
 * une zone de type BUILDING).
 */
export interface MeasurementAggregate {
  id?: string;
  bucket: string;
  avgPower: number | null;
  maxPower: number | null;
  avgVoltage: number | null;
  avgCurrent: number | null;
  totalEnergyKwh: number | null;
  avgFrequency: number | null;
  avgPowerFactor: number | null;
  avgLuminosity?: number | null;
  avgTemperature?: number | null;
}

export type RuleType = 'SCHEDULE' | 'THRESHOLD' | 'PRESENCE' | 'EVENT' | 'COMBINED';

export interface ThresholdCondition {
  type: 'THRESHOLD';
  field?: string;
  operator: '>' | '<' | '==';
  value: number;
  /** Restreint la condition à une zone précise (salle/couloir) ; sinon s'applique à la mesure de n'importe quelle zone du bâtiment. */
  zoneId?: string;
}

export interface ScheduleCondition {
  type: 'SCHEDULE';
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  days?: number[];
}

export interface EventCondition {
  type: 'EVENT';
  eventName: string;
}

export interface CombinedCondition {
  type: 'AND' | 'OR';
  criteria: RuleCondition[];
}

export interface PresenceCondition {
  type: 'PRESENCE';
  field?: string;
  threshold?: number;
  durationMinutes?: number;
  expected?: 'ABSENT' | 'PRESENT';
  /** Restreint la condition à une zone précise (salle/couloir). */
  zoneId?: string;
}

export type RuleCondition =
  | ThresholdCondition
  | ScheduleCondition
  | EventCondition
  | CombinedCondition
  | PresenceCondition;

export interface RuleAction {
  type: 'SWITCH_OFF' | 'ALERT' | 'MAINTAIN';
  targetId?: string;
  /** CIRCUIT (défaut) : targetId est un circuitId. ZONE : targetId est un zoneId — SWITCH_OFF s'applique alors à tous les circuits actifs non-critiques de la zone. */
  targetType?: 'CIRCUIT' | 'ZONE';
  payload?: { level?: AlertLevel; message?: string };
}

export interface Rule {
  id: string;
  name: string;
  ruleType: RuleType;
  conditions: RuleCondition;
  actions: RuleAction[];
  isActive: boolean;
  createdAt: string;
  buildingId: string;
}

export type AlertLevel = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Alert {
  id: string;
  level: AlertLevel;
  message: string;
  createdAt: string;
  acknowledged: boolean;
  buildingId?: string | null;
  ruleId?: string | null;
  /** RC1 — portée ROOM/CORRIDOR de l'alerte, null = bâtiment entier (voir STATE.md V10). */
  zoneId?: string | null;
}

export interface AuditLog {
  id: string;
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: unknown;
  createdAt: string;
}

/* ===========================================================
   Types "UI" issus de la maquette Figma, sans équivalent direct
   dans le schéma Prisma actuel. Conservés pour fidélité visuelle
   et alimentés par des valeurs calculées ou mockées.
   =========================================================== */

/** TODO backend: Alert.type/origin/room n'existent pas (level seul en DB). */
export type AlertUiType = 'surcharge' | 'coupure' | 'limitation' | 'action';
export type AlertUiOrigin = 'manuel' | 'règle';

/* ===========================================================
   PowerLens Smart Supervisor (V2)
   =========================================================== */

export type RecommendationType = 'CREATE_RULE' | 'MODIFY_RULE' | 'DELETE_RULE';
export type RecommendationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
export type RecommendationConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RuleRecommendation {
  id: string;
  type: RecommendationType;
  title: string;
  justification: string;
  detectorKey: string;
  proposedConditions?: RuleCondition | null;
  proposedActions?: RuleAction[] | null;
  estimatedImpact: string;
  estimatedSavingsKwh?: number | null;
  estimatedSavingsEur?: number | null;
  confidence: RecommendationConfidence;
  status: RecommendationStatus;
  author: string;
  buildingId: string;
  targetRuleId?: string | null;
  targetRule?: Rule | null;
  appliedRuleId?: string | null;
  reviewComment?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface PaginatedRecommendations {
  items: RuleRecommendation[];
  total: number;
  page: number;
  pageSize: number;
}

export type SupervisorRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface SupervisorRun {
  id: string;
  startedAt: string;
  finishedAt?: string | null;
  status: SupervisorRunStatus;
  buildingsScanned: number;
  recommendationsCreated: number;
  errorMessage?: string | null;
}
