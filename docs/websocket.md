# WebSocket temps réel — PowerLens

## 1. Vue d'ensemble

Le backend expose une passerelle WebSocket basée sur **socket.io**
(`@nestjs/websockets` + `@nestjs/platform-socket.io`), implémentée dans
`src/realtime/realtime.gateway.ts` (`RealtimeGateway`).

- **URL** : même hôte/port que l'API REST (`API_URL`, défaut
  `http://localhost:3000`).
- **CORS** : ouvert (`origin: '*'`).
- **Authentification** : aucune pour l'instant — tout client peut se
  connecter et recevoir tous les événements. À sécuriser avant une
  exposition publique (cf. [architecture.md](architecture.md), §4.3).
- **Rôle** : diffusion uniquement (`server.emit(...)`), pas de gestion de
  messages entrants côté client dans l'implémentation actuelle.

Conformément à la règle architecturale du temps réel : ces événements sont
émis **dès réception** d'un message MQTT, avant ou en parallèle de toute
écriture en base — PostgreSQL ne sert que d'historique, jamais de source
pour l'affichage temps réel.

## 2. Événements diffusés

### `measurement`

Émis par `RealtimeGateway.emitMeasurement(payload)`, appelé par
`MeasurementListener.handleMeasurement` à chaque message reçu sur
`powerlens/+/+/measure` (avant même la tentative d'insertion en base).

**Payload** (reflet direct du message MQTT, enrichi de `buildingId`/`deviceId`) — depuis V4, identifie une **zone** (`zoneId`), pas un circuit :
```json
{
  "zoneId": "<uuid de la zone ROOM ou CORRIDOR>",
  "voltage": 221.34,
  "current": 3.812,
  "power": 843.59,
  "energyKwh": 1.2456,
  "measuredAt": "2026-06-12T10:15:30.000Z",
  "buildingId": "<uuid>",
  "deviceId": "ESP32-PL-001"
}
```

### `alert`

Émis par `RealtimeGateway.emitAlert(alert)` quand le moteur de règles
déclenche une action de type `ALERT`. Le payload est l'enregistrement
`Alert` créé en base :

```json
{
  "id": "<uuid>",
  "level": "WARNING",
  "message": "Surconsommation détectée sur Climatisation Serveur",
  "createdAt": "2026-06-12T10:15:31.000Z",
  "acknowledged": false,
  "buildingId": "<uuid>",
  "ruleId": "<uuid>"
}
```

`level` ∈ `INFO | WARNING | CRITICAL`.

### `circuit:status`

Émis par `RealtimeGateway.emitCircuitStatus(payload)` dans deux cas :

1. Après `PATCH /circuits/:id/activate|deactivate` ou
   `PATCH /circuits/:id` (avec `isActive`) — changement d'état initié par
   un utilisateur ou par le moteur de règles.
2. Après réception d'un ACK matériel
   (`powerlens/{buildingId}/{deviceId}/ack/{circuitId}`) confirmant
   l'exécution d'une commande.

**Payload**
```json
{ "circuitId": "<uuid>", "isActive": false }
```

## 3. Côté mobile (`powerlens-mobile/src/services/websocket.ts`)

```ts
import { connectSocket, on, off, disconnectSocket, isSocketConnected } from '@/services/websocket';

connectSocket(); // io(API_URL, { transports: ['websocket'], autoConnect: true })

on('measurement', (payload) => { /* mise à jour measurementsStore */ });
on('alert', (payload) => { /* mise à jour alertsStore */ });
on('circuit:status', (payload) => { /* mise à jour roomStore/circuit */ });

on('connect', () => { /* indicateur "en ligne" */ });
on('disconnect', () => { /* indicateur "hors ligne", désactiver les commandes */ });
```

- Transport forcé en `websocket` (pas de fallback polling).
- `isSocketConnected()` permet de piloter l'indicateur de connexion dans
  l'UI (résilience demandée par `claude.md` §4 : indicateur "Hors ligne" +
  désactivation des boutons de commande quand le socket est déconnecté).
- Recommandation : appliquer un *throttle*/*debounce* côté client sur
  l'événement `measurement` si le flux MQTT est très fréquent (simulateur à
  intervalle court), pour éviter de surcharger le rendu React Native.

## 4. Résumé des événements

| Événement | Émetteur | Déclencheur | Consommateurs typiques (mobile) |
|---|---|---|---|
| `measurement` | `MeasurementListener` | Message MQTT `measure` | Dashboard, détail circuit/salle (graphiques temps réel) |
| `alert` | `MeasurementListener` (via moteur de règles) | Action `ALERT` d'une règle déclenchée | Écran Alertes, badge de notification |
| `circuit:status` | `CircuitsService` / `MeasurementListener` (ACK) | Activation/désactivation (API ou règle) ou ACK matériel | Liste/détail circuits, centre de contrôle |
