# Contrat MQTT — PowerLens

## 1. Broker

- URL configurée via `MQTT_BROKER_URL` (`.env`), défaut
  `mqtt://localhost:1883`.
- Client ID : `rule-engine-client` (`MqttService`).
- Options : `clean: true`, `connectTimeout: 4000ms`,
  `reconnectPeriod: 2000ms` (reconnexion automatique en cas de coupure du
  broker — chaque tentative est logguée via `logger.warn('Reconnexion
  MQTT...')`).
- En cas d'erreur de connexion, `logger.error('Erreur MQTT', err)` est
  appelé ; le service ne plante pas, il retente la connexion
  indéfiniment.

## 2. Topics

Tous les topics suivent le préfixe `powerlens/{buildingId}/{deviceId}/...`,
où `deviceId` correspond au champ `Device.deviceUid` (ex. `ESP32-PL-001`),
**pas** à l'`id` UUID Prisma.

| Usage | Topic | Sens |
|---|---|---|
| Mesures | `powerlens/{buildingId}/{deviceId}/measure` | ESP32 → Backend |
| Commandes | `powerlens/{buildingId}/{deviceId}/command/{circuitId}` | Backend → ESP32 |
| Accusés de réception (ack) | `powerlens/{buildingId}/{deviceId}/ack/{circuitId}` | ESP32 → Backend |
| Événements | `powerlens/{buildingId}/{deviceId}/event` | ESP32 → Backend |

Le backend s'abonne avec des wildcards MQTT (`+` = un niveau) :
`powerlens/+/+/measure`, `powerlens/+/+/ack/+`, `powerlens/+/+/event`.

Fonctions utilitaires (`src/mqtt/config/mqtt.config.ts`) : `measureTopic`,
`commandTopic`, `ackTopic`, `eventTopic`, `parseTopic` (extrait
`{ buildingId, deviceId, segment, last }` d'un topic).

## 3. Formats de message

### 3.1 Mesure — `powerlens/{buildingId}/{deviceId}/measure`

Payload JSON envoyé par l'ESP32 (ou le simulateur). Depuis V4, une mesure
est rattachée à une **zone** (ROOM ou CORRIDOR), pas à un circuit — les
circuits restent commandables mais ne sont plus mesurés individuellement :

```json
{
  "zoneId": "<uuid de la zone ROOM ou CORRIDOR>",
  "voltage": 221.34,
  "current": 3.812,
  "power": 843.59,
  "energyKwh": 1.2456,
  "measuredAt": "2026-06-12T10:15:30.000Z",

  // Champs optionnels — à inclure selon le type de zone :
  "frequency": 50.02,      // Hz — toutes les zones
  "powerFactor": 0.98,     // 0..1 — toutes les zones
  "luminosity": 450.0,     // lux — zones ROOM et CORRIDOR
  "presence": true,        // bool — zones ROOM et CORRIDOR
  "temperature": 27.5,     // °C — zones ROOM uniquement ⚠ ignoré ailleurs

  // Optionnel (V8) — état réel des relais du device émetteur, uniquement
  // sur le paquet de SA zone possédée (jamais sur ses paquets secours) :
  "circuits": [
    { "circuitId": "<uuid>", "isActive": true },
    { "circuitId": "<uuid>", "isActive": false }
  ]
}
```

> **Note V4** : le backend supprime silencieusement `temperature` (et
> `presence`/`luminosity` pour toute zone qui n'est ni `ROOM` ni
> `CORRIDOR`), avec un warning en log. Le reste du payload est traité
> normalement. Aucun ESP32 ne doit publier avec un `zoneId` de type
> `BUILDING` (zone d'agrégation en lecture seule, jamais de mesure
> directe). Voir [hardware.md](hardware.md) pour le tableau récapitulatif
> par type de zone.
>
> **Note V8** : si `circuits` est présent, `MeasurementListener` met à jour
> `Circuit.isActive` pour chaque entrée (best-effort, `circuitId` inconnu
> ignoré) et rediffuse `circuit:status` — même événement WebSocket que pour
> une commande utilisateur (voir [websocket.md](websocket.md)). Si toutes
> les charges de la zone possédée par un module sont éteintes, celui-ci
> publie `voltage`/`current`/`power` à `0` (jamais `energyKwh`, compteur
> cumulé).

Traitement côté backend (`MeasurementListener.handleMeasurement`) :

1. Si `zoneId` et `measuredAt` sont présents → insertion dans
   `EnergyMeasurement` (PostgreSQL), de manière asynchrone.
2. Diffusion immédiate via WebSocket, événement `measurement`
   (voir [websocket.md](websocket.md)) — **avant même** la persistance.
3. Évaluation des règles actives du bâtiment
   (`RuleEngineService.evaluateMeasurement`) → déclenchement éventuel
   d'actions `SWITCH_OFF` (commande MQTT, ciblant un circuit ou tous les
   circuits non-critiques d'une zone) ou `ALERT` (ligne `Alert` +
   WebSocket `alert`).

### 3.2 Commande — `powerlens/{buildingId}/{deviceId}/command/{circuitId}`

Publiée par le backend (suite à `PATCH /circuits/:id/activate|deactivate`,
`PATCH /circuits/:id` avec `isActive`, ou à une action `SWITCH_OFF` du
moteur de règles) :

```json
{
  "command": "ON",
  "correlationId": "<circuitId>-<timestamp>",
  "timestamp": "2026-06-12T10:15:31.000Z",
  "ruleId": "<uuid, présent uniquement si déclenché par une règle>"
}
```

`command` ∈ `"ON" | "OFF"`. `correlationId` permet de relier la commande à
son accusé de réception (`ack`).

Chaque commande crée une entrée `AuditLog` :
- `actorType: 'USER'` (action manuelle via API) ou `'SYSTEM'` (moteur de
  règles) ;
- `action: 'ACTIVATE' | 'DEACTIVATE'` ou `'SWITCH_ON_SENT' |
  'SWITCH_OFF_SENT'` ;
- `metadata: { correlationId, ruleId?, status: 'PENDING' }`.

### 3.3 Accusé de réception — `powerlens/{buildingId}/{deviceId}/ack/{circuitId}`

Publié par l'ESP32 après exécution d'une commande :

```json
{ "correlationId": "<circuitId>-<timestamp>", "status": "SUCCESS" }
```

Traitement côté backend (`MeasurementListener`, flux ACK) :

1. Création d'un `AuditLog` (`actorType: 'HARDWARE'`,
   `action: 'SWITCH_OFF_ACK'`, `metadata: { ...payload, status: 'CONFIRMED' }`).
2. `CommandTrackerService.resolve(correlationId, success)` retrouve l'état
   **voulu par la commande d'origine** (`ON` ou `OFF`, mémorisé au moment de
   la publication via `track()`) et, si `status === 'SUCCESS'`, met à jour
   `Circuit.isActive` avec cet état — pas un simple `false` forcé. Un ACK
   inconnu, déjà expiré (délai `COMMAND_ACK_TIMEOUT_MS`), ou `FAILURE`
   ne modifie pas `isActive`.
3. Diffusion WebSocket `circuit:status` avec `{ circuitId, isActive }`.

Sans ACK dans le délai imparti, `CommandTrackerService` lève une alerte
`WARNING` + une entrée d'audit `COMMAND_TIMEOUT` (cf. §5).

### 3.4 Événement — `powerlens/{buildingId}/{deviceId}/event`

Payload libre, déclenche les règles de type `EVENT` (comparaison sur
`eventName`) :

```json
{ "eventName": "DOOR_OPEN", "circuitId": "<uuid, optionnel>" }
```

Traitement : `RuleEngineService.evaluateMeasurement` est appelé avec
`{ ...payload, buildingId, deviceId }` ; les décisions résultantes suivent
le même traitement que pour une mesure (actions `SWITCH_OFF`/`ALERT`).

## 4. Simulateur matériel (`SimulatorService`)

Pour démontrer PowerLens sans ESP32 physique :

- Activation : `SIMULATOR_ENABLED=true` dans `.env` (défaut : `false`).
- Intervalle : `SIMULATOR_INTERVAL_MS` (défaut `5000` ms).
- À chaque tick, pour **chaque zone `ROOM`/`CORRIDOR`** :
  - `power` = somme des puissances instantanées de ses circuits `isActive`
    (mêmes formules par type de circuit qu'avant V4 — LIGHTING quasi
    constant, HVAC/FAN proportionnels à la charge horaire, SOCKET bruité) ;
  - `voltage` aléatoire entre ~217 V et ~223 V, `current = power / voltage` ;
  - `energyKwh` cumulé incrémentalement par zone (intégration de `power`
    sur l'intervalle) ;
  - `luminosity`/`presence` (ROOM + CORRIDOR) et `temperature` (ROOM
    uniquement) simulés selon le facteur de charge horaire ;
  - publication sur `measureTopic(buildingId, device.deviceUid)` avec
    `measuredAt` = horodatage courant, `zoneId` = la zone.
- Puis, pour **chaque zone `BUILDING`** (départ général) : mesure
  synthétisée = somme des `power`/`current` des zones ROOM/CORRIDOR du même
  bâtiment (+ ~1.5-2.5 % de pertes de distribution), `voltage`/`frequency`/
  `powerFactor` moyennés. Sert de valeur de repli tant qu'aucun module
  matériel dédié n'est branché sur le départ général — dès qu'une vraie
  mesure existe pour cette zone, `MeasurementsService.findByZone` bascule
  dessus (cf. [database.md](database.md)).

Le `buildingId` est résolu directement via `MonitoringZone.buildingId`. Le
device cible est celui du premier circuit de la zone pour ROOM/CORRIDOR
(`zone.circuits[0].device` — une zone sans circuit est ignorée, log
d'avertissement), ou le premier device du bâtiment pour la zone BUILDING
(`prisma.device.findFirst({ where: { buildingId } })`).

## 5. Résilience

- Le `MqttService` ne fait jamais planter l'application si le broker est
  indisponible : il retente la connexion en boucle (`reconnectPeriod`).
- `MeasurementListener` capture toutes les erreurs de traitement
  (`try/catch` par flux : mesure, événement, ack) et les journalise sans
  interrompre les autres abonnements.
- Tant que le broker est down, aucune nouvelle mesure n'arrive : l'app
  mobile doit afficher un indicateur de connexion WebSocket pour refléter
  l'absence de données fraîches (voir [websocket.md](websocket.md)).
