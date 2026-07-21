# PowerLens — Database Schema (V4)

## Overview

PostgreSQL managed via Prisma ORM. Four migrations applied:

| Migration | Description |
|---|---|
| `20260121170415_init` | V1: Building, Room, Device, Circuit, EnergyMeasurement, Rule, Alert, AuditLog |
| `20260614201446_v2_smart_supervisor` | V2: RuleRecommendation, SupervisorRun, Circuit.isCritical, Alert/AuditLog indexes |
| `20260630213447_v3_zone_hierarchy` | V3: MonitoringZone, Channel, ZoneType/CircuitType enums, EnergyMeasurement extended |
| `20260701140458_v4_zone_measurements` | V4: mesures rattachées à la ZONE plutôt qu'au circuit, `Building.powerStatus` |

## V4 — Mesures par zone, plus par circuit

Le matériel réel ne peut instrumenter chaque circuit individuellement : un
module ESP32 mesure l'arrivée électrique globale d'une zone (Salle, Couloir,
ou le départ général du Bâtiment), pas chaque circuit séparément. Les
circuits restent commandables (ON/OFF) mais ne portent plus leur propre
mesure.

- `EnergyMeasurement.zoneId` (nullable, FK → `MonitoringZone`) devient la
  colonne d'attache des nouvelles mesures. `circuitId` est conservé
  **nullable** (au lieu de `NOT NULL`) uniquement pour l'historique
  pré-V4 — jamais alimenté par les nouvelles mesures.
- `Channel.zoneId` suit le même principe : catalogue de canaux disponibles
  par **zone** (matrice ci-dessous), `circuitId` conservé nullable pour
  compatibilité historique.
- `Building.powerStatus` (`POWERED | LIMITED | CUTOFF`, défaut `POWERED`)
  — état d'alimentation persisté, modifié uniquement via
  `PATCH /buildings/:id/power-status` (Centre de contrôle).
- **Zones `BUILDING`** : mesurées par un module dédié posé sur le départ
  général **si un tel module est déployé** (ou simulées comme telles, cf.
  [mqtt.md](mqtt.md) §4). Tant qu'aucune mesure directe n'existe pour cette
  zone, le backend calcule une valeur de repli par agrégation en lecture
  (somme/moyenne des zones `ROOM`/`CORRIDOR` du même bâtiment par bucket
  temporel) — `MeasurementsService.findByZone` vérifie l'existence d'une
  mesure directe (`EnergyMeasurement.findFirst`) et bascule automatiquement
  dès qu'elle apparaît, sans distinction de code entre "vrai capteur" et
  "valeur calculée" côté frontend.

### Matrice des mesures par type de zone

| Champ | ROOM | CORRIDOR | BUILDING |
|---|---|---|---|
| voltage / current / power / energyKwh / frequency / powerFactor | ✔ | ✔ | ✔ *(direct si un module départ général existe, sinon agrégé)* |
| luminosity | ✔ | ✔ | — |
| presence | ✔ | ✔ | — |
| temperature | ✔ | — | — |

### Stratégie de migration (backfill, sans perte de données)

1. Ajout de `EnergyMeasurement.zoneId` / `Channel.zoneId` (nullable) et
   passage de `circuitId` à nullable sur les deux tables.
2. Backfill SQL : `UPDATE ... SET zoneId = (SELECT zoneId FROM Circuit
   WHERE Circuit.id = circuitId)` — chaque ligne historique récupère la
   zone de son ancien circuit, `circuitId` reste renseigné pour traçabilité.
3. `prisma/seed.ts` purge ensuite les anciens canaux hérités par circuit
   (`Channel.circuitId IS NOT NULL`) et sème un catalogue propre par zone
   (fonction idempotente `ensureZoneChannels`).
4. Index `@@index([zoneId, measuredAt])` ajouté en complément de l'ancien
   `@@index([circuitId, measuredAt])` (conservé, lecture historique).

Aucune ligne `EnergyMeasurement`/`Channel` existante n'est supprimée.

## Zone Hierarchy

```
Building
  └── MonitoringZone (type = BUILDING)  ← circuits globaux du bâtiment
  └── MonitoringZone (type = CORRIDOR)  ← circuits LIGHTING + SOCKET uniquement
  └── MonitoringZone (type = ROOM)      ← tous types + température autorisée
        └── MonitoringZone (type = ROOM, parentId = corridor.id) [optionnel]
```

`parentId` auto-référentiel permet de nicher une salle dans un couloir si l'architecture le demande ; `parentId = null` signifie que la zone est directement rattachée au bâtiment via `buildingId`.

## Models

### MonitoringZone

| Champ | Type | Contrainte |
|---|---|---|
| id | TEXT (uuid) | PK |
| name | TEXT | NOT NULL |
| type | ZoneType | NOT NULL — BUILDING | CORRIDOR | ROOM |
| floor | INTEGER | nullable |
| buildingId | TEXT | FK → Building.id |
| parentId | TEXT | FK → MonitoringZone.id (nullable) |
| createdAt | TIMESTAMP | default now() |

### Circuit

| Champ | Type | Contrainte |
|---|---|---|
| id | TEXT (uuid) | PK |
| name | TEXT | NOT NULL |
| type | CircuitType | NOT NULL — LIGHTING | SOCKET | HVAC | FAN |
| maxPowerWatt | INTEGER | nullable |
| isActive | BOOLEAN | default true |
| isCritical | BOOLEAN | default false |
| deviceId | TEXT | FK → Device.id |
| zoneId | TEXT | FK → MonitoringZone.id — **NOT NULL** |

**Rule**: Les zones CORRIDOR ne peuvent accueillir que des circuits `LIGHTING` et `SOCKET` — cette contrainte est imposée par le seeder et le simulateur ; le backend ne la valide pas au niveau SQL pour rester extensible.

### Channel

Catalogue de canaux de mesure **par zone** depuis V4 (matrice §"Mesures par zone" plus haut). Une ligne = un type de mesure disponible sur cette zone.

| Champ | Type | Contrainte |
|---|---|---|
| id | TEXT (uuid) | PK |
| type | TEXT | NOT NULL — ex: voltage, current, power, energy, frequency, powerFactor, luminosity, presence, temperature |
| unit | TEXT | NOT NULL |
| mqttTopic | TEXT | nullable |
| zoneId | TEXT | FK → MonitoringZone.id, nullable |
| circuitId | TEXT | FK → Circuit.id, nullable — **legacy pré-V4 uniquement** |
| createdAt | TIMESTAMP | default now() |

**temperature** n'est créé que pour les zones `ROOM` ; **luminosity**/**presence** pour `ROOM` et `CORRIDOR`. L'ingestion MQTT garantit que ces valeurs ne sont jamais stockées dans `EnergyMeasurement` pour un type de zone qui ne les supporte pas (drop + warn log).

### EnergyMeasurement

| Champ | Type | Contrainte |
|---|---|---|
| id | BIGSERIAL | PK |
| voltage | FLOAT | nullable |
| current | FLOAT | nullable |
| power | FLOAT | nullable |
| energyKwh | FLOAT | nullable |
| frequency | FLOAT | nullable — Hz |
| powerFactor | FLOAT | nullable — 0..1 |
| luminosity | FLOAT | nullable — lux (zones ROOM/CORRIDOR) |
| presence | BOOLEAN | nullable — zones ROOM/CORRIDOR |
| temperature | FLOAT | nullable — **zones ROOM uniquement** |
| measuredAt | TIMESTAMP | NOT NULL |
| zoneId | TEXT | FK → MonitoringZone.id, nullable — colonne d'attache depuis V4 |
| circuitId | TEXT | FK → Circuit.id, nullable — **legacy pré-V4 uniquement**, jamais alimenté par les nouvelles mesures |

Index: `(zoneId, measuredAt)` (V4) et `(circuitId, measuredAt)` (conservé pour l'historique).

## Migration V3 — Stratégie de préservation des données

La migration `20260630213447_v3_zone_hierarchy` est destructive sur deux points :

1. **DROP COLUMN Circuit.roomId** — toutes les valeurs ont été copiées dans `Circuit.zoneId` (qui pointe vers le même ID de zone que l'ancien Room ID, grâce à l'étape de migration qui préserve les IDs).
2. **DROP TABLE Room** — toutes les lignes ont été migrées vers `MonitoringZone` avec les mêmes IDs (`INSERT INTO MonitoringZone SELECT id, name, 'ROOM', floor, buildingId FROM Room`), donc aucune donnée n'est perdue.

Les circuits qui n'avaient pas de `roomId` (circuits niveau bâtiment) ont été rattachés à une zone synthétique `BUILDING` créée automatiquement pour chaque bâtiment existant, avec comme ID un nouveau UUID.
