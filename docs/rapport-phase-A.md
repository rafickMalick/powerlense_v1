# Rapport de fin de Phase A — Backend PowerLens

Date : 2026-06-11
Branche : `dev_gilles`

## 1. Résumé

La Phase A rendait le backend NestJS/Prisma/PostgreSQL totalement
fonctionnel et démontrable sans matériel ESP32 (simulateur MQTT inclus).
Toutes les étapes A0 à A11 du plan ont été réalisées. Le projet compile
(`npm run build`), passe le lint (`npm run lint` — 0 erreur) et les tests
(`npm run test`). Une vérification end-to-end manuelle a été effectuée :
seed, démarrage (`npm run start:dev`), appels REST, login JWT, publication
MQTT → persistance PostgreSQL → moteur de règles → commande MQTT.

## 2. Fichiers créés

### Modules
- `src/modules/buildings/` : `buildings.module.ts`, `buildings.controller.ts`,
  `buildings.service.ts`, `dto/update-building.dto.ts`,
  `dto/building-response.dto.ts`
- `src/modules/auth/` : `auth.module.ts`, `auth.controller.ts`,
  `auth.service.ts`, `dto/login.dto.ts`, `strategies/jwt.strategy.ts`,
  `guards/jwt-auth.guard.ts`
- `src/modules/measurements/` : `measurements.controller.ts`,
  `dto/measurements-query.dto.ts` (+ `measurements.module.ts` et
  `measurements.service.ts` complétés, fichiers existants mais vides)
- `src/modules/rules/dto/create-rule.dto.ts`, `dto/update-rule.dto.ts`
- `src/modules/rooms/dto/find-rooms-query.dto.ts`
- `src/realtime/` : `realtime.module.ts`, `realtime.gateway.ts`
  (WebSocket Gateway socket.io)
- `src/simulator/` : `simulator.module.ts`, `simulator.service.ts`
  (simulateur MQTT)

### Documentation
- `docs/rapport-phase-A.md` (ce document)

## 3. Fichiers modifiés (principaux)

- `package.json` / `package-lock.json` : ajout `@nestjs/jwt`,
  `@nestjs/passport`, `passport`, `passport-jwt`, `bcryptjs`,
  `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` (+ types) ;
  retrait de `@nestjs/typeorm`/`typeorm` (non utilisés).
- `.env` : ajout `MQTT_BROKER_URL`, `SIMULATOR_ENABLED`,
  `SIMULATOR_INTERVAL_MS`, `SEED_ADMIN_PASSWORD`.
- `src/app.module.ts` : `ConfigModule.forRoot({ isGlobal: true })` +
  enregistrement de tous les modules (Auth, Realtime, Mqtt, Rules, Rooms,
  Circuits, Buildings, Measurements, Simulator) + `AppController`/`AppService`.
- `src/main.ts` : `ValidationPipe` global (whitelist + transform), `enableCors()`.
- `src/modules/rooms/*`, `src/modules/circuits/*` : modularisation complète
  (controllers/providers/exports), DTOs de réponse/mise à jour, filtre
  `?buildingId=&floor=`, endpoints `channels`/`measurements`,
  activation/désactivation.
- `src/modules/rules/*` : `rules.module.ts` corrigé (controller/service
  enfin enregistrés — bug bloquant), `rules-engine.service.ts` typé
  (plus de `any`), cas `EVENT` ajouté, `PRESENCE` documenté.
- `src/mqtt/*` : nouveau contrat de topics (`measureTopic`, `commandTopic`,
  `ackTopic`, `eventTopic`, `parseTopic`), `MeasurementListener` réécrit
  (persistance + WebSocket + moteur de règles + acks).
- `prisma/seed.ts` : mot de passe admin haché via bcryptjs
  (`SEED_ADMIN_PASSWORD`, défaut `admin123`), adaptateur `PrismaPg` requis
  par Prisma 7.
- `src/utils/logger.ts` : typage strict du formatter winston.

## 4. Fichiers supprimés (A11 — dette technique)

- `src/database/` (entités TypeORM mortes + seeder vide, doublon de
  `prisma/seed.ts`)
- `src/config/app.config.ts`, `src/config/database.config.ts` (remplacés par
  `ConfigModule.forRoot`)
- `src/common/enums/circuit-status.enum.ts` (vide, redondant avec
  `isActive`/`DeviceStatus`)
- `src/modules/channels/`, `src/modules/commands/` (vides, jamais importés —
  `AuditLog` couvre l'historique des commandes, `CircuitsService.getChannels`
  fournit les métadonnées de canaux)

## 5. Décisions d'architecture

1. **Pas de migration Prisma initiale** : `prisma migrate status` indiquait
   "Database schema is up to date!" sans dossier `migrations/` — la base
   correspond déjà au schéma (probablement via `db push`). Décision : ne pas
   exécuter `migrate dev --name init` pour éviter un risque de
   drift-detection / reset sur une base existante. À surveiller si une
   vraie migration est nécessaire plus tard (premier `migrate dev` créera
   la baseline).
2. **Channels = métadonnées calculées** : conformément à la décision validée,
   pas de modèle `Channel` en base. `GET /circuits/:id/channels` retourne 4
   entrées (`VOLTAGE`, `CURRENT`, `POWER`, `ENERGY`) construites à la volée
   à partir du `Circuit`/`Device`/`Building` + `measureTopic()`.
3. **Contrat MQTT harmonisé** (abandon propre de `measurements/#`) :
   - Mesures : `powerlens/{buildingId}/{deviceId}/measure`
   - Commandes : `powerlens/{buildingId}/{deviceId}/command/{circuitId}`
   - Acks : `powerlens/{buildingId}/{deviceId}/ack/{circuitId}`
   - Événements : `powerlens/{buildingId}/{deviceId}/event`
   Pas de hardware en prod existant à préserver (projet en pré-démo).
4. **Authentification JWT minimale** : `POST /auth/login`, `GET /auth/me`.
   Toutes les routes `POST/PATCH/DELETE` (rules, circuits
   activate/deactivate/PATCH, buildings PATCH) sont protégées par
   `JwtAuthGuard`. Les `GET` restent publics pour la démo. Un `RolesGuard`
   plus fin (ADMIN vs USER) est documenté comme amélioration future, hors
   scope MVP.
5. **Mot de passe admin par défaut** : `admin@powerlens.local` /
   `admin123` (variable `SEED_ADMIN_PASSWORD`), haché en bcrypt dans le seed.
   **À changer avant toute mise en production.**
6. **PRESENCE** : reste `return false` (stub documenté). Conception future :
   fenêtre temporelle sur `EnergyMeasurement` via `$queryRaw`
   (`{ field, threshold, durationMinutes, expected: 'ABSENT'|'PRESENT' }`),
   nécessiterait de rendre `evaluateCondition` asynchrone. Pas de capteur de
   présence disponible actuellement.
7. **`EnergyMeasurement.id` (BigInt)** : non sérialisable nativement en JSON.
   `MeasurementsService` convertit `id` en `string` avant retour API
   (`serializeMeasurement`).
8. **JWT `expiresIn` typing (Prisma 7 / @nestjs/jwt)** : cast explicite vers
   `NonNullable<JwtModuleOptions['signOptions']>['expiresIn']` pour satisfaire
   le typage strict de `@nestjs/jwt` avec une valeur lue depuis `ConfigService`.
9. **Typage du moteur de règles** : `rules-engine.service.ts` et
   `rules.service.ts` ont été retypés (suppression des `any`) avec
   `MeasurementInput`, `RuleCondition` (union discriminée THRESHOLD / SCHEDULE
   / AND / OR / EVENT / PRESENCE), `CreateRuleDto`/`UpdateRuleDto`.

## 6. Vérification effectuée

- `npm run build` ✅ (0 erreur)
- `npm run lint` ✅ (0 erreur, 0 warning bloquant)
- `npm run test` ✅ (1/1)
- `npm run prisma:seed` ✅ (admin + bâtiment + 2 salles + device + 2 circuits
  + 2 mesures)
- `npm run start:dev` ✅ — toutes les routes mappées, connexion Prisma OK,
  connexion MQTT OK (Mosquitto local sur 1883)
- Tests REST manuels :
  - `GET /buildings`, `GET /rooms`, `GET /rooms/:id/circuits`,
    `GET /circuits/:id`, `GET /circuits/:id/channels`,
    `GET /circuits/:id/measurements` (+ `?granularity=day`),
    `GET /measurements?circuitId=...`, `GET /rules` ✅
  - `POST /auth/login` (admin@powerlens.local / admin123) → JWT ✅
  - `GET /auth/me` avec Bearer token ✅
  - `PATCH /circuits/:id/activate` / `deactivate` (401 sans token, 200 avec
    token, publication MQTT de la commande + AuditLog) ✅
- Test MQTT → DB : publication d'un message sur
  `powerlens/{buildingId}/ESP32-PL-001/measure` → nouvelle ligne
  `EnergyMeasurement` créée et visible via
  `GET /circuits/:id/measurements` ✅
- WebSocket : implémentation standard `@nestjs/websockets` + socket.io,
  émission vérifiée par lecture de code (`emitMeasurement` appelé dans
  `MeasurementListener.handleMeasurement`). Pas de test client socket.io
  exécuté (dépendance `socket.io-client` non installée côté projet — à
  ajouter côté `powerlens-mobile` en Phase B).

## 7. Points restants / TODO pour le Frontend (Phase B)

- **Auth** : stocker le JWT (expire en 15 min via `JWT_EXPIRES_IN`), prévoir
  un refresh ou re-login ; `REFRESH_SECRET`/`REFRESH_EXPIRES_IN` existent dans
  `.env` mais ne sont pas encore utilisés côté backend (pas de endpoint
  `/auth/refresh` — à ajouter si nécessaire, sinon documenter la limite des
  15 min côté mobile).
- **Channels** : `GET /circuits/:id/channels` retourne 4 entrées avec le même
  topic MQTT (`measure`) — c'est le topic du *device*, pas un topic par
  grandeur. Le frontend doit traiter `type`/`unit` comme métadonnées
  d'affichage, pas comme canaux MQTT distincts.
- **Equipment / Alert.type/origin/room / Building.status/maxPower** : ces
  champs n'existent pas dans le schéma Prisma actuel (cf. maquette Figma) —
  mapping à documenter dans `services/README.md` côté mobile avec
  `// TODO backend: ...`.
- **WebSocket** : événements `'measurement'`, `'alert'`, `'circuit:status'`
  diffusés en clair (CORS ouvert `*`), pas d'authentification sur le socket
  pour l'instant (acceptable pour la démo, à sécuriser si exposé publiquement).
- **Simulateur** : `SIMULATOR_ENABLED=false` par défaut. Pour une démo sans
  ESP32, mettre `SIMULATOR_ENABLED=true` dans `.env` et redémarrer le backend
  — publie des mesures réalistes toutes les `SIMULATOR_INTERVAL_MS` (5s par
  défaut) pour tous les circuits `isActive=true`.
- **Mot de passe admin** : `admin@powerlens.local` / `admin123` — à
  documenter dans `setup.md` (Phase C) et à changer en environnement réel.

## 8. Prochaine étape

Phase B — Frontend React Native (`powerlens-mobile/`), conversion de la
maquette Figma `Mobile Energy Monitoring App(2)/` selon le plan validé.
