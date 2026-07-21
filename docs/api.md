# API REST — PowerLens Backend

Base URL par défaut : `http://localhost:3000` (configurable via `PORT`).

Toutes les réponses sont en JSON. Le `ValidationPipe` global est configuré
avec `whitelist: true` et `transform: true` (les champs non déclarés dans
les DTO sont rejetés/ignorés, les types sont convertis automatiquement,
ex. query params `string` → `number`/`boolean`).

## 1. Authentification

L'API utilise des JWT (Bearer token), valables `JWT_EXPIRES_IN` (15 min par
défaut). Les routes protégées sont marquées **🔒** ci-dessous et nécessitent
l'en-tête :

```
Authorization: Bearer <access_token>
```

### `POST /auth/login`

Authentifie un utilisateur.

**Body**
```json
{ "email": "admin@powerlens.local", "password": "admin123" }
```

**Réponse 200**
```json
{
  "access_token": "<jwt>",
  "user": { "id": "uuid", "fullName": "Admin PowerLens", "email": "...", "role": "ADMIN" }
}
```

**Erreurs** : `401 Unauthorized` si email/mot de passe invalide ou compte
inactif (`isActive: false`).

### `POST /auth/logout` 🔒

Journalise la déconnexion (`AuditLog`, action `LOGOUT`) — JWT étant sans
état, ne fait rien côté serveur au-delà de la trace d'audit ; le client
supprime son token localement après l'appel.

### `GET /auth/me` 🔒

Retourne le profil de l'utilisateur authentifié.

**Réponse 200**
```json
{ "id": "uuid", "fullName": "Admin PowerLens", "email": "...", "role": "ADMIN" }
```

## 2. Bâtiments (`/buildings`)

### `GET /buildings`

Liste tous les bâtiments (`Building[]`).

### `GET /buildings/:id`

Détail d'un bâtiment. `404 Not Found` si inexistant.

### `GET /buildings/:id/rooms`

Liste les salles (`Room[]`) d'un bâtiment. `404` si bâtiment inexistant.

### `PATCH /buildings/:id` 🔒

Met à jour un bâtiment.

**Body (`UpdateBuildingDto`, tous champs optionnels)**
```json
{ "name": "string", "location": "string", "description": "string" }
```

### `PATCH /buildings/:id/power-status` 🔒

Bascule groupée de l'alimentation du bâtiment (Centre de contrôle) — une
seule action serveur, pas une boucle d'appels côté client.

**Body**
```json
{ "status": "POWERED" }
```
`status` ∈ `POWERED | LIMITED | CUTOFF`. `CUTOFF` coupe tous les circuits ;
`LIMITED` ne garde actifs que les circuits `isCritical`; `POWERED` réactive
tout. Réutilise `CircuitsService.setActive` pour chaque circuit modifié
(commande MQTT + audit + WebSocket `circuit:status` par circuit), puis
persiste `Building.powerStatus` et ajoute UNE entrée d'audit groupée
(`BUILDING_POWER_STATUS_CHANGED`, métadonnées : `status`,
`affectedCircuitIds`).

## 3. Zones (`/zones`) — endpoint canonique

Remplace progressivement `/rooms` (voir §4, conservé pour compatibilité).
Une zone est de type `BUILDING | CORRIDOR | ROOM`.

### `GET /zones`

**Query params** : `buildingId` (UUID, optionnel), `type` (`ZoneType`, optionnel), `floor` (int, optionnel).

### `GET /zones/:id`

Détail d'une zone (`building`, `parent`, `children` inclus). `404` si inexistante.

### `GET /zones/:id/circuits`

Circuits commandables de la zone.

### `GET /zones/:id/channels`

Catalogue des canaux mesurés par la zone (voir §"Mesures supportées" du README) — endpoint canonique, `GET /circuits/:id/channels` reste disponible par compatibilité et résout vers la zone du circuit.

### `GET /zones/:id/measurements`

Mesures de la zone — mêmes query params que `MeasurementsQueryDto` (§6).
Pour une zone `BUILDING` : si un module matériel dédié (départ général) a
déjà publié au moins une mesure pour cette zone, elle est traitée comme
n'importe quelle autre zone ; sinon, retourne une agrégation calculée
(somme/moyenne des zones `ROOM`/`CORRIDOR` du bâtiment par bucket temporel,
`granularity` par défaut `hour`).

## 4. Salles (`/rooms`) — compatibilité

### `GET /rooms`

Liste les salles, avec `building` inclus.

**Query params (`FindRoomsQueryDto`)**
| Param | Type | Description |
|---|---|---|
| `buildingId` | UUID (optionnel) | Filtre par bâtiment |
| `floor` | int (optionnel) | Filtre par étage |

### `GET /rooms/:id/circuits`

Liste les circuits (`Circuit[]`) d'une salle. `404` si salle inexistante.

### `GET /rooms/:id/measurements`

Alias de `GET /zones/:id/measurements` (§3) — mesures de la zone (plus des
circuits qu'elle contient, depuis V4). Mêmes query params que
`MeasurementsQueryDto` (voir §6). `404` si salle inexistante.

## 5. Circuits (`/circuits`)

### `GET /circuits/:id`

Détail d'un circuit (`zone`, `device` inclus). `404` si inexistant.

### `GET /circuits/:id/channels`

Résout la zone du circuit et retourne son catalogue de canaux (identique à
`GET /zones/:id/channels`, §3) — compatibilité, le circuit lui-même n'a
plus de canal propre depuis V4.

```json
[
  { "id": "uuid", "type": "voltage", "unit": "V", "zoneId": "uuid", "topic": "powerlens/{buildingId}/{deviceUid}/measure" },
  { "id": "uuid", "type": "current", "unit": "A", "zoneId": "uuid", "topic": "..." }
]
```

### `GET /circuits/:id/measurements`

⚠️ **Legacy** : ne renvoie plus que l'historique pré-V4 (mesures brutes
alors rattachées à ce circuit), potentiellement `[]` pour tout circuit créé
après la migration V4. Utiliser `GET /zones/:id/measurements` pour les
données courantes. Mêmes query params que `MeasurementsQueryDto` (§6).

### `PATCH /circuits/:id` 🔒

Met à jour un circuit.

**Body (`UpdateCircuitDto`, tous champs optionnels)**
```json
{ "name": "string", "maxPowerWatt": 2000, "isActive": true }
```

Si `isActive` est fourni, une commande MQTT `ON`/`OFF` est publiée vers le
device concerné et un `AuditLog` (`actorType: USER`) est créé.

### `PATCH /circuits/:id/activate` 🔒

Active le circuit (équivalent à `isActive: true`) : met à jour PostgreSQL,
publie la commande MQTT `ON`, journalise (`AuditLog`), diffuse
`circuit:status` via WebSocket.

### `PATCH /circuits/:id/deactivate` 🔒

Idem avec `OFF` / `isActive: false`.

## 6. Mesures (`/measurements`)

### `GET /measurements`

**Query params (`MeasurementsQueryDto`)**
| Param | Type | Description |
|---|---|---|
| `zoneId` | UUID (optionnel) | Filtre par zone (courant depuis V4) |
| `circuitId` | UUID (optionnel) | Filtre par circuit — **legacy**, historique pré-V4 uniquement |
| `from` | date ISO (optionnel) | Borne inférieure (`measuredAt >=`) |
| `to` | date ISO (optionnel) | Borne supérieure (`measuredAt <=`) |
| `granularity` | `hour\|day\|week\|month` (optionnel) | Active l'agrégation |

**Sans `granularity`** : liste brute de `EnergyMeasurement`, triée par
`measuredAt` croissant, `id` sérialisé en `string` (BigInt).

**Avec `granularity`** : agrégation SQL (`date_trunc`) par zone et par
« bucket » temporel :
```json
[
  {
    "id": "uuid-de-la-zone",
    "bucket": "2026-06-10T00:00:00.000Z",
    "avgPower": 850.3,
    "maxPower": 1200,
    "avgVoltage": 220.1,
    "avgCurrent": 3.8,
    "totalEnergyKwh": 4.2,
    "avgFrequency": 50.0,
    "avgPowerFactor": 0.92,
    "avgLuminosity": 410.2,
    "avgTemperature": 24.6
  }
]
```

Pour une zone `BUILDING` sans mesure directe (`GET /zones/:id/measurements`),
la même forme est utilisée mais **sans** le champ `id` ni
`avgLuminosity`/`avgTemperature` — c'est une série calculée agrégeant
plusieurs zones, pas une mesure directe (voir §3). Dès qu'un module dédié
publie pour cette zone, la forme standard (avec `id`) est utilisée.

## 7. Règles (`/rules`)

Format des règles : `conditions` (JSONB, union discriminée — voir
[architecture.md](architecture.md) et `rules-engine.service.ts`) et
`actions` (tableau de `{ type: 'SWITCH_OFF' | 'ALERT', targetId?, targetType?, payload? }`).

Types de conditions supportés : `THRESHOLD` (+ `zoneId` optionnel pour
restreindre à une zone précise), `SCHEDULE`, `AND`, `OR`, `EVENT`,
`PRESENCE` (+ `zoneId` optionnel — vérifie l'état de présence instantané
d'une mesure de zone ROOM/CORRIDOR, pas de fenêtre temporelle glissante).

Pour `SWITCH_OFF`, `targetType` (`CIRCUIT` par défaut, ou `ZONE`) détermine
si `targetId` est un `circuitId` (coupe ce circuit) ou un `zoneId` (coupe
tous les circuits actifs **non-critiques** de la zone).

### `GET /rules`

Liste les règles actives (`isActive: true`).

### `GET /rules/:id`

Détail d'une règle (active ou non).

### `POST /rules` 🔒

**Body (`CreateRuleDto`)**
```json
{
  "name": "Extinction climatiseur si surpuissance",
  "ruleType": "THRESHOLD",
  "conditions": { "type": "THRESHOLD", "field": "power", "operator": ">", "value": 2000 },
  "actions": [{ "type": "SWITCH_OFF", "targetId": "<circuitId>" }],
  "buildingId": "<uuid>"
}
```

`ruleType` ∈ `SCHEDULE | THRESHOLD | PRESENCE | EVENT | COMBINED`.

### `PATCH /rules/:id` 🔒

**Body (`UpdateRuleDto`)** : tous les champs de `CreateRuleDto`, optionnels
(y compris `isActive` via le modèle Prisma).

### `DELETE /rules/:id` 🔒

Désactive la règle (`isActive: false`) — suppression logique, pas de
suppression physique.

## 8. Audit (`/audit-logs`, `/audit`)

Point d'entrée unique de journalisation côté backend (`AuditService.log()`)
— toute action significative (connexion, commande, création de règle,
bascule simulateur, erreur API...) produit une entrée consultable ici, en
plus d'être affichée dans les logs backend.

### `GET /audit-logs` 🔒

**Query params** : `limit` (int, 1–100, défaut 50).

### `POST /audit/events` 🔒

Journalise un événement observable uniquement côté client (consultation
d'écran, etc.) — le frontend doit rester un client pur, toute action
visible passe par le backend.

**Body**
```json
{ "action": "SCREEN_VIEW", "metadata": { "screen": "Dashboard" } }
```

## 9. Codes d'erreur communs

| Code | Cas |
|---|---|
| `400 Bad Request` | Payload invalide (validation `class-validator`) |
| `401 Unauthorized` | Token JWT absent/invalide/expiré, ou identifiants invalides au login |
| `404 Not Found` | Ressource inexistante (bâtiment, zone, circuit, etc.) |
| `500 Internal Server Error` | Erreur serveur inattendue — journalisée automatiquement (`AllExceptionsFilter`, action `API_ERROR`) |
