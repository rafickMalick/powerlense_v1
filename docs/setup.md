# Setup & Run — PowerLens

---

## 0. Valeurs de configuration — À transmettre au hardware (ESP32)

> Ces valeurs sont issues de la base de données seedée. Les utiliser telles quelles dans le firmware.

### Réseau à jours

| Variable | Valeur |
|---|---|
| `WIFI_SSID` | `<À compléter — SSID du réseau local utilisé>` |
| `WIFI_PASS` | `<À compléter — mot de passe du réseau>` |
| `MQTT_HOST` | IP LAN du PC / Raspberry Pi hébergeant le broker (ex. `172.20.13.227`) — récupérer avec `ipconfig` sous Windows |
| `MQTT_PORT` | `1883` |

### Identifiants système (base de données SCOP)

Deux modules ESP32 physiques distincts, même bâtiment — chacun avec son propre `deviceUid` (voir CLAUDE.md §3 « Commandes » : le topic de commande est construit à partir du `deviceUid` **enregistré en base pour le circuit ciblé**, donc chaque circuit doit être rattaché au bon device pour que les commandes ON/OFF atteignent le bon module).

| Variable | Valeur seedée | Module physique |
|---|---|---|
| `deviceUid` / `DEVICE_ID` | `ESP32-PL-001` | Salle de Réunion (ROOM) + Bâtiment (départ général) |
| `deviceUid` / `DEVICE_ID` | `ESP32-PL-002` | Couloir Principal (CORRIDOR) |
| `BUILDING_ID` | `a91d4911-0651-4221-b8d3-7781de57e213` | Commun aux deux modules |

### Identifiants des circuits par zone

#### Salle de Réunion (ROOM — étage 1)

| Variable / Usage | `CIRCUIT_ID` | Type |
|---|---|---|
| Éclairage Salle de Réunion | `b528100e-78c5-4860-9e70-f610c7d835d9` | LIGHTING |
| Prises Salle de Réunion | `2bf8e37e-1598-4a72-b0a3-b237d4f5e33f` | SOCKET |
| Climatisation Salle de Réunion | `b2682c9b-0b83-4a0e-a98b-d1aac173695a` | HVAC |
| Brasseur Salle de Réunion | `f064ba71-68d8-4871-8572-573d9ed1f815` | FAN |

#### Open Space (ROOM — étage 2)

| Variable / Usage | `CIRCUIT_ID` | Type |
|---|---|---|
| Éclairage Open Space | `1fb82aaa-404e-49b6-bb9e-fe90496c450d` | LIGHTING |
| Prises Open Space | `76bb87f4-b079-4e7a-b529-ee2f09479cae` | SOCKET |
| Climatisation Open Space | `c9c39300-52fb-4796-bd9e-20e4cdf35496` | HVAC |
| Brasseur Open Space | `44aef2f7-584b-4dc0-9089-36c0c3b7d0e0` | FAN |

#### Couloir Principal (CORRIDOR — RDC)

| Variable / Usage | `CIRCUIT_ID` | Type |
|---|---|---|
| Éclairage Couloir Principal | `c43e036d-f74d-456a-8cfd-46cec4c83ef3` | LIGHTING |
| Prises Couloir Principal | `c5aeb7e1-fe1a-4fca-81af-ea65fad0d8c4` | SOCKET |

### Pins GPIO des relais (V8 — câblage réel confirmé)

⚠️ Pins non confirmées matériellement, à valider avant tout flashage (voir commentaires `⚠️` dans les `.ino`).

| Module | Charge | Pin |
|---|---|---|
| `code_salle.ino` (ESP32-PL-001) | Charge 1 — Éclairage Salle | 10 |
| | Charge 2 — Prises Salle | 11 |
| | Charge 3 — Climatisation Salle | 12 |
| | Charge 4 — Brasseur Salle | 13 |
| | PIR (présence, déplacé de la pin 10) | 14 |
| `code_couloir/code_couloir.ino` (ESP32-PL-002) | Charge 1 — Éclairage Couloir | 12 |
| | Charge 2 — Prises Couloir | 13 |
| | PIR (présence, inchangé) | 10 |

### Topic MQTT de publication des mesures

```
powerlens/a91d4911-0651-4221-b8d3-7781de57e213/ESP32-PL-001/measure
```

Inclure le `zoneId` approprié dans chaque payload JSON, et optionnellement un tableau `circuits` pour l'état des relais du module émetteur (voir [hardware.md](hardware.md) §5).

---

## 1. Prérequis

- Node.js 20+ (NestJS 11 / Expo 56)
- PostgreSQL accessible — port `5434` par défaut dans le `.env` de démo
- Broker MQTT Mosquitto — port `1883`
- npm

---

## 2. Démarrage rapide (tout relancer depuis zéro)

À exécuter depuis la **racine du dépôt** dans trois terminaux séparés, ou dans un terminal avec multiplexeur :

### Terminal 0 — Dépendances Docker (PostgreSQL + MQTT)

```bash
docker start powerlens-postgres powerlens-mqtt
```

> Conteneurs déjà créés au préalable (pas de `docker-compose.yml` dans le dépôt). S'ils n'existent pas encore, les recréer avec `docker run` (Postgres sur le port `5434`, Mosquitto sur `1883`).

### Terminal 1 — Backend NestJS

```bash
cd powerlens-backend
npm install                # uniquement si node_modules absent
npx prisma generate        # régénère le client Prisma (obligatoire après un npm install)
npx prisma migrate deploy  # applique les migrations en attente
npm run start:dev          # hot-reload, logs en console
```

Les logs en temps réel apparaissent dans le terminal **ET** dans `backend.log` à la racine du projet.

Vérifier que les lignes suivantes apparaissent :

```
[NestJS] Application is running on: http://[::1]:3000
MQTT connecté avec succès
Simulateur MQTT activé
PROVIDER_SWITCHED_TO_SIMULATOR   ← bascule automatique si pas d'ESP32
```

### Terminal 2 — Frontend Expo

```bash
cd powerlens-mobile
npm install          # uniquement si node_modules absent
npm run web          # ouvre http://localhost:8082
# ou : npm run start  (menu interactif Android/iOS/web)
```

Les logs Metro apparaissent dans le terminal **ET** dans `metro.log` à la racine.

### Terminal 3 — (optionnel) MQTT debug en temps réel

```bash
# Écouter TOUTES les mesures publiées (simulateur ou ESP32)
mosquitto_sub -h localhost -p 1883 -t "powerlens/#" -v

# Écouter uniquement les mesures du bâtiment SCOP
mosquitto_sub -h localhost -p 1883 \
  -t "powerlens/a91d4911-0651-4221-b8d3-7781de57e213/ESP32-PL-001/measure" -v

# Simuler un ESP32 (injecter une mesure manuellement — zoneId, pas circuitId, cf. mqtt.md)
mosquitto_pub -h localhost -p 1883 \
  -t "powerlens/a91d4911-0651-4221-b8d3-7781de57e213/ESP32-PL-001/measure" \
  -m '{"zoneId":"baf11948-4740-4d42-be62-f0d787bb8d5a","voltage":221.3,"current":3.81,"power":843.6,"energyKwh":1.24,"measuredAt":"2026-07-01T10:00:00.000Z","frequency":50.02,"powerFactor":0.98,"presence":true,"temperature":27.5,"circuits":[{"circuitId":"b528100e-78c5-4860-9e70-f610c7d835d9","isActive":true}]}'
```

---

## 3. Voir les logs

### Logs backend (NestJS)

```bash
# Suivre en temps réel
Get-Content backend.log -Wait          # PowerShell (Windows)
tail -f backend.log                    # bash / Git Bash

# Dernières 50 lignes
Get-Content backend.log -Tail 50       # PowerShell
tail -50 backend.log                   # bash

# Filtrer par mot-clé
Select-String "MQTT|SIMULATOR|PROVIDER|ERROR" backend.log    # PowerShell
grep -E "MQTT|SIMULATOR|PROVIDER|ERROR" backend.log          # bash
```

### Logs frontend (Metro / Expo)

```bash
Get-Content metro.log -Wait            # PowerShell
tail -f metro.log                      # bash
```

### Logs PostgreSQL (Docker ou service Windows)

```bash
# Si PostgreSQL tourne en Docker
docker logs -f <nom_du_container_postgres>

# Vérifier que la DB répond
npx prisma db execute --stdin <<< "SELECT version();"   # depuis powerlens-backend/
```

### Logs MQTT broker (Mosquitto)

```bash
# Emplacement typique Windows
Get-Content "C:\Program Files\mosquitto\mosquitto.log" -Wait

# Ou activer les logs dans mosquitto.conf :
# log_dest file C:\Program Files\mosquitto\mosquitto.log
# log_type all
```

---

## 4. Commandes utiles (maintenance courante)

### Base de données

```bash
cd powerlens-backend

# Appliquer les migrations Prisma
npm run prisma:migrate

# Régénérer le client Prisma après modification du schéma
npm run prisma:generate

# Re-seeder (idempotent — ajoute uniquement les données manquantes)
npm run prisma:seed

# Ouvrir Prisma Studio (UI de la DB)
npx prisma studio
```

### Vérifications TypeScript

```bash
# Backend
cd powerlens-backend && npx tsc --noEmit

# Frontend
cd powerlens-mobile && npx tsc --noEmit
```

### Smoke test API

```bash
# Depuis Git Bash ou PowerShell avec curl
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@powerlens.local","password":"admin123"}' | jq .

# Lister les bâtiments (remplacer <TOKEN> par le access_token reçu)
curl -s http://localhost:3000/buildings \
  -H "Authorization: Bearer <TOKEN>" | jq .

# Lister les zones du bâtiment SCOP
curl -s "http://localhost:3000/zones?buildingId=a91d4911-0651-4221-b8d3-7781de57e213" \
  -H "Authorization: Bearer <TOKEN>" | jq '.[].name'
```

### Facturation (tarif SBEE progressif)

```bash
# Tarif actif du bâtiment
curl -s "http://localhost:3000/billing/tariff?buildingId=<BUILDING_ID>" -H "Authorization: Bearer <TOKEN>" | jq .

# Estimation en direct du mois en cours (kWh, coût, prix marginal actuel)
curl -s "http://localhost:3000/billing/current?buildingId=<BUILDING_ID>" -H "Authorization: Bearer <TOKEN>" | jq .

# Historique des factures mensuelles générées
curl -s "http://localhost:3000/billing/history?buildingId=<BUILDING_ID>" -H "Authorization: Bearer <TOKEN>" | jq .

# Déclencher manuellement la génération d'une facture (rôle ADMIN/SUPER_ADMIN requis)
curl -s -X POST http://localhost:3000/billing/generate \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"buildingId":"<BUILDING_ID>"}' | jq .
```

Le prix par kWh augmente en continu avec la consommation cumulée du mois (`prix marginal = pricePerKwhFcfa + growthCoefficientFcfa × kWh`), tarif par défaut seedé : SBEE BT2 Professionnel, 111 FCFA/kWh + 0.01 FCFA/kWh². Une facture mensuelle est aussi générée automatiquement (cron, voir §5).

---

## 5. Variables d'environnement

### Backend — `powerlens-backend/.env`

| Variable | Valeur démo | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:1234@localhost:5434/powerlens?schema=public` | Connexion PostgreSQL |
| `JWT_SECRET` | `gilles` | Clé JWT access token |
| `JWT_EXPIRES_IN` | `15m` | Durée access token |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | URL broker MQTT |
| `SIMULATOR_ENABLED` | `true` | Désactivé automatiquement dès qu'un ESP32 est détecté |
| `SIMULATOR_INTERVAL_MS` | `2000` | Intervalle de publication simulateur |
| `ESP_TIMEOUT_MS` | `30000` | Délai sans ESP avant activation simulateur |
| `ESP_STARTUP_WAIT_MS` | `15000` | Délai d'attente ESP au démarrage |
| `SUPERVISOR_ENABLED` | `false` | IA d'analyse — activer manuellement en démo avancée |
| `PORT` | `3000` | Port HTTP/WebSocket |
| `SEED_ADMIN_PASSWORD` | `admin123` | Mot de passe admin seed |
| `BILLING_ENABLED` | `false` | Génération automatique de la facture mensuelle (cron) — activer en démo avancée |
| `BILLING_CRON` | `0 0 1 * *` (1er du mois, minuit) | Expression cron du job de facturation — optionnel, valeur par défaut déjà correcte |

### Frontend — `powerlens-mobile/.env`

| Variable | Valeur démo | Description |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` | URL backend (remplacer par IP LAN sur téléphone physique) |
| `EXPO_PUBLIC_USE_MOCKS` | `false` | `true` = données mockées côté app, sans appel au backend (voir `src/services/README.md`) |

#### Sur téléphone physique (même réseau Wi-Fi)

1. Récupérer l'IP LAN du PC hébergeant le backend :
   ```
   ipconfig → Adresse IPv4 carte Wi-Fi (ex. 172.20.13.227)
   ```
2. `powerlens-mobile/.env` :
   ```
   EXPO_PUBLIC_API_URL=http://172.20.13.227:3000
   ```
3. Démarrer l'app avec `npm run start` et scanner le QR code avec **Expo Go**.

---

## 6. État seedé (bâtiment SCOP)

Après `npm run prisma:seed`, la base contient :

| Élément | Valeur |
|---|---|
| Bâtiment | **SCOP** — Cotonou |
| Device | `ESP32-PL-001` |
| Salles | Salle de Réunion (étage 1), Open Space (étage 2) |
| Couloir | Couloir Principal (RDC) |
| Circuits | 10 au total (4 par salle, 2 sur le couloir) |
| Mesures historiques | ≈ 30 jours × 48 points × 10 circuits |
| Règles actives | 3 (surcharge nocturne, extinction éclairage 19h30, seuil conso HVAC) |
| Tarif de facturation | SBEE BT2 Professionnel, 111 FCFA/kWh (+0.01 FCFA/kWh² progressif), assigné au bâtiment SCOP |
| Utilisateur admin | `admin@powerlens.local` / `admin123` |

---

## 7. Jumeau numérique 3D (écran "Jumeau")

- **Puissance et présence par salle** : lues en direct depuis `EnergyMeasurement` (`power`, `presence`) — les `zoneId` des salles sont résolus dynamiquement au chargement (comme le couloir), pas codés en dur, pour rester valides même après un reseed qui régénère les UUID de zone.
- **Figurine humaine** : une silhouette apparaît dans une salle dès que sa dernière mesure a `presence: true`, et disparaît sinon.
- **Visite guidée** : bouton "🎬 Lancer la visite guidée" sous le canevas 3D — anime la caméra à travers le couloir et dans chaque salle (parcours scripté, ~15 s), avec un badge indiquant la zone traversée. Fonctionnalité 100 % frontend (`TwinScreen.web.tsx`), aucune donnée backend dédiée.

---

## 8. Bascule automatique Simulateur ↔ ESP32

Le `ProviderSwitcherService` gère la bascule sans redémarrage :

| Situation | Comportement |
|---|---|
| Démarrage sans ESP32 | Après 15 s, simulateur activé automatiquement |
| ESP32 connecté et actif | Simulateur arrêté, données réelles utilisées |
| ESP32 absent > 30 s | Simulateur réactivé automatiquement |

L'application mobile affiche un badge **"Simulation"** (orange) dans le Header tant que le simulateur est actif.

Pour forcer le mode ESP32 en test, publier manuellement un message MQTT sans le champ `_sim` (voir Terminal 3 ci-dessus).

---

## 9. Identifiants par défaut (développement uniquement)

| Email | Mot de passe | Rôle |
|---|---|---|
| `admin@powerlens.local` | `admin123` | `ADMIN` |

> ⚠️ Changer `JWT_SECRET`, `SEED_ADMIN_PASSWORD` et les credentials PostgreSQL avant tout déploiement réel.

---

## 10. Dépannage (erreurs déjà rencontrées)

### `Argument "url" is missing in data source block "db"` (Prisma)

La CLI `prisma` et `@prisma/client` doivent être sur la **même version majeure** (`powerlens-backend/package.json`). Si un `npm install` a mis à jour l'un sans l'autre, la config de `prisma.config.ts` (bloc `datasource.url`) est ignorée silencieusement par une CLI trop ancienne. Vérifier :

```bash
npx prisma --version   # la ligne "prisma" et "@prisma/client" doivent matcher
```

### `No driver (HTTP) has been selected` au démarrage du backend

Signe d'un mélange de versions NestJS dans `package.json` (ex. `@nestjs/core` en v7 pendant que `@nestjs/common`/`platform-express` sont en v11). Toutes les libs `@nestjs/*` (dont `platform-socket.io`, `websockets`, `schedule`, `testing`) doivent être sur la **même version majeure**.

### `Cannot find module './config/...'` ou erreurs `MODULE_NOT_FOUND` juste après compilation

Build incrémental corrompu (fréquent sur un dépôt monté depuis Windows via `/mnt/c`, I/O lente sous WSL). Solution : `rm -rf dist` puis relancer `npm run start:dev`.

### Page web Expo blanche

Ouvrir la console du bundler (pas juste le navigateur) : Metro renvoie l'erreur de bundling en HTTP 500 sur l'URL du bundle JS. Cause fréquente : dépendance utilisée dans le code (ex. `three` pour l'écran Digital Twin) absente de `node_modules`/`package.json`. Après un `npm install <pkg>` pendant que Metro tourne déjà, **redémarrer** le serveur Expo (`--clear` pour vider le cache) : Metro ne détecte pas les nouveaux packages ajoutés en cours de route.

### Erreurs TS7016 rouges dans l'éditeur sur `TwinScreen.web.tsx` (`three`, `three/examples/jsm/...`)

`three` ne fournit pas ses types dans le package principal utilisé ici : installer `@types/three` en devDependency.

```bash
cd powerlens-mobile && npm install --save-dev @types/three
```

### Port déjà utilisé (`3000`, `8081`)

Vérifier qu'une autre copie du dépôt ne tourne pas déjà (ex. un clone WSL natif en parallèle de celui sous `/mnt/c`, plus rapide à builder) :

```bash
ss -ltnp | grep -E ':3000|:8081'
```

Si occupé par un processus légitime, utiliser un port alternatif : `PORT=3001 npm run start:dev` ou `npx expo start --web --port 8082`.

### `Cannot find module '<package>'` après un `git pull`

Le `package.json` pulled peut déclarer de nouvelles dépendances (ex. `@expo-google-fonts/inter`, `expo-haptics`) pas encore présentes dans `node_modules`. Après **chaque** `git pull` touchant un `package.json` ou `package-lock.json`, relancer `npm install` dans le dossier concerné (`powerlens-backend` et/ou `powerlens-mobile`), même si `node_modules` existe déjà — puis `npx tsc --noEmit` pour confirmer.

### Après un `git pull`, toujours revérifier les migrations

```bash
cd powerlens-backend
npx prisma migrate status    # "Database schema is up to date!" attendu
npx prisma migrate deploy    # applique toute migration en attente (no-op sinon)
npx prisma generate          # régénère le client si le schéma a changé
```

### Fichiers non trackés qui bloquent un `git pull` (« would be overwritten by merge »)

Signe que le code distant a ajouté des fichiers aux mêmes chemins que du travail local non commité — souvent deux personnes (ou deux sessions) ayant construit la même fonctionnalité en parallèle. Ne pas stash/écraser à l'aveugle : `git show <commit>:<chemin>` pour comparer les deux versions avant de choisir laquelle garder (elles peuvent consommer les mêmes endpoints backend sans être identiques).
