# Services - écarts modèle backend / maquette Figma

Ce dossier contient la couche d'accès au backend NestJS (`api.ts`,
`auth.ts`, `websocket.ts`, `buildings.ts`, `rooms.ts`, `circuits.ts`,
`measurements.ts`, `rules.ts`) ainsi que des fixtures de démo
(`mocks/`).

## Flag `EXPO_PUBLIC_USE_MOCKS`

- `EXPO_PUBLIC_USE_MOCKS=true` (dans `.env` / variables Expo) : tous les
  stores utilisent directement `services/mocks/fixtures.ts`, sans appel
  réseau. Utile pour développer l'UI sans backend démarré.
- Sinon, `withMockFallback` (dans `services/mocks/index.ts`) tente l'appel
  API réel et ne retombe sur les fixtures qu'en `__DEV__` si la requête
  échoue (backend non démarré).

## Écarts identifiés entre le schéma Prisma actuel et la maquette Figma

Ces écarts sont documentés ici et marqués `// TODO backend: ...` dans le
code. Ils ne bloquent pas la Phase B (l'app reste fonctionnelle grâce aux
valeurs calculées/mockées) mais devront être tranchés pour une V2 :

1. **`Building.status` / `Building.maxPower` / `Building.currentPower`**
   n'existent pas dans `Building` (Prisma). La maquette les utilise pour
   l'état global (Alimenté/Limité/Coupé) et les seuils de puissance.
   - Mobile : `mockBuildingUi` fournit ces valeurs en mock ; en usage réel,
     `status` est dérivé côté `buildingStore` (ex: tous les circuits actifs
     => 'powered'), `currentPower`/`maxPower` agrégés depuis
     `/circuits/:id/measurements` et `Circuit.maxPowerWatt`.

2. **`Room.status` / `Room.power` / `Room.isPriority`** n'existent pas sur
   `Room` (Prisma). Mobile : dérivés des `Circuit.isActive` /
   `EnergyMeasurement.power` de la salle ; `isPriority` mocké
   (`mockRoomsUi`) en attendant un champ dédié.

3. **`Equipment`** (type, power, isOn, roomId) n'existe pas comme modèle
   Prisma. Mobile : `EquipmentScreen` mappe provisoirement chaque
   `Equipment` sur un `Circuit` (nom, `isActive` -> `isOn`,
   `EnergyMeasurement.power` -> `power`). Le `type` (éclairage/
   climatisation/prises/critique) est mocké via `mockEquipment` /
   déduit du nom du circuit.

4. **`Alert.type` / `Alert.origin` / `Alert.room`** n'existent pas -
   seul `Alert.level` (INFO/WARNING/CRITICAL) est en base. Mobile :
   `AlertsScreen` dérive `type`/`origin` du `level` et du `ruleId`
   (`ruleId` non nul => origin 'règle', sinon 'manuel').

5. **Pas d'endpoint `GET /alerts`** : l'historique des alertes n'est pas
   exposé en REST. `AlertsScreen` n'affiche donc que les alertes reçues en
   temps réel via le WebSocket (`'alert'`) depuis l'ouverture de l'app,
   plus `mockAlerts` en mode démo. À ajouter côté backend pour un
   historique persistant.

6. **`GET /circuits/:id/channels`** retourne 4 entrées (`VOLTAGE`,
   `CURRENT`, `POWER`, `ENERGY`) partageant le même topic MQTT `measure`
   du device. Traité comme métadonnées d'affichage uniquement (unité,
   libellé), jamais comme canal de souscription distinct.

7. **Auth** : JWT expire en 15 min, pas de `/auth/refresh`. `authStore`
   redirige vers `LoginScreen` sur 401 (voir `setUnauthorizedHandler`).

8. **Building create/delete** (`BuildingManagementScreen`) : pas
   d'endpoints `POST`/`DELETE /buildings` côté API actuelle (seuls
   `GET`/`PATCH` existent). Mobile : create/delete restent en mock local
   (`buildingStore`), avec bandeau "démo" dans l'écran.

9. **`UpdateRuleDto.isActive`** n'existe pas - seul `DELETE /rules/:id`
   désactive une règle côté backend. `rulesStore.toggleRule` appelle donc
   `disableRule` pour désactiver, mais la réactivation reste locale
   uniquement (perdue au redémarrage de l'app).
