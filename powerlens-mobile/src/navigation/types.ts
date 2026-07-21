import type { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
};

/**
 * 5 onglets permanents alignés sur les actions principales (Accueil/monitoring,
 * Contrôle des circuits, Règles, Jumeau numérique) + hub "More" qui regroupe
 * Facturation/Équipements/Alertes/Rapports/Classement/Paramètres — voir
 * `navigation/MoreStack.tsx` et `navigation/modules.ts` (MODULE_REGISTRY).
 * Les Alertes sont aussi accessibles partout via la cloche du Header.
 */
export type MainTabParamList = {
  Dashboard: undefined;
  Rooms: undefined;
  Actions: NavigatorScreenParams<ActionsStackParamList>;
  Twin: undefined;
  More: NavigatorScreenParams<MoreStackParamList>;
};

export type MoreStackParamList = {
  MoreHome: undefined;
  Devices: undefined;
  ControlCenter: undefined;
  Alerts: undefined;
  Reports: undefined;
  Ranking: undefined;
  Support: undefined;
  Info: undefined;
  Equipment: undefined;
  Settings: NavigatorScreenParams<SettingsStackParamList>;
};

export type RoomsStackParamList = {
  RoomsList: undefined;
  RoomDetail: { roomId: string; zoneType?: 'ROOM' | 'CORRIDOR' };
  CircuitDetail: { circuitId: string; roomId: string };
};

export type ActionsStackParamList = {
  ActionsReactions: undefined;
  RuleForm: { ruleId?: string } | undefined;
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  BuildingManagement: undefined;
  RecommendationsList: undefined;
  RecommendationDetail: { id: string };
  Billing: undefined;
};
