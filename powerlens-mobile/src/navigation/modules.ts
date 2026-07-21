/**
 * REGISTRE DES MODULES POWERLENS
 * ================================
 * Pour ajouter un nouvel onglet :
 *   1. Crée ton dossier  src/screens/<monModule>/
 *   2. Crée ton écran    <MonModule>Screen.tsx  (+ stack si besoin)
 *   3. Ajoute UNE entrée dans MODULE_REGISTRY ci-dessous
 *   4. Ajoute le nom dans MainTabParamList (navigation/types.ts)
 *
 * C'est tout. MainTabs et TabBar se génèrent automatiquement — TabBar lit
 * `.icon`/`.label` directement depuis ce registre (aucune map dupliquée).
 *
 * Depuis la refonte UX (§2.2) : seuls 5 onglets permanents (les écrans à
 * plus forte fréquence de consultation/démonstration). Control, Actions,
 * Alerts, Reports, Ranking et Settings vivent désormais derrière l'onglet
 * "More" (voir `navigation/MoreStack.tsx`) plutôt que d'occuper chacun un
 * slot de la bottom bar.
 */

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { LayoutDashboard, SlidersHorizontal, GitBranch, Map, MoreHorizontal } from 'lucide-react-native';

// ─── imports des composants ───────────────────────────────────────────────
import { DashboardScreen } from '@/screens/dashboard/DashboardScreen';
import { RoomsStack } from './RoomsStack';
import { ActionsStack } from './ActionsStack';
import { TwinScreen } from '@/screens/twin/TwinScreen';
import { MoreStack } from './MoreStack';

// ─── type ─────────────────────────────────────────────────────────────────
export interface AppModule {
  /** Doit correspondre à une clé de MainTabParamList dans types.ts */
  name: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType<any>;
  /** false = le module gère son propre header (ex : stacks) */
  headerShown?: boolean;
}

// ─── registre ─────────────────────────────────────────────────────────────
export const MODULE_REGISTRY: AppModule[] = [
  { name: 'Dashboard', label: 'Accueil', icon: LayoutDashboard, component: DashboardScreen },
  { name: 'Rooms', label: 'Contrôle', icon: SlidersHorizontal, component: RoomsStack, headerShown: false },
  { name: 'Actions', label: 'Règles', icon: GitBranch, component: ActionsStack, headerShown: false },
  { name: 'Twin', label: 'Jumeau', icon: Map, component: TwinScreen },
  { name: 'More', label: 'Plus', icon: MoreHorizontal, component: MoreStack, headerShown: false },
];
