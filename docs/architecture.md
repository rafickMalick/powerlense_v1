# Architecture — PowerLens

## 1. Vue d'ensemble

PowerLens est une plateforme de supervision et de pilotage énergétique
temps réel pour des bâtiments (campus, bureaux, etc.). Elle s'appuie sur
une chaîne de bout en bout :

```
ESP32 (capteurs/relais)
   │  MQTT
   ▼
Broker MQTT (Mosquitto, Raspberry Pi ou local)
   │
   ▼
API NestJS (powerlens-backend)
   │  WebSocket (socket.io)        │  PostgreSQL (Prisma)
   ▼                                ▼
Application mobile (powerlens-mobile)   Historique des mesures, règles,
React Native / Expo                     bâtiments, utilisateurs, alertes,
                                         journal d'audit
```

### Règles architecturales non négociables

1. **Temps réel sans passer par la base** : un message MQTT de mesure est
   immédiatement retransmis aux clients via WebSocket
   (`RealtimeGateway.emitMeasurement`), en parallèle de son insertion
   asynchrone dans `EnergyMeasurement` (PostgreSQL). L'app mobile n'attend
   jamais une requête REST pour afficher une mesure en direct.
2. **L'API NestJS est le seul cerveau** : le moteur de règles, la logique
   d'activation/désactivation des circuits, l'authentification et la
   journalisation des actions vivent exclusivement dans
   `powerlens-backend`. L'application mobile (`powerlens-mobile`) est un
   client « bête » : elle affiche des états et envoie des requêtes/commandes
   REST ou WebSocket.
3. **Aucune connexion directe mobile ↔ MQTT/ESP32** : toute commande
   (allumer/éteindre un circuit) passe par l'API REST, qui publie ensuite
   sur le broker MQTT.

## 2. Backend — `powerlens-backend/` (NestJS + Prisma + PostgreSQL)

### 2.1 Modules

| Module | Rôle |
|---|---|
| `PrismaModule` | Accès base de données (PostgreSQL via Prisma 7 + `@prisma/adapter-pg`) |
| `AuthModule` | Authentification JWT (`POST /auth/login`, `GET /auth/me`), stratégie `passport-jwt`, `JwtAuthGuard` |
| `RealtimeModule` | `RealtimeGateway` — passerelle WebSocket (socket.io), diffuse `measurement`, `alert`, `circuit:status` |
| `MqttModule` | `MqttService` (connexion au broker, pub/sub) + `MeasurementListener` (traitement des messages entrants) |
| `RulesModule` | `RulesService` (CRUD règles) + `RuleEngineService` (évaluation des conditions JSONB) |
| `ZonesModule` | Zones de supervision : liste (`?buildingId`, `?type`), circuits et mesures d'une zone |
| `RoomsModule` *(deprecated)* | Wrapper de compatibilité → `ZonesModule` avec filtre `type=ROOM` |
| `CircuitsModule` | Circuits : détail, canaux, mesures, activation/désactivation |
| `BuildingsModule` | Bâtiments : liste, détail, zones, mise à jour |
| `MeasurementsModule` | Lecture/agrégation des mesures (`EnergyMeasurement`) |
| `SupervisorModule` | Détecteurs de patterns, recommandations IA, cron nocturne (`SUPERVISOR_ENABLED=true`) |
| `SimulatorModule` | `SimulatorService` — simulateur MQTT (mesures aléatoires réalistes), activable par variable d'environnement |

### 2.2 Modèle de données (Prisma — `prisma/schema.prisma`)

- `User` (rôles `SUPER_ADMIN | ADMIN | MANAGER | VIEWER`)
- `Building` → `MonitoringZone[]`, `Device[]`, `Rule[]`, `Alert[]`
- `MonitoringZone` (type `BUILDING | CORRIDOR | ROOM`, `buildingId`, `parentId` optionnel — remplace `Room` depuis V3)
- `Device` (ESP32 physique, `deviceUid` unique, statut `ONLINE | OFFLINE | MAINTENANCE`)
- `Circuit` (rattaché à un `Device` et à une `MonitoringZone` — `zoneId` NOT NULL depuis V3 ;
  type `LIGHTING | SOCKET | HVAC | FAN`, `isActive`, `isCritical`, `maxPowerWatt` ;
  **commandable mais non mesuré individuellement depuis V4** — voir ci-dessous)
- `Channel` (catalogue de canaux de mesure **par zone** depuis V4 : voltage, current, power,
  energy, frequency, powerFactor, luminosity, presence, temperature ; `zoneId` colonne
  d'attache courante, `circuitId` conservé nullable pour l'historique pré-V4 uniquement)
- `EnergyMeasurement` (mesures horodatées : voltage, current, power, energyKwh +
  frequency, powerFactor, luminosity, presence, temperature ; rattachée à une **zone**
  (`zoneId`) depuis V4 — `circuitId` nullable, legacy pré-V4 uniquement ; les zones
  `BUILDING` sont mesurées par un module dédié (départ général) si un tel module est
  déployé, sinon leur mesure est calculée en lecture par agrégation de leurs zones
  `ROOM`/`CORRIDOR` ; `id` en `BigInt`, sérialisé en `string` côté API)
- `Rule` (`ruleType`, `conditions` JSONB, `actions` JSONB, rattachée à un `Building`)
- `Alert` (niveau `INFO | WARNING | CRITICAL`, liée à un `Building`/`Rule`)
- `AuditLog` (traçabilité des actions système/utilisateur/matériel)
- `RuleRecommendation` (recommandation IA — `CREATE_RULE | MODIFY_RULE | DELETE_RULE`)

### 2.3 Flux de données principal (mesure ESP32 → mobile)

1. Un ESP32 publie un JSON sur `powerlens/{buildingId}/{deviceId}/measure`,
   identifiant la **zone** mesurée (`zoneId`, ROOM ou CORRIDOR).
2. `MqttService` reçoit le message (abonnement `powerlens/+/+/measure`).
3. `MeasurementListener.handleMeasurement` :
   - insère la mesure dans `EnergyMeasurement` (si `zoneId` +
     `measuredAt` présents) — **asynchrone, en arrière-plan** ;
   - diffuse immédiatement la mesure brute via
     `RealtimeGateway.emitMeasurement` (événement `measurement`) ;
   - appelle `RuleEngineService.evaluateMeasurement` pour évaluer les
     règles actives du bâtiment concerné (résolu directement via
     `buildingId`, déjà présent dans le topic).
4. Si une règle se déclenche (passage `false → true`, hors cooldown de
   30 s) :
   - action `SWITCH_OFF` → publication d'une commande MQTT
     (`powerlens/{buildingId}/{deviceId}/command/{circuitId}`), ciblant un
     circuit précis ou, si `targetType: 'ZONE'`, tous les circuits actifs
     non-critiques de la zone + entrée `AuditLog` ;
   - action `ALERT` → création d'une ligne `Alert` + diffusion WebSocket
     (`alert`).
5. L'ESP32 confirme une commande via
   `powerlens/{buildingId}/{deviceId}/ack/{circuitId}` → mise à jour de
   `Circuit.isActive`, `AuditLog`, diffusion `circuit:status`. Les
   commandes/ACK restent scopés par circuit — seules les mesures ont migré
   vers la zone.
6. Depuis V8, chaque mesure peut aussi porter un champ `circuits` (état réel
   des relais du module émetteur, pour sa zone possédée uniquement) —
   `MeasurementListener` met alors à jour `Circuit.isActive` directement
   depuis ce que rapporte le device (best-effort), en plus du flux ACK
   ci-dessus. Voir [mqtt.md](mqtt.md) §3.1.

Voir [mqtt.md](mqtt.md) et [websocket.md](websocket.md) pour le détail des
contrats.

## 3. Mobile — `powerlens-mobile/` (Expo / React Native)

### 3.1 Stack

- **Expo 56 / React Native 0.85**, cible web + Android/iOS.
- **Navigation** : `@react-navigation` (stack racine `AuthStack` /
  `MainTabs` à 8 onglets, sous-stacks `RoomsStack`, `ActionsStack`,
  `SettingsStack`).
- **État global** : Zustand (`authStore`, `buildingStore`, `roomStore`,
  `rulesStore`, `alertsStore`, `measurementsStore`, `uiStore`).
- **Temps réel** : `socket.io-client` (`services/websocket.ts`), connecté à
  la même URL que l'API REST (`EXPO_PUBLIC_API_URL`).
- **UI** : NativeWind (Tailwind), thème sombre fidèle à la maquette Figma
  (`Mobile Energy Monitoring App(2)/`), `lucide-react-native` pour les
  icônes, `react-native-gifted-charts` pour les graphiques.
- **Mode mock** : `EXPO_PUBLIC_USE_MOCKS=true` bascule tous les services sur
  des données fixtures locales (`services/mocks/`), permettant de développer
  l'UI sans backend démarré.

### 3.2 Structure (`src/`)

```
navigation/   RootNavigator, AuthStack, MainTabs, RoomsStack, ActionsStack,
              SettingsStack
screens/      auth, dashboard, rooms, control, equipment, actions, alerts,
              reports, settings, buildings
components/   ui/ (Card, Badge, Button, Switch, Modal, Select, Input, ...),
              charts/, layout/ (Header, TabBar)
store/        Zustand : authStore, buildingStore, roomStore, rulesStore,
              alertsStore, measurementsStore, uiStore
services/     api, auth, websocket, buildings, rooms, circuits,
              measurements, rules, mocks/
utils/        ruleDisplay.ts
types/        models.ts
theme/        global.css
```

### 3.3 Écarts maquette ↔ backend

Tous les écarts entre la maquette Figma et le schéma backend réel
(champs absents, endpoints manquants, mappings de rôles, etc.) sont
documentés au fil de l'eau dans `powerlens-mobile/src/services/README.md`.
Ce fichier reste la référence pour toute évolution future du contrat
API/mobile.

## 4. Décisions d'architecture clés

1. **Table `Channel` persistée, par zone depuis V4** : les canaux de mesure
   d'une zone (voltage, current, power, energy, frequency, powerFactor,
   luminosity, presence, temperature) sont enregistrés dans la table
   `Channel` (`zoneId`), peuplée selon le type de zone (temperature
   uniquement pour ROOM ; luminosity/presence pour ROOM et CORRIDOR).
   `ZonesService.getChannels` lit directement cette table ;
   `CircuitsService.getChannels` résout vers la zone du circuit
   (compatibilité).
2. **Authentification JWT minimale** : `JWT_EXPIRES_IN=15m`, pas de
   `POST /auth/refresh` pour l'instant. Toutes les routes
   `POST/PATCH/DELETE` sont protégées par `JwtAuthGuard` ; les `GET` restent
   publics pour la démo.
3. **WebSocket sans authentification** : `RealtimeGateway` accepte toute
   connexion (`cors: '*'`), acceptable en démo, à sécuriser avant une
   exposition publique.
4. **Règle `PRESENCE`** : compare l'état de présence instantané reçu dans
   la mesure de zone (ROOM/CORRIDOR) au champ `expected` de la condition —
   pas de fenêtre temporelle glissante (`durationMinutes` non implémenté,
   nécessiterait une requête historique async).
5. **Simulateur matériel** : `SimulatorService` (`SIMULATOR_ENABLED=true`)
   publie des mesures réalistes pour chaque zone ROOM/CORRIDOR active, puis
   synthétise une mesure BUILDING (départ général) par somme des zones du
   bâtiment — valeur de repli tant qu'aucun module dédié n'est branché,
   permettant une démonstration complète sans ESP32 physique.
6. **Mot de passe administrateur par défaut** : voir [setup.md](setup.md) —
   à changer avant toute mise en production.
7. **Journalisation unifiée** : `AuditService.log()` est le point d'entrée
   unique — tout module appelle cette méthode plutôt que d'écrire
   directement dans `prisma.auditLog`, garantissant que chaque action
   significative est simultanément affichée en console, enregistrée en
   base et consultable via `GET /audit-logs`.

## 5. Documents associés

- [api.md](api.md) — catalogue des routes REST
- [mqtt.md](mqtt.md) — contrat MQTT (topics, payloads, simulateur)
- [hardware.md](hardware.md) — guide d'intégration ESP32 (connexion broker, modèles de données, firmwares Arduino de référence — un par module physique depuis V6)
- [websocket.md](websocket.md) — événements temps réel socket.io
- [database.md](database.md) — schéma de base de données V3, stratégie de migration
- [setup.md](setup.md) — installation et démarrage (backend + mobile)
- [v2-smart-supervisor.md](v2-smart-supervisor.md) — module de supervision IA
