# Audit technique PowerLens V1 — pré-production (bâtiments publics)

**Date :** 2026-06-14
**Périmètre analysé :** `powerlens-backend/` (NestJS, Prisma/PostgreSQL, MQTT, WebSocket) et `powerlens-mobile/` (React Native, Zustand, socket.io-client, axios).
**Méthodologie :** revue de code ciblée (modules, controllers, guards, DTO, services MQTT/WebSocket, moteur de règles, schéma Prisma et migrations, stores et services mobile), vérification directe fichier par fichier (aucune extrapolation). Référentiel: `CLAUDE.md` (architecture temps réel ESP32 → MQTT → NestJS → WebSocket → React Native, single point of truth = API NestJS).

**Fichiers/modules couverts :**
- Backend : `app.module.ts`, `main.ts`, `modules/auth/*`, `modules/buildings/*`, `modules/rooms/*`, `modules/circuits/*`, `modules/measurements/*`, `modules/rules/*`, `mqtt/*`, `realtime/realtime.gateway.ts`, `simulator/simulator.service.ts`, `prisma/schema.prisma`, `prisma/migrations/20260121170415_init/migration.sql`, `prisma/seed.ts`, `.env`, `package.json`.
- Mobile : `src/store/*`, `src/services/api.ts`, `src/services/websocket.ts`, `src/services/auth.ts`, `src/screens/*` (Dashboard, RoomDetail, Reports, Login, Alerts), `src/types/models.ts`, `.env`.

---

## PILIER 1 — SÉCURITÉ & INTÉGRITÉ

### 1.1 WebSocket sans authentification et CORS ouvert

**Sévérité : Critique**

**Description :** `powerlens-backend/src/realtime/realtime.gateway.ts:12` déclare `@WebSocketGateway({ cors: { origin: '*' } })` sans `handleConnection`/`handleDisconnect` ni vérification de JWT. N'importe quel client (navigateur, script) peut ouvrir une connexion socket.io vers l'API et recevoir en temps réel `measurement`, `alert` et `circuit:status` de **tous les bâtiments**, sans authentification ni filtrage. Le client mobile lui-même se connecte sans token (`websocket.ts`, commentaire "Pas d'authentification sur le socket pour l'instant").

**Proposition de correction :**
- Fichiers : `realtime/realtime.gateway.ts`, `mqtt/services/measurement.listener.ts` (appels `emitMeasurement`/`emitAlert`/`emitCircuitStatus`), `powerlens-mobile/src/services/websocket.ts`.
- Approche : valider le JWT à la connexion (`handshake.auth.token` ou query param), restreindre `cors.origin` à `CORS_ORIGINS`, et regrouper les clients par "room" socket.io (`socket.join(buildingId)`) pour ne diffuser que les données des bâtiments auxquels l'utilisateur a accès. Émettre via `this.server.to(buildingId).emit(...)` au lieu de `this.server.emit(...)`.

```typescript
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGINS?.split(',') ?? false } })
export class RealtimeGateway {
  @WebSocketServer() server: Server;

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    const payload = token && this.jwtService.verifyToken(token); // réutiliser JwtService
    if (!payload) { client.disconnect(); return; }
    // rejoindre les rooms des bâtiments accessibles à l'utilisateur
    client.data.user = payload;
  }

  emitMeasurement(buildingId: string, payload: unknown) {
    this.server?.to(buildingId).emit('measurement', payload);
  }
}
```

**Impact métier :**
- Sécurité : fuite de données de consommation énergétique de tous les bâtiments publics à toute personne connaissant l'URL de l'API (reconnaissance d'usage, présence/absence, habitudes).
- Exploitation : aucune isolation multi-bâtiment, incompatible avec un modèle multi-client/multi-site.

---

### 1.2 Endpoints de lecture exposés sans authentification

**Sévérité : Critique**

**Description :** Plusieurs routes REST renvoient des données métier sans `@UseGuards(JwtAuthGuard)` :
- `buildings.controller.ts` : `GET /buildings`, `GET /buildings/:id`
- `rooms.controller.ts` : `GET /rooms`, `GET /rooms/:id/circuits`, `GET /rooms/:id/measurements` (aucune route protégée dans ce contrôleur)
- `circuits.controller.ts` : `GET /circuits/:id`, `GET /circuits/:id/channels`, `GET /circuits/:id/measurements`
- `measurements.controller.ts` : `GET /measurements`

Seules les mutations (`PATCH`, `activate`/`deactivate`) sont protégées. En clair, n'importe qui peut consulter la liste des bâtiments, leurs salles, leurs circuits et l'historique de consommation, sans compte.

**Proposition de correction :**
- Fichiers concernés : les 4 contrôleurs ci-dessus.
- Approche recommandée : activer un `JwtAuthGuard` global dans `app.module.ts` (`APP_GUARD`) et exposer un décorateur `@Public()` pour les seules routes réellement publiques (`POST /auth/login`). Plus sûr qu'ajouter `@UseGuards` route par route (oubli possible sur de futurs endpoints).

```typescript
// auth/decorators/public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// app.module.ts
{ provide: APP_GUARD, useClass: JwtAuthGuard }

// jwt-auth.guard.ts
canActivate(context: ExecutionContext) {
  const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    context.getHandler(), context.getClass(),
  ]);
  if (isPublic) return true;
  return super.canActivate(context);
}
```

**Impact métier :**
- Sécurité : exposition de la topologie complète des bâtiments (sites, salles, équipements) et de l'historique de consommation — information sensible pour des bâtiments publics (sécurité physique, RGPD si lié à des usages de salles nominatives).
- Conformité : un audit de sécurité externe classerait probablement ce point comme bloquant pour toute mise en production.

---

### 1.3 Absence totale de contrôle d'accès basé sur les rôles (RBAC)

**Sévérité : Critique**

**Description :** Le modèle `User.role` (`prisma/schema.prisma`) définit `SUPER_ADMIN | ADMIN | MANAGER | VIEWER`, et le JWT contient `role` (`auth.service.ts`, payload `{ sub, email, role }`). Cependant, aucun `RolesGuard` ni décorateur `@Roles()` n'existe (seul `guards/jwt-auth.guard.ts` est présent dans `modules/auth/guards/`). Conséquence : tout utilisateur authentifié — y compris un compte `VIEWER` — peut :
- créer/modifier/désactiver des règles (`rules.controller.ts`, toutes les routes sous `@UseGuards(JwtAuthGuard)` uniquement),
- activer/désactiver des circuits (`circuits.controller.ts` `PATCH :id/activate|deactivate`),
- modifier un bâtiment (`buildings.controller.ts` `PATCH :id`).

**Proposition de correction :**
- Fichiers : créer `modules/auth/guards/roles.guard.ts` + `modules/auth/decorators/roles.decorator.ts`, puis annoter les mutations sensibles.
- Approche : `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)` sur `circuits.controller.ts` (`activate`/`deactivate`/`update`), `rules.controller.ts` (toutes les mutations), `buildings.controller.ts` (`update`).

```typescript
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
@Patch(':id/activate')
activate(@Param('id') id: string) { ... }
```

**Impact métier :**
- Sécurité/exploitation : dans un bâtiment public, un compte de consultation (ex. agent d'accueil) compromis ou mal attribué pourrait couper l'alimentation de circuits (éclairage, chauffage, équipements de sécurité) ou désactiver des règles de protection contre la surconsommation.
- Fiabilité : aucune granularité de permission ne peut être communiquée aux exploitants alors que le modèle de données le promet (4 rôles définis mais inertes).

---

### 1.4 Secrets faibles utilisés par défaut

**Sévérité : Haute**

**Description :** `powerlens-backend/.env` (non versionné — confirmé via `git check-ignore`, donc pas de fuite git) contient :
```
JWT_SECRET=gilles
REFRESH_SECRET=000000
SEED_ADMIN_PASSWORD=admin123
DATABASE_URL=postgresql://postgres:1234@localhost:5434/powerlens?schema=public
```
Le `REFRESH_SECRET`/`REFRESH_EXPIRES_IN` ne sont utilisés par aucun code (pas de mécanisme de refresh token implémenté) — configuration morte qui laisse croire à une fonctionnalité existante. Le `JWT_SECRET="gilles"` est trivialement devinable ; s'il est recopié tel quel en environnement de production (pratique courante par "copier le .env de dev"), un attaquant connaissant ce nom pourrait forger des tokens valides.

**Proposition de correction :**
- Fichiers : `.env` (prod), `docs/deploiement-production.md`.
- Approche : ajouter une checklist de déploiement imposant `JWT_SECRET`/`DATABASE_URL` générés aléatoirement (`openssl rand -hex 32`), gérés via un secrets manager (Vault, AWS Secrets Manager, ou variables d'environnement injectées par l'orchestrateur) et jamais identiques entre dev/staging/prod. Supprimer `REFRESH_SECRET`/`REFRESH_EXPIRES_IN` du `.env` si le refresh token n'est pas planifié, ou l'implémenter (cf. 2.3).

**Impact métier :**
- Sécurité : usurpation d'identité / élévation de privilèges si un secret de dev est réutilisé en production.
- Exploitation : pas de procédure documentée de rotation de secrets.

---

### 1.5 Aucune protection brute-force sur `/auth/login`

**Sévérité : Haute**

**Description :** `package.json` ne référence aucune dépendance `@nestjs/throttler` (vérifié), et `main.ts` n'enregistre aucun guard de limitation de débit. `auth.controller.ts` `POST /auth/login` est donc soumis à un nombre illimité de tentatives par seconde — aucun verrouillage de compte après échecs répétés.

**Proposition de correction :**
- Fichiers : `package.json` (ajout `@nestjs/throttler`), `app.module.ts`, `modules/auth/auth.controller.ts`.
- Approche :

```typescript
// app.module.ts
ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
{ provide: APP_GUARD, useClass: ThrottlerGuard },

// auth.controller.ts
@Throttle({ default: { limit: 5, ttl: 60000 } })
@Post('login')
login(@Body() dto: LoginDto) { ... }
```

**Impact métier :**
- Sécurité : un attaquant peut tenter un brute-force sur les comptes (notamment `admin@powerlens.local`, identifiant pré-rempli côté mobile) sans aucune friction.

---

### 1.6 Absence de Helmet / en-têtes de sécurité HTTP

**Sévérité : Moyenne**

**Description :** `main.ts` ne configure ni `helmet()` ni d'en-têtes de sécurité (CSP, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security). `package.json` ne référence pas `helmet`.

**Proposition de correction :**
- Fichiers : `package.json`, `main.ts`.
```typescript
import helmet from 'helmet';
app.use(helmet());
```

**Impact métier :**
- Sécurité : surface d'attaque accrue côté navigateur (clickjacking, MIME sniffing) si une interface web d'administration est exposée en plus de l'app mobile.

---

### 1.7 Payload d'acquittement MQTT (ACK) non validé par schéma

**Sévérité : Moyenne**

**Description :** Dans `mqtt/services/measurement.listener.ts` (lignes 92-126), le flux ACK fait :
```typescript
const payload = JSON.parse(message.toString()) as AckPayload;
...
const circuit = await this.prisma.circuit.update({
  where: { id: circuitId },
  data: { isActive: payload.status === 'SUCCESS' ? false : undefined },
});
```
Contrairement au flux de mesure (`MeasurementPayloadDto` + `class-validator`, lignes 133-138), le payload ACK n'est validé par aucun DTO : `payload.status` est un `string | undefined` non contraint. Un message MQTT malformé sur le topic `powerlens/+/+/ack/+` (ex. publié par erreur par un device en cours de mise au point) modifierait silencieusement l'état `isActive` d'un circuit en base et le diffuserait via `emitCircuitStatus`.

**Proposition de correction :**
- Fichiers : `mqtt/dto/ack-payload.dto.ts` (nouveau), `mqtt/services/measurement.listener.ts`.
- Approche : créer un `AckPayloadDto` avec `@IsIn(['SUCCESS', 'FAILED'])` sur `status` et `@IsString() @IsOptional()` sur `correlationId`, valider avant la mise à jour Prisma, logguer + ignorer si invalide (même pattern que `handleMeasurement`).

**Impact métier :**
- Fiabilité : un état de circuit erroné peut être reflété côté mobile (toggle visuellement "éteint" alors que l'équipement est toujours alimenté), avec un risque de confusion opérationnelle dans un bâtiment public.

---

## PILIER 2 — FIABILITÉ & ROBUSTESSE

### 2.1 État du moteur de règles conservé en mémoire (non partagé, non persistant)

**Sévérité : Haute**

**Description :** `modules/rules/rules-engine.service.ts:59-61` :
```typescript
// Stockage en mémoire (à migrer vers Redis pour la prod)
private ruleStates = new Map<string, boolean>();
private cooldowns = new Map<string, number>();
private COOLDOWN_MS = 30000;
```
`ruleStates` (anti-répétition front montant/descendant) et `cooldowns` (anti-spam 30s) sont des `Map` en mémoire de processus. Le commentaire du code lui-même indique que ceci doit être migré vers Redis avant la production. Conséquences :
- Redémarrage de l'API NestJS → perte de l'historique d'état des règles → une règle déjà "déclenchée" peut se redéclencher immédiatement (perte de l'hystérésis).
- Déploiement multi-instance (scalabilité horizontale, cf. pilier 3) → chaque instance a son propre état, donc une même règle peut déclencher des actions (ex. `SWITCH_OFF`) en double depuis plusieurs instances simultanément, et le cooldown de 30s n'est pas partagé.

**Proposition de correction :**
- Fichiers : `modules/rules/rules-engine.service.ts`, `app.module.ts` (ajout `ioredis`/`@nestjs/cache-manager` + Redis store).
- Approche : remplacer les deux `Map` par des opérations Redis (`GET`/`SET` avec `EX` pour le cooldown, `SET`/`GET` pour `ruleStates`), idéalement via des commandes atomiques (`SET key val NX EX 30`).

**Impact métier :**
- Fiabilité : comportements de sécurité (coupure automatique en cas de surconsommation) potentiellement incohérents ou dupliqués après un redémarrage ou en cluster — critique pour une fonction de protection.

---

### 2.2 Diffusion WebSocket avant validation du payload de mesure

**Sévérité : Moyenne**

**Description :** `mqtt/services/measurement.listener.ts:129-138` :
```typescript
private async handleMeasurement(payload: MeasurementPayload) {
  // Diffusion temps réel immédiate, avant toute écriture en base (CLAUDE.md §1)
  this.realtime.emitMeasurement(payload);

  const dto = plainToInstance(MeasurementPayloadDto, payload);
  const errors = await validate(dto);
  if (errors.length > 0) { /* log + ignore insertion */ }
```
La diffusion temps réel a lieu **avant** la validation `class-validator`. Un payload malformé (champ manquant, type incorrect, hors plage) est donc envoyé tel quel à tous les clients connectés, même s'il est ensuite rejeté pour l'insertion en base. Ce choix est cohérent avec la règle CLAUDE.md ("jamais via la DB avant affichage"), mais ne respecte pas la même rigueur de validation pour le flux temps réel que pour le flux de persistance.

**Proposition de correction :**
- Fichier : `mqtt/services/measurement.listener.ts`.
- Approche : valider d'abord (coût négligeable, in-memory), puis émettre le DTO validé/transformé (qui a aussi l'avantage de typer correctement les nombres via `transform: true`) ; en cas d'échec de validation, soit ne pas émettre, soit émettre avec un flag `valid: false` explicite si l'app mobile doit afficher "donnée brute non vérifiée".

**Impact métier :**
- Fiabilité : un capteur défectueux ou un message MQTT corrompu peut afficher des valeurs aberrantes (ex. tension négative, NaN) sur les tableaux de bord en temps réel, sans qu'aucune validation ne les filtre avant affichage.

---

### 2.3 `REFRESH_SECRET`/`REFRESH_EXPIRES_IN` configurés mais non implémentés

**Sévérité : Faible**

**Description :** Le `.env` définit `REFRESH_SECRET=000000` et `REFRESH_EXPIRES_IN=7d`, mais `auth.service.ts`/`auth.controller.ts` n'implémentent aucune route ou logique de refresh token. Côté mobile, `src/services/auth.ts` documente en commentaire l'absence de endpoint de refresh. Le token d'accès a une durée de vie de 15 minutes (`JWT_EXPIRES_IN=15m`) sans renouvellement automatique.

**Proposition de correction :**
- Fichiers : `modules/auth/auth.controller.ts`, `modules/auth/auth.service.ts`, `powerlens-mobile/src/services/auth.ts` + `api.ts`.
- Approche : soit (a) implémenter un véritable flux de refresh token (`POST /auth/refresh`, rotation du refresh token, stockage côté mobile dans SecureStore) — recommandé pour un usage terrain où la session ne doit pas expirer en pleine intervention ; soit (b) si non prioritaire pour le pilote, augmenter `JWT_EXPIRES_IN` à une valeur raisonnable (ex. 8h, durée d'une intervention) et supprimer les variables `REFRESH_*` mortes pour éviter toute confusion.

**Impact métier :**
- Exploitation : un technicien sur site peut être déconnecté en pleine manipulation (15 min), avec un message d'erreur peu clair côté mobile (le 401 déclenche un logout silencieux).

---

### 2.4 `console.log` au lieu du logger structuré

**Sévérité : Faible**

**Description :** `powerlens-backend/src/prisma.service.ts:22` utilise `console.log('✅ Prisma connected (NestJS)')` alors que le reste du backend utilise le logger Winston (`src/utils/logger.ts`).

**Proposition de correction :** remplacer par `logger.info('Prisma connected')`.

**Impact métier :** Exploitation — cohérence des logs agrégés en production (formats, niveaux, horodatage).

---

## PILIER 3 — PERFORMANCE & SCALABILITÉ

### 3.1 Points positifs constatés

- `EnergyMeasurement` (table à très fort volume, une ligne ~ toutes les 2s par circuit) possède un index composite `@@index([circuitId, measuredAt])` (`schema.prisma:127`, confirmé en migration `20260121170415_init` ligne 135) — adapté aux requêtes "historique d'un circuit sur une plage de temps".
- `EnergyMeasurement.id` et `AuditLog.id` sont des `BigInt @default(autoincrement())`, adapté au très fort volume.
- Les agrégations historiques (`measurements.service.ts`) utilisent `$queryRaw` avec des paramètres Prisma (`Prisma.join`, `Prisma.sql`/template tag), donc **pas d'injection SQL** ; `granularity` est pré-validé par `@IsIn` côté DTO avant d'être interpolé dans `date_trunc(${granularity}, ...)`.
- Pas de pattern N+1 détecté dans `circuits.service.ts` / `measurements.service.ts` (usage cohérent de `include`).
- Le simulateur matériel (`simulator/simulator.service.ts`) est désactivable (`SIMULATOR_ENABLED`), borne son intervalle (1000-60000ms) et nettoie son `setInterval` dans `onModuleDestroy`.

### 3.2 Index manquants sur `Alert` et `AuditLog`

**Sévérité : Moyenne**

**Description :** `prisma/schema.prisma` — les modèles `Alert` (lignes 153-165) et `AuditLog` (lignes 171-180) n'ont **aucun** `@@index`. Or ce sont deux tables à écriture fréquente :
- `Alert` : une ligne créée à chaque déclenchement d'une règle de type `ALERT` (`measurement.listener.ts` ligne 184).
- `AuditLog` : une ligne à chaque commande ON/OFF (manuelle ou automatique), chaque ACK matériel.

Sans index sur `createdAt` (et `buildingId` pour `Alert`), toute requête "alertes récentes du bâtiment X" ou "journal d'audit des dernières 24h" déclenchera un scan complet de la table.

**Proposition de correction :**
- Fichiers : `prisma/schema.prisma`, nouvelle migration Prisma (`npx prisma migrate dev --name add_alert_auditlog_indexes`).
```prisma
model Alert {
  // ...
  @@index([buildingId, createdAt])
}

model AuditLog {
  // ...
  @@index([createdAt])
  @@index([targetType, targetId, createdAt])
}
```

**Impact métier :**
- Performance : à l'échelle de 100-1000 bâtiments, les écrans "alertes" et "journal d'activité" deviendront progressivement lents (scan séquentiel croissant avec le volume).

### 3.3 Diffusion WebSocket globale (pas de cloisonnement par bâtiment)

**Sévérité : Haute (capacité)**

**Description :** `realtime.gateway.ts` utilise `this.server?.emit(...)` — diffusion à **tous** les clients connectés, quel que soit le bâtiment qu'ils consultent. Combiné avec l'absence d'authentification socket (cf. 1.1), ceci pose un problème de **volume** dès que le nombre de bâtiments augmente : un client mobile affichant le tableau de bord d'un seul bâtiment reçoit malgré tout le flux de mesures de tous les bâtiments connectés au broker MQTT (potentiellement un message toutes les ~2s par circuit × tous les bâtiments).

**Évaluation de capacité :**
- **10 bâtiments** (~quelques dizaines de circuits) : fonctionnera mais gaspille de la bande passante mobile et du CPU client (filtrage côté app).
- **100 bâtiments** : dégradation sensible — chaque client mobile reçoit potentiellement des centaines de messages/seconde qu'il doit ignorer ; risque de saturation du socket.io côté serveur (un `emit` global = N×M envois, N=clients, M=messages/s).
- **1000 bâtiments** : architecture **non tenable** sans refonte (rooms par bâtiment, voire par étage/salle).

**Proposition de correction :**
- Fichiers : `realtime/realtime.gateway.ts`, `mqtt/services/measurement.listener.ts` (passer `buildingId` à chaque `emit*`), `powerlens-mobile/src/services/websocket.ts` (rejoindre la room du bâtiment actif via `socket.emit('join', buildingId)` côté serveur ou via namespace).
- Approche : `socket.join(buildingId)` à la connexion (après auth), puis `this.server.to(buildingId).emit('measurement', payload)`.

**Impact métier :**
- Scalabilité : c'est le principal verrou technique pour dépasser ~10-20 bâtiments avec l'architecture actuelle.
- Coût : bande passante mobile inutilement consommée (pertinent pour des tablettes sur réseau cellulaire/4G dans certains sites).

### 3.4 `alertsStore` (mobile) — croissance non bornée

**Sévérité : Moyenne**

**Description :** `powerlens-mobile/src/store/alertsStore.ts:28` :
```typescript
const handleAlert = (payload: Alert) => {
  useAlertsStore.setState((state) => ({ alerts: [toAlertUi(payload), ...state.alerts] }));
};
```
Le tableau `alerts` croît indéfiniment, sans plafond ni pagination. Sur une tablette installée en continu dans un bâtiment (cas d'usage typique pour un écran de supervision), ceci entraîne une croissance mémoire progressive et un re-rendu de liste de plus en plus coûteux.

**Proposition de correction :**
- Fichier : `powerlens-mobile/src/store/alertsStore.ts`.
```typescript
const MAX_ALERTS = 200;
useAlertsStore.setState((state) => ({
  alerts: [toAlertUi(payload), ...state.alerts].slice(0, MAX_ALERTS),
}));
```

**Impact métier :** Fiabilité/performance — dégradation progressive de l'app sur les déploiements "écran fixe" longue durée.

### 3.5 `.env` mobile committé avec IP de développement

**Sévérité : Faible**

**Description :** `powerlens-mobile/.env` est suivi par git (confirmé via `git ls-files`) et contient `EXPO_PUBLIC_API_URL=http://172.20.13.227:3000` — une IP de poste de développement. Pas un secret, mais (a) casse le build pour tout autre développeur/environnement, (b) risque qu'un build de production embarque cette URL si le `.env` n'est pas remplacé.

**Proposition de correction :** ajouter `powerlens-mobile/.env` au `.gitignore`, fournir un `.env.example` avec une valeur de placeholder (`EXPO_PUBLIC_API_URL=http://CHANGE_ME:3000`), et documenter la configuration par environnement dans `docs/deploiement-production.md`.

**Impact métier :** Exploitation — erreurs de configuration silencieuses lors du build de production si l'IP de dev n'est pas remplacée.

---

## PILIER 4 — CONFORMITÉ MÉTIER

| Fonctionnalité | Statut | Justification |
|---|---|---|
| Monitoring temps réel (par bâtiment/salle/circuit) | ✅ Implémenté | MQTT → `MeasurementListener.handleMeasurement` → `RealtimeGateway.emitMeasurement`, sans passage DB préalable, conforme à `CLAUDE.md` §1. |
| Historique de consommation | ✅ Implémenté | `measurements.controller.ts` + `$queryRaw` agrégé par `granularity` (hour/day/week/month), index `(circuitId, measuredAt)` adapté. |
| Alertes par seuil / anomalie | ✅ Implémenté | `rules-engine.service.ts` (type `THRESHOLD`) → action `ALERT` → `prisma.alert.create` + `emitAlert` (`measurement.listener.ts:180-193`). |
| Commandes ON/OFF | ✅ Implémenté | `circuits.controller.ts` `PATCH :id/activate|deactivate` → `setActive` → publication MQTT `commandTopic` + mise à jour Prisma. |
| Traçabilité des commandes | ✅ Implémenté | Chaque activation/désactivation manuelle écrit un `AuditLog` (`actorType: 'USER'`, action `ACTIVATE`/`DEACTIVATE`, `circuits.service.ts:100-108`) ; les actions automatiques du moteur de règles écrivent `SWITCH_OFF_SENT` (`measurement.listener.ts:240-248`) ; les ACK matériels écrivent `SWITCH_OFF_ACK`. |
| Règles — création/exécution | ✅ Implémenté | CRUD protégé par JWT (`rules.controller.ts`), exécution via `RuleEngineService.evaluateMeasurement` (types THRESHOLD/SCHEDULE/AND/OR/EVENT). |
| Règles — type `PRESENCE` | ❌ Non implémenté | `rules-engine.service.ts:181-182` : `case 'PRESENCE': return false;` — type défini dans l'union `RuleCondition` mais toujours évalué à `false` (commenté "hors scope MVP"). Toute règle de ce type est donc inerte sans message d'erreur à l'utilisateur qui la crée. |
| Règles — audit de modification (création/édition/suppression de règle) | ⚠️ Partiel | `rules.service.ts` (`createRule`/`updateRule`/`disableRule`) n'écrit **aucun** `AuditLog` — seules les *exécutions* de règles et les commandes circuit sont auditées, pas la *gestion* des règles elles-mêmes (qui circuit a écrit/modifié/désactivé telle règle de sécurité). |
| Historique/comparaison "avant/après action" (écran Reports mobile) | ❌ Non implémenté | `powerlens-mobile/src/screens/reports/ReportsScreen.tsx` : toutes les données (comparaison avant/après, consommation par type de circuit, table d'historique d'actions) sont **codées en dur**, avec commentaire explicite `// TODO backend: agrégations avant/après actions et historique non disponibles - données de démonstration en attendant un endpoint dédié.` Aucun endpoint backend ne fournit cette agrégation. |
| Journalisation des actions utilisateur (hors circuits) | ⚠️ Partiel | `AuditLog` couvre les commandes circuit, mais pas les actions de gestion (création de bâtiment/salle/règle, modification de rôle utilisateur, etc. — non vérifié car ces endpoints CRUD complets n'existent pas encore pour `Building`/`Room`/`User`). |

**Proposition de correction (synthèse pilier 4) :**
- Implémenter `PRESENCE` ou retirer ce type de l'API/UI tant qu'il n'est pas supporté (sinon un opérateur croira avoir configuré une règle de présence fonctionnelle).
- Ajouter `prisma.auditLog.create(...)` dans `rules.service.ts` sur `createRule`/`updateRule`/`disableRule` (actorType `USER`, action `RULE_CREATED`/`RULE_UPDATED`/`RULE_DISABLED`).
- Spécifier et implémenter un endpoint backend d'agrégation "avant/après" pour remplacer les données mockées de `ReportsScreen.tsx` avant tout pilote présentant cet écran à un client.

---

## VERDICT FINAL

### **DÉPLOYABLE EN INTERNE UNIQUEMENT (environnement de test/démo encadré) — NON DÉPLOYABLE EN BÂTIMENT PUBLIC EN L'ÉTAT**

**Justification :**

Le socle technique est globalement sain : validation stricte des DTO (`ValidationPipe` global, `MeasurementPayloadDto`), moteur de règles sans `eval()` ni injection, requêtes Prisma paramétrées, indexation adaptée pour le flux de mesures, hachage bcrypt des mots de passe, logger structuré, simulateur propre. La traçabilité des commandes ON/OFF est correctement implémentée.

Cependant, **trois failles critiques cumulées rendent le système inadapté à un déploiement dans des bâtiments publics** :

1. Le **WebSocket temps réel n'est pas authentifié et diffuse à tout le monde** (1.1) — n'importe qui peut espionner en temps réel la consommation de tous les bâtiments.
2. **Plusieurs endpoints REST de lecture sont publics** (1.2) — la topologie complète (bâtiments, salles, circuits, historiques) est consultable sans compte.
3. **Aucun RBAC** (1.3) alors que le modèle de rôles existe — un compte "lecture seule" peut couper des circuits dans un bâtiment public.

À ces failles s'ajoute un verrou de **scalabilité** (3.3 : diffusion WebSocket globale + état du moteur de règles en mémoire non partagé, 2.1) qui limite le déploiement à environ 10-20 bâtiments avant dégradation, et empêche tout déploiement multi-instance fiable.

**Chemin recommandé vers un pilote :**
1. Corriger 1.1, 1.2, 1.3 (authentification WebSocket + cloisonnement par bâtiment, guard global + `@Public()`, RBAC sur les mutations sensibles). Ce sont des changements ciblés, pas une refonte.
2. Migrer l'état du moteur de règles vers Redis (2.1) avant tout déploiement multi-instance ou redémarrage en production.
3. Ajouter le rate limiting sur `/auth/login` (1.5) et Helmet (1.6).
4. Une fois 1-3 traités → **DÉPLOYABLE POUR PILOTE** (1-3 bâtiments réels, supervision rapprochée), avec les points "Moyenne/Faible" restants (index Alert/AuditLog, validation ACK, écran Reports mocké, type PRESENCE) à traiter avant une généralisation à 100+ bâtiments.
