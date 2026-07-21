# Rapport de fin de Phase B — Application mobile PowerLens

Date : 2026-06-11
Branche : `dev_gilles`

## 1. Résumé

La Phase B a converti la maquette Figma exportée
(`Mobile Energy Monitoring App(2)/`) en une application Expo/React Native
fonctionnelle (`powerlens-mobile/`), connectée au backend NestJS de la
Phase A (REST + WebSocket) avec un mode mock complet pour le développement
sans backend. Les 9 écrans de la maquette ont été portés (+ 1 écran
supplémentaire `CircuitDetailScreen`), avec navigation, état global Zustand,
thème sombre NativeWind fidèle à la maquette, et graphiques
(`react-native-gifted-charts`).

`npx tsc --noEmit` passe sans erreur. Le bundle web Expo compile sans erreur
(`Web Bundled`, 2996 modules) en mode `EXPO_PUBLIC_USE_MOCKS=true`.

## 2. Structure créée

```
powerlens-mobile/
  src/
    navigation/        RootNavigator, AuthStack, MainTabs (8 onglets),
                        RoomsStack, ActionsStack, SettingsStack, types
    screens/
      auth/LoginScreen.tsx
      control/ControlCenterScreen.tsx
      dashboard/DashboardScreen.tsx
      rooms/{RoomsListScreen,RoomDetailScreen,CircuitDetailScreen}.tsx
      equipment/EquipmentScreen.tsx
      actions/{ActionsReactionsScreen,RuleFormScreen}.tsx
      alerts/AlertsScreen.tsx
      reports/ReportsScreen.tsx
      settings/SettingsScreen.tsx
      buildings/BuildingManagementScreen.tsx
    components/
      ui/            Card, Badge, Button, Switch, Modal, Select, Input,
                      Label, EmptyState, StatCard, StatusBadge, ProgressBar
      charts/        ConsumptionAreaChart, ComparisonBarChart, CircuitBarChart
      layout/        Header, TabBar
    store/           authStore, buildingStore, roomStore, rulesStore,
                      alertsStore, measurementsStore, uiStore (Zustand)
    services/        api, auth, websocket, buildings, rooms, circuits,
                      measurements, rules, mocks/ (fixtures + index), README.md
    utils/ruleDisplay.ts
    types/models.ts
    theme/global.css
```

## 3. Fichiers créés/modifiés cette session (Settings + Buildings)

- `src/screens/settings/SettingsScreen.tsx` : profil utilisateur (depuis
  `authStore.user`), section Sécurité (modale Rôles & Permissions, switch
  "Double confirmation" local), section Notifications (5 switchs locaux),
  lien vers `BuildingManagement`, infos système, à propos, bouton
  Déconnexion (`authStore.logout`).
- `src/screens/buildings/BuildingManagementScreen.tsx` : liste des
  bâtiments (`buildingStore.buildings`), sélection du bâtiment actif,
  modales Ajouter/Modifier/Supprimer.
- `src/store/buildingStore.ts` : ajout de `updateBuildingInfo` (PATCH
  `/buildings/:id` pour name/location, `maxPower` mis à jour localement),
  `addBuildingLocal` et `removeBuildingLocal` (mock local, voir §5).
- `src/services/README.md` : ajout de l'écart n°9 (`UpdateRuleDto.isActive`).
- `package.json` : ajout de `babel-preset-expo`, `react-dom`,
  `react-native-web`, `@expo/metro-runtime` (dépendances manquantes,
  bloquaient `expo start --web` — voir §6).

## 4. Mapping rôles UI ↔ backend

La maquette utilisait `super_admin/energy_manager/technician/observer`. Le
backend expose `UserRole = SUPER_ADMIN | ADMIN | MANAGER | VIEWER`. Mapping
retenu dans `SettingsScreen` :

| Backend       | Libellé affiché          | Couleur badge |
|---------------|---------------------------|---------------|
| SUPER_ADMIN   | Super Administrateur      | rouge         |
| ADMIN         | Administrateur            | bleu          |
| MANAGER       | Gestionnaire Énergie      | vert          |
| VIEWER        | Observateur               | gris          |

Les listes de permissions par rôle sont reprises de la maquette (texte
informatif uniquement, pas de `RolesGuard` côté mobile - l'autorisation
réelle reste backend).

## 5. Décisions / TODO restants

1. **`BuildingManagementScreen` create/delete** : pas d'endpoints
   `POST`/`DELETE /buildings`. Création ajoute un bâtiment local
   (`id: local-<timestamp>`) avec un avertissement "Création locale
   uniquement (non synchronisée avec le backend)" dans la modale.
   Suppression retire l'entrée du store local. Les deux sont perdus au
   redémarrage de l'app. Édition (`updateBuildingInfo`) appelle
   `PATCH /buildings/:id` pour les bâtiments réels (name/location), et reste
   locale pour `maxPower` (champ UI calculé, cf. écart §services/README #1)
   et pour les bâtiments `local-*`.
2. **Type de bâtiment (campus/école/bureau/usine)** : absent du modèle
   `Building` mobile (et de la maquette portée côté Settings) — non repris
   dans le formulaire Ajouter/Modifier pour rester cohérent avec
   `types/models.ts`. À ajouter si le besoin est confirmé (nouveau champ UI
   ou backend).
3. **Notifications & "Double confirmation"** (`SettingsScreen`) : switches
   purement locaux (`useState`), comme dans la maquette d'origine - aucun
   endpoint de préférences utilisateur côté backend.

## 6. Vérification effectuée

- `npx tsc --noEmit` ✅ (0 erreur) sur l'ensemble du projet, après ajout des
  écrans Settings/BuildingManagement.
- Dépendances manquantes détectées et corrigées au lancement d'Expo :
  `babel-preset-expo` n'était pas installé (bloquait tout `expo start` avec
  `Cannot find module 'babel-preset-expo'`), `react-dom`/`react-native-web`/
  `@expo/metro-runtime` manquants pour la cible web. Installés via
  `npx expo install`.
- `CI=1 EXPO_PUBLIC_USE_MOCKS=true npx expo start --web --port 8090` ✅ —
  bundle Metro réussi (`Web Bundled`, 2996 modules, 0 erreur), page index
  servie en HTTP 200.
- Pas d'environnement graphique disponible pour une comparaison visuelle
  pixel-à-pixel avec la maquette Figma ; la fidélité a été assurée par
  réutilisation systématique des classes Tailwind/couleurs/icônes
  (`lucide-react-native`) de la maquette d'origine pour chaque écran.

## 7. Prochaine étape

Phase C — Documentation finale (`architecture.md`, `api.md`, `mqtt.md`,
`websocket.md`, `setup.md`).
