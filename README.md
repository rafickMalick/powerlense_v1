# PowerLens

Plateforme de supervision et de pilotage énergétique **temps réel** pour bâtiments (campus, bureaux, établissements) : mesure de la consommation par zone, pilotage à distance des 
circuits, moteur de règles automatiques, suggestions intelligentes et traçabilité complète des actions.

> **Version V1.2** — réaligne le modèle métier sur les capacités réelles du prototype matériel : les mesures électriques (tension, courant, puissance, énergie, luminosité, présence, température) sont désormais rattachées aux **zones supervisées** (Salle, Couloir, Bâtiment) plutôt qu'aux circuits individuels, qui restent commandables (ON/OFF) mais non instrumentés un par un. Voir [Limites actuelles](#limites-actuelles).

---

## Sommaire

- [Présentation](#présentation)
- [Captures d'écran](#captures-décran)
- [Architecture](#architecture)
- [Technologies](#technologies)
- [Structure du projet](#structure-du-projet)
- [Architecture frontend](#architecture-frontend)
- [Système de navigation](#système-de-navigation)
- [Design system](#design-system)
- [Composants réutilisables](#composants-réutilisables)
- [UX & accessibilité](#ux--accessibilité)
- [PWA](#pwa)
- [Installation](#installation)
- [Variables d'environnement](#variables-denvironnement)
- [Base de données](#base-de-données)
- [Simulateur](#simulateur)
- [MQTT](#mqtt)
- [WebSocket](#websocket)
- [API](#api)
- [Comptes de démonstration](#comptes-de-démonstration)
- [Lancement de la démonstration](#lancement-de-la-démonstration)
- [Guide de démonstration jury](#guide-de-démonstration-jury)
- [Fonctionnalités](#fonctionnalités)
- [Limites actuelles](#limites-actuelles)

---

## Présentation

PowerLens connecte des capteurs physiques (ESP32) à une application mobile via une API centrale NestJS, avec deux principes non négociables :

1. **Temps réel sans détour par la base** : une mesure MQTT est retransmise **instantanément** aux clients via WebSocket ; son écriture en PostgreSQL est asynchrone et ne sert que d'historique.
2. **Single point of truth** : toute la logique métier (authentification, moteur de règles, commandes, journalisation) vit exclusivement dans le backend NestJS. L'application mobile est un client pur — elle affiche des états et envoie des requêtes ; elle ne calcule ni ne décide rien elle-même.

## Captures d'écran

> À insérer après capture manuelle sur le build final — web (`npm run web`) et natif (Expo Go/Android). Écrans suggérés : Connexion, Tableau de bord, Jumeau numérique (2D + 3D), Centre de contrôle, Équipements, Recommandations IA.
>
> ```markdown
> | Tableau de bord | Jumeau numérique | Smart Supervisor |
> |---|---|---|
> | ![Dashboard](docs/screenshots/dashboard.png) | ![Twin](docs/screenshots/twin.png) | ![Supervisor](docs/screenshots/supervisor.png) |
> ```

## Architecture

```
                         ┌────────────────────────┐
                         │   ESP32 (capteurs +     │
                         │   relais par circuit)   │
                         └───────────┬─────────────┘
                                     │ MQTT (mesures de zone, commandes de circuit)
                                     ▼
                         ┌────────────────────────┐
                         │  Broker MQTT (Mosquitto)│
                         └───────────┬─────────────┘
                                     │
                                     ▼
        ┌───────────────────────────────────────────────────────┐
        │             API NestJS — powerlens-backend             │
        │  MqttModule · RulesModule · ZonesModule · CircuitsModule│
        │  BuildingsModule · MeasurementsModule · AuditModule     │
        │  SupervisorModule (IA) · SimulatorModule · AuthModule   │
        └───────┬───────────────────────────────────┬────────────┘
                │ WebSocket (socket.io, instantané)  │ PostgreSQL (Prisma, historique)
                ▼                                     ▼
        ┌────────────────────┐              ┌─────────────────────┐
        │ App mobile          │              │ Zones, circuits,     │
        │ powerlens-mobile     │              │ mesures, règles,     │
        │ (Expo / React Native)│              │ alertes, audit       │
        └────────────────────┘              └─────────────────────┘
```

**Règles architecturales :**

- Aucune connexion directe mobile ↔ MQTT/ESP32 : toute commande passe par l'API REST, qui publie ensuite sur le broker.
- Le moteur de règles évalue chaque mesure/événement entrant et peut déclencher une commande (`SWITCH_OFF`, ciblant un circuit ou tous les circuits non-critiques d'une zone) ou une alerte.
- Toute action significative (connexion, commande, création de règle, bascule simulateur, erreur) produit une entrée d'audit — console + base + API — voir [Fonctionnalités](#fonctionnalités).

## Technologies

| Couche | Stack |
|---|---|
| Backend | NestJS 11, TypeScript, Prisma 7 + `@prisma/adapter-pg`, PostgreSQL |
| Temps réel | MQTT (broker Mosquitto), WebSocket (`@nestjs/websockets` + socket.io) |
| Authentification | JWT (`@nestjs/jwt` + Passport) |
| Frontend | Expo 56 / React Native, TypeScript, Zustand, NativeWind (Tailwind), `socket.io-client` |
| Design system | Typographie Inter (`@expo-google-fonts/inter`), icônes `lucide-react-native`, animations `react-native-reanimated`, retour haptique natif (`expo-haptics`, no-op web) |
| Graphiques | `react-native-gifted-charts`, jumeau numérique 3D (`three`, web uniquement) |

## Structure du projet

```
powerlens-backend/
  prisma/               schema.prisma, migrations/, seed.ts
  src/
    mqtt/               MqttService, MeasurementListener, CommandTrackerService (suivi ACK/timeout), config des topics
    modules/
      rules/             RulesService, RuleEngineService (moteur de règles)
      zones/              CRUD zones (Salle/Couloir/Bâtiment), circuits, canaux, mesures
      circuits/           Contrôle des circuits (activate/deactivate), canaux (compat)
      buildings/          CRUD bâtiments, PATCH power-status (Contrôle groupé)
      measurements/       Lecture/agrégation des mesures par zone
      audit/              AuditService.log() — point d'entrée unique de journalisation
      supervisor/         Détecteurs de patterns, recommandations IA
      auth/               JWT login/logout
    simulator/            SimulatorService (mesures de zone), ProviderSwitcherService
    realtime/              RealtimeGateway (WebSocket)
    common/filters/        AllExceptionsFilter (erreurs API → audit)

powerlens-mobile/
  src/
    screens/              dashboard, rooms (RoomsList/RoomDetail/CircuitDetail),
                           control (Centre de contrôle), equipment, actions, alerts,
                           reports, settings, buildings, billing, supervisor,
                           twin (jumeau numérique 2D/3D), ranking, more (hub "Plus"), auth
    navigation/            RootNavigator, MainTabs, modules.ts (MODULE_REGISTRY — source
                            unique des 5 onglets), MoreStack (hub Alertes/Rapports/
                            Classement/Actions/Paramètres), RoomsStack, ActionsStack,
                            SettingsStack
    theme/                 palette.ts (couleurs de marque), colors.ts (réexport +
                            helpers jumeau numérique), global.css
    store/                 Zustand : auth, building, room, rules, alerts, measurements,
                            supervisor, ui, onboarding
    services/               api, auth, buildings, zones, circuits, measurements, rules,
                            supervisor, billing, auditLogs, reports, websocket
    components/ui/          bibliothèque de composants (voir Design system)
    components/onboarding/  WelcomeCarousel, InfoTooltip
    hooks/                  useScreenViewLogging, useBreakpoint (mobile/tablette/desktop)
    utils/                  ruleDisplay, recommendationDisplay, haptics
    types/                  models.ts — types partagés, miroir du schéma Prisma

docs/                    Documentation détaillée (contrats MQTT/API/WebSocket, schéma DB...)
code_salle.ino           Firmware ESP32-PL-001 — Salle (PZEM004T + SHT35 + PIR, 4 relais)
code_couloir/            Firmware ESP32-PL-002 — Couloir (SHT35 réel, PZEM simulé, 2 relais)
```

## Architecture frontend

`powerlens-mobile` est un client Expo/React Native unique (web + Android/iOS) — pas de projet séparé par plateforme. Trois décisions structurent le code :

- **`MODULE_REGISTRY` pilote la navigation** (`src/navigation/modules.ts`) : ajouter un écran à la bottom bar est une seule entrée dans un tableau (icône, libellé, composant) — `MainTabs` et `TabBar` s'y branchent automatiquement, aucune duplication.
- **Palette centralisée** (`src/theme/palette.ts`) : seule source de vérité pour les couleurs, réexportée à la fois vers `tailwind.config.js` (classes `bg-primary`, `text-danger`, etc. utilisées dans tout le code) et vers `src/theme/colors.ts` (constantes JS pour les rares call sites qui ne peuvent pas utiliser de `className` : SVG, matériaux Three.js, `react-native-gifted-charts`).
- **Zéro mock en production** : les 9 stores Zustand (`store/`) appellent tous l'API/WebSocket réels ; `services/mocks/` n'est utilisé que si `EXPO_PUBLIC_USE_MOCKS=true`, pour développer l'UI sans backend démarré.

## Système de navigation

5 onglets permanents plus un hub, plutôt que 10 onglets à plat :

```
Accueil (Dashboard) · Salles · Équipements · Jumeau · Plus
                                                        └── Centre de contrôle
                                                        └── Actions & Règles
                                                        └── Alertes
                                                        └── Rapports
                                                        └── Classement
                                                        └── Paramètres (Bâtiments, Facturation, IA)
```

Les onglets Salles et Plus gèrent leur propre pile de navigation (`RoomsStack`, `MoreStack`) ; `MoreStack` réutilise tel quel `ActionsStack`/`SettingsStack` existants plutôt que de dupliquer les écrans. Ajouter un module reste une modification d'un seul fichier (`navigation/modules.ts`), documentée en tête de ce fichier.

## Design system

Palette de marque (`src/theme/palette.ts`) :

| Rôle | Couleur | Hex |
|---|---|---|
| Primaire | Bleu marine | `#1E40AF` |
| Fond application | Gris très clair | `#F8FAFC` |
| Surface (cartes) | Blanc | `#FFFFFF` |
| Accent positif | Vert | `#10B981` |
| Accent avertissement | Orange | `#F97316` |
| Accent critique | Rouge | `#EF4444` |

- **Typographie** : Inter (`@expo-google-fonts/inter`), 4 graisses (Regular/Medium/SemiBold/Bold) ; police mono (SpaceMono) conservée pour les valeurs numériques (kW, A, V).
- **Élévation** : `shadow-card` (cartes) / `shadow-elevated` (modales, écran de connexion) plutôt que la dépendance aux bordures du thème sombre précédent.
- **Jumeau numérique — exception volontaire** : le panneau du plan 2D (SVG) et la scène 3D (Three.js) restent sur fond sombre, un effet "spotlight" qui matche les tableaux de bord de supervision premium (Tesla Energy, Schneider EcoStruxure) sans nécessiter de retuner tout l'éclairage 3D.

## Composants réutilisables

`src/components/ui/` (import unique via `@/components/ui`) :

| Composant | Rôle |
|---|---|
| `Button`, `Card`, `Badge`, `Chip` | Primitives (5 variants de bouton dont `ghost` ; `Chip` = filtre sélectionnable, distinct de `Badge` = étiquette statique) |
| `Input`, `Label`, `Select`, `Switch`, `TimeInput` | Formulaires |
| `Modal` | Feuille coulissante (bottom sheet) — réutilisée pour les modales de confirmation et les info-bulles |
| `Toast` | Notification transiente (succès/erreur/info), pilotée par `uiStore` |
| `StatCard`, `StatusBadge`, `ProgressBar` | Affichage de métriques et de statuts d'alimentation |
| `EmptyState`, `ErrorState`, `Skeleton` | États de chargement/absence/échec — `ErrorState` distingue un échec réseau (avec bouton "Réessayer") d'un simple "rien à afficher" |

`src/components/onboarding/` : `WelcomeCarousel` (4 écrans à la première connexion, rejouable depuis Paramètres), `InfoTooltip` (icône "?" contextuelle, ~6 points d'usage : tableau de bord, jumeau numérique, centre de contrôle, recommandations IA).

## UX & accessibilité

- **Onboarding** : carrousel de bienvenue affiché une fois après la première connexion (`onboardingStore`, persistant), rejouable via Paramètres → "Revoir l'introduction" (utile en démonstration).
- **Contraste** : le gris de texte secondaire (`#64748B`) est choisi pour rester lisible (≥ AA) sur fond clair — volontairement plus foncé que le gris d'origine de la maquette sombre, qui échouait ce contraste une fois basculé sur fond blanc.
- **Responsive** : `useBreakpoint()` (mobile < 640px, tablette 640–1024px, desktop > 1024px) adapte le nombre de colonnes du tableau de bord et des équipements, et bascule le rapport graphique+tableau en côte-à-côte sur desktop.
- **Retour haptique** : `expo-haptics` sur les actions critiques (confirmation Centre de contrôle, bascule de circuit, sauvegarde de règle) et la navigation par onglets — no-op automatique sur web.
- **Performance temps réel** : le flux `measurement` WebSocket est throttlé (~1 mise à jour store / 500 ms / zone) pour éviter un re-rendu à chaque tick du simulateur (jusqu'à 5×/s en mode démo accéléré) ; `React.memo`/`useMemo` ciblés sur le jumeau numérique et les listes dérivées.

## PWA

- **Manifest** (`public/manifest.json`) et thème (`app.json`) alignés sur la couleur de marque (`#1E40AF`).
- **Mode hors-ligne** : `public/service-worker.js` (stratégie *network-first*, n'intercepte jamais les appels API backend sur le port `3000`) sert `public/offline.html` en repli si une navigation échoue sans réseau ni cache. Cache versionné (`powerlens-v2`) — incrémenté à chaque changement visuel majeur pour éviter qu'un utilisateur PWA reste bloqué sur des assets périmés.
- **Installation** : "Ajouter à l'écran d'accueil" depuis le navigateur mobile/desktop (Chrome/Edge) une fois `npm run web` lancé.
- **Limite connue** : les icônes d'application (`assets/icon.png` et dérivés) sont les artefacts existants, réutilisés tels quels — aucune nouvelle iconographie n'a été produite dans le cadre de cette refonte (nécessiterait un outil de génération d'image dédié).

## Installation

### Prérequis

- Node.js 20+
- PostgreSQL (port `5434` par défaut en démo)
- Broker MQTT Mosquitto (port `1883`)

### Backend

```bash
cd powerlens-backend
npm install
npx prisma generate
npx prisma migrate deploy   # applique les migrations (jusqu'à v4_zone_measurements)
npm run prisma:seed         # données de démo (idempotent)
npm run start:dev           # API sur http://localhost:3000
```

### Frontend

```bash
cd powerlens-mobile
npm install
npm run web        # ouvre http://localhost:8081 (ou 8082 selon config)
# ou : npm run start   (menu interactif Android/iOS/web via Expo Go)
```

Guide détaillé pas-à-pas (Docker, dépannage, démo sur téléphone physique) : **[`docs/setup.md`](docs/setup.md)**.

## Variables d'environnement

### Backend — `powerlens-backend/.env`

| Variable | Exemple | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:1234@localhost:5434/powerlens?schema=public` | Connexion PostgreSQL |
| `JWT_SECRET` | — | Clé de signature JWT (obligatoire) |
| `JWT_EXPIRES_IN` | `15m` | Durée de validité du token |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | URL du broker MQTT |
| `SIMULATOR_ENABLED` | `true` | Active le simulateur (désactivé automatiquement dès qu'un ESP32 réel est détecté) |
| `SIMULATOR_INTERVAL_MS` | `2000`–`5000` | Intervalle de publication du simulateur |
| `ESP_TIMEOUT_MS` | `30000` | Délai sans trafic ESP32 avant réactivation du simulateur |
| `ESP_STARTUP_WAIT_MS` | `15000` | Délai avant la première évaluation au démarrage |
| `SUPERVISOR_ENABLED` | `false` | Active l'analyse IA nocturne (cron) |
| `COMMAND_ACK_TIMEOUT_MS` | `10000` | Délai avant qu'une commande ON/OFF sans accusé matériel déclenche une alerte |
| `PORT` | `3000` | Port HTTP/WebSocket |
| `SEED_ADMIN_PASSWORD` | `admin123` | Mot de passe de l'administrateur seedé |
| `CORS_ORIGINS` | — | Origines autorisées (séparées par virgule) |

### Frontend — `powerlens-mobile/.env`

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL du backend (IP LAN pour un téléphone physique) |

Détail complet, y compris la configuration réseau pour tester sur téléphone Android : [`docs/setup.md`](docs/setup.md).

## Base de données

PostgreSQL via Prisma. Hiérarchie de supervision à 3 niveaux :

```
Building
  └── MonitoringZone (type BUILDING)   ← départ général, mesurée par un module dédié si déployé
  └── MonitoringZone (type CORRIDOR)   ← mesurée
  └── MonitoringZone (type ROOM)       ← mesurée
        └── Circuit (LIGHTING | SOCKET | HVAC | FAN)  ← commandable, non mesuré individuellement
```

Depuis la migration `v4_zone_measurements`, `EnergyMeasurement` et `Channel` sont rattachés à une **zone** (`zoneId`) plutôt qu'à un circuit ; `circuitId` est conservé nullable sur ces deux tables pour l'historique pré-V4 uniquement. Le détail des migrations et la stratégie de préservation des données est documenté dans [`docs/database.md`](docs/database.md).

Un `Building` peut héberger **plusieurs `Device`** (un module ESP32 physique par zone instrumentée), chacun identifié par son `deviceUid` unique. Chaque `Circuit` est rattaché à **un seul** `Device` (`deviceId`) : c'est ce lien qui détermine le topic MQTT sur lequel une commande ON/OFF est publiée (`powerlens/{buildingId}/{deviceUid}/command/{circuitId}`). Ce lien doit rester synchronisé avec le `DEVICE_UID` réellement flashé sur le module physique qui pilote le relais du circuit — un changement de module (remplacement, ré-flash sous un nouvel ID) nécessite de mettre à jour `Circuit.deviceId` en base. Les mesures entrantes n'ont pas cette contrainte : la souscription MQTT est wildcardée sur le device (`powerlens/+/+/measure`) et le routage se fait par `zoneId` contenu dans le payload, donc n'importe quel device peut publier des mesures sans configuration préalable.

## Simulateur

`SimulatorService` publie, toutes les `SIMULATOR_INTERVAL_MS`, une mesure réaliste par zone **ROOM/CORRIDOR** (puissance = somme des puissances instantanées de ses circuits actifs, modèle de charge horaire type bureau), puis synthétise une mesure **BUILDING** (départ général) par bâtiment = somme des zones ROOM/CORRIDOR + légères pertes de distribution. Cette valeur simulée sert de repli tant qu'aucun module matériel dédié n'est branché sur le départ général — dès qu'une vraie mesure existe pour cette zone, l'API l'utilise directement. Les champs environnementaux (luminosité, présence, température) suivent la matrice ci-dessous.

| Champ | Salle (ROOM) | Couloir (CORRIDOR) | Bâtiment (BUILDING) |
|---|---|---|---|
| tension, courant, puissance, énergie, fréquence, facteur de puissance | ✔ | ✔ | ✔ *(direct si un module départ général existe, sinon calculé)* |
| luminosité | ✔ | ✔ | — |
| présence | ✔ | ✔ | — |
| température | ✔ | — | — |

`ProviderSwitcherService` bascule automatiquement entre simulateur et matériel réel (détection via le flag `_sim` du payload), sans redémarrage. Détail dans [`docs/mqtt.md`](docs/mqtt.md).

## MQTT

| Usage | Topic | Sens |
|---|---|---|
| Mesure (zone) | `powerlens/{buildingId}/{deviceId}/measure` | ESP32 → Backend |
| Commande (circuit) | `powerlens/{buildingId}/{deviceId}/command/{circuitId}` | Backend → ESP32 |
| Accusé de réception | `powerlens/{buildingId}/{deviceId}/ack/{circuitId}` | ESP32 → Backend |
| Événement | `powerlens/{buildingId}/{deviceId}/event` | ESP32 → Backend |

Payload de mesure — identifie désormais une **zone**, pas un circuit :

```json
{
  "zoneId": "<uuid de la zone ROOM ou CORRIDOR>",
  "voltage": 221.3, "current": 3.81, "power": 843.6, "energyKwh": 1.24,
  "measuredAt": "2026-07-01T10:00:00.000Z",
  "frequency": 50.02, "powerFactor": 0.98,
  "luminosity": 450, "presence": true, "temperature": 27.5,
  "circuits": [
    { "circuitId": "b528100e-78c5-4860-9e70-f610c7d835d9", "isActive": true },
    { "circuitId": "2bf8e37e-1598-4a72-b0a3-b237d4f5e33f", "isActive": false }
  ]
}
```

`circuits` (optionnel) est l'état réel des relais **de la zone possédée par le device émetteur** — absent des paquets "secours" simulés pour les autres zones. Permet au mobile de savoir qu'une charge est déjà ON/OFF avant d'envoyer une commande redondante ; le backend met à jour `Circuit.isActive` en base et rediffuse `circuit:status` (même événement que pour les commandes utilisateur). Si toutes les charges d'une zone sont éteintes, le device publie `voltage`/`current`/`power` à `0` pour cette zone (`energyKwh` n'est jamais remis à zéro).

Les commandes/ACK restent scopées par circuit (`.../command/{circuitId}`) — les circuits demeurent individuellement pilotables. Contrat complet, guide d'intégration ESP32 et firmware de référence : [`docs/mqtt.md`](docs/mqtt.md), [`docs/hardware.md`](docs/hardware.md), [`code_salle.ino`](code_salle.ino) (module Salle), [`code_couloir/code_couloir.ino`](code_couloir/code_couloir.ino) (module Couloir).

**Fiabilité des commandes** — `CommandTrackerService` corrèle chaque commande ON/OFF envoyée à son ACK via `correlationId` (écho par le firmware). Sans ACK dans le délai `COMMAND_ACK_TIMEOUT_MS` (10 s par défaut), le système considère que la commande n'a atteint aucun device (topic sans abonné — typiquement un `Circuit.deviceId` désynchronisé du module physique réel) et lève automatiquement une alerte + une entrée d'audit `COMMAND_TIMEOUT`, plutôt que de laisser l'interrupteur mobile rester silencieusement sans effet.

Côté ingestion des mesures, `MeasurementListener` filtre chaque champ numérique contre sa plage physique plausible (ex. `voltage` ∈ [0, 500] V) avant validation — un champ hors plage (bruit capteur, lecture corrompue) est traité comme absent (`null`) sans faire échouer le reste de la mesure.

## WebSocket

`RealtimeGateway` (socket.io, sans authentification, `cors: '*'`) diffuse :

| Événement | Déclencheur |
|---|---|
| `measurement` | Mesure de zone reçue (avant même son écriture en base) |
| `alert` | Action `ALERT` d'une règle déclenchée |
| `circuit:status` | Changement d'état d'un circuit (commande utilisateur, règle, ou ACK matériel) |
| `provider:switched` | Bascule simulateur ↔ ESP32 réel |

Détail des payloads : [`docs/websocket.md`](docs/websocket.md).

## API

Base URL : `http://localhost:3000`. Routes protégées (JWT) marquées 🔒.

| Domaine | Routes principales |
|---|---|
| Authentification | `POST /auth/login`, `POST /auth/logout` 🔒, `GET /auth/me` 🔒 |
| Bâtiments | `GET /buildings`, `GET /buildings/:id`, `PATCH /buildings/:id` 🔒, `PATCH /buildings/:id/power-status` 🔒 |
| Zones | `GET /zones`, `GET /zones/:id`, `GET /zones/:id/circuits`, `GET /zones/:id/channels`, `GET /zones/:id/measurements` |
| Circuits | `GET /circuits/:id`, `PATCH /circuits/:id` 🔒, `PATCH /circuits/:id/activate` 🔒, `PATCH /circuits/:id/deactivate` 🔒, `GET /circuits/:id/channels` *(compat, résout vers la zone)* |
| Mesures | `GET /measurements` *(filtre `zoneId`, `granularity`)* |
| Règles | `GET/POST /rules`, `PATCH/DELETE /rules/:id` 🔒 |
| Supervision IA | `GET /supervisor/recommendations`, `PATCH .../approve` 🔒, `PATCH .../reject` 🔒, `POST /supervisor/runs/trigger` 🔒 |
| Audit | `GET /audit-logs` 🔒, `POST /audit/events` 🔒 *(consultation d'écran côté client)* |

`PATCH /buildings/:id/power-status` (`{status: 'POWERED'|'LIMITED'|'CUTOFF'}`) bascule tous les circuits du bâtiment en une seule action serveur (LIMITED conserve les circuits critiques actifs), publie les commandes MQTT nécessaires et journalise une entrée d'audit groupée. Référence complète : [`docs/api.md`](docs/api.md).

## Comptes de démonstration

| Email | Mot de passe | Rôle |
|---|---|---|
| `admin@powerlens.local` | `admin123` (via `SEED_ADMIN_PASSWORD`) | `ADMIN` |

⚠️ Identifiants de développement uniquement — à changer avant tout déploiement réel.

## Lancement de la démonstration

Trois terminaux, depuis la racine du dépôt :

**Terminal 1 — Dépendances (PostgreSQL + MQTT)**
```bash
docker start powerlens-postgres powerlens-mqtt
```

**Terminal 2 — Backend**
```bash
cd powerlens-backend
npm run prisma:seed && npm run start:dev
```
Vérifier dans les logs : `MQTT connecté avec succès`, puis (sans ESP32) `PROVIDER_SWITCHED_TO_SIMULATOR`.

**Terminal 3 — Frontend (PC, navigateur)**
```bash
cd powerlens-mobile
npm run web
```

**Sur téléphone Android (même réseau Wi-Fi)** : récupérer l'IP LAN du PC (`ipconfig`), la renseigner dans `powerlens-mobile/.env` (`EXPO_PUBLIC_API_URL=http://<IP>:3000`), lancer `npm run start` et scanner le QR code avec **Expo Go**.

Procédure détaillée, dépannage et commandes de debug MQTT : [`docs/setup.md`](docs/setup.md).

## Guide de démonstration jury

**Parcours suggéré** (reflète la navigation réelle de l'app, onglet par onglet) :

1. **Connexion** — écran de connexion, identité de marque.
2. **Accueil** — pastilles de statut (alertes, circuits actifs, connexion temps réel, suggestions IA), consommation 24h en direct, raccourci Centre de contrôle.
3. **Jumeau numérique** — vue 3D interactive (web) ou 2D (natif), zones colorées par charge en temps réel, clic → détail de la salle.
4. **Salles → détail** — mesures live (tension, courant, puissance, luminosité, présence, température), pilotage des circuits.
5. **Plus → Recommandations IA** *(rôle ADMIN)* — mettre en avant la justification, les gains chiffrés et les points d'attention d'une recommandation.
6. **Plus → Centre de contrôle** — bascule groupée du bâtiment (Alimenté/Limité/Coupé), niveau de risque affiché avant confirmation.

**Points forts à souligner** : temps réel sans détour par la base (WebSocket direct), jumeau numérique 2D/3D, moteur de règles déterministe transparent (pas de boîte noire), Smart Supervisor qui justifie chaque suggestion plutôt que d'agir seul, traçabilité complète (`AuditLog`).

**Limitations à anticiper si questionnées** (voir [Limites actuelles](#limites-actuelles) pour le détail) : le module Classement est un stub non finalisé ; les recommandations IA n'exposent pas de champ "risques" dédié côté backend (dérivé côté client à partir de la confiance et du type d'action) ; la navigation desktop réutilise la barre d'onglets mobile plutôt qu'une barre latérale dédiée.

## Fonctionnalités

- **Monitoring temps réel** par zone (salle/couloir), agrégation bâtiment en lecture.
- **Pilotage des circuits** — ON/OFF individuel, ou groupé par zone/bâtiment (Centre de contrôle : Alimenté/Limité/Coupé, respecte les circuits critiques).
- **Moteur de règles** déterministe — conditions `THRESHOLD` (scopables à une zone précise), `SCHEDULE`, `EVENT`, `PRESENCE`, `AND`/`OR` ; actions `SWITCH_OFF` (circuit ou zone) et `ALERT`. 8 règles par défaut sur le bâtiment SCOP (seedées de façon idempotente par nom), dont 5 pensées pour un usage scolaire : coupure climatisation si déjà fraîche, coupure éclairage couloir/salle sur absence prolongée, extinction nocturne, fermeture complète le week-end — voir [STATE.md](STATE.md) V8.
- **Suggestions intelligentes** (Smart Supervisor, optionnel) — détection de surconsommation, de zones inoccupées, de règles inefficaces ou d'alertes répétitives ; toute proposition reste soumise à validation administrateur.
- **Historique** — mesures de zone agrégées par bucket temporel (heure/jour/semaine/mois), rapports par salle avec export CSV.
- **Audit unifié** — chaque action significative (connexion/déconnexion, consultation d'écran, commande ON/OFF envoyée/confirmée/expirée (`COMMAND_TIMEOUT`), création/validation/refus de règle, connexion/déconnexion/erreur MQTT, activation du simulateur, bascule ESP32, erreur API) est journalisée simultanément dans la console backend, la table `AuditLog` et consultable via `GET /audit-logs` — via le point d'entrée unique `AuditService.log()`.
- **Modélisation graphique du bâtiment** — jumeau numérique 2D (SVG, zones dynamiques) et 3D (web, `three.js`), code couleur par niveau de charge.
- **Alertes** en temps réel (WebSocket), historique consultable.
- **Mode démonstration** — bascule automatique simulateur ↔ matériel réel, sans redémarrage.

## Limites actuelles

Ces contraintes reflètent des **choix du prototype matériel actuel**, pas des lacunes logicielles :

- **Pas de mesure par circuit** : le matériel (un module ESP32 + un capteur PZEM004T par zone) mesure l'arrivée électrique globale d'une salle, d'un couloir ou du départ général du bâtiment — pas chaque circuit séparément. Les circuits restent individuellement commandables (relais), mais leur consommation propre n'est pas isolable — seule la consommation de leur zone est disponible.
- **Détection d'anomalie à la granularité de la zone** : en conséquence, le Smart Supervisor ne peut plus détecter un équipement précis en panne/débranché au sein d'une zone par ailleurs active ; il détecte en revanche une zone entière anormalement inoccupée.
- **Zone BUILDING sans module dédié tant qu'il n'est pas branché** : le déploiement type prévoit un module sur le départ général du bâtiment, mais tant qu'il n'est pas physiquement installé, sa mesure est une valeur calculée en lecture (somme/moyenne des zones ROOM/CORRIDOR) — l'API bascule automatiquement sur la vraie mesure dès qu'elle existe, sans changement côté frontend.
- **WebSocket sans authentification** (`cors: '*'`) — acceptable en démonstration sur réseau local fermé, à sécuriser avant toute exposition publique.
- **JWT sans rafraîchissement** (`JWT_EXPIRES_IN=15m`, pas de `POST /auth/refresh`) — l'utilisateur est redirigé vers l'écran de connexion à expiration.

Limitations propres à la refonte UX/UI (frontend uniquement, aucun impact backend) :

- **Module Classement (gamification)** non finalisé — l'écran est un placeholder habillé au nouveau thème, sa logique reste à implémenter séparément.
- **Pas de champ "risques" pour les recommandations IA** — `RuleRecommendation` n'expose que `justification`/`estimatedImpact`/`confidence` côté backend ; les "points d'attention" affichés dans le détail d'une recommandation sont dérivés côté client (confiance faible, type d'action) et non une évaluation de risque du backend.
- **Navigation desktop = barre d'onglets mobile** — pas de barre latérale dédiée aux grands écrans ; choix de portée assumé pour limiter le risque sur le calendrier.
- **Icônes d'application non régénérées** — les artefacts existants (`assets/icon.png` et dérivés Android) sont réutilisés tels quels ; aucun nouvel outil de génération d'image n'a été utilisé dans cette passe.
