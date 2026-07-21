# PowerLens V2 — "Smart Supervisor" : Conception Technique

## Contexte et objectif

PowerLens V1 fournit déjà : supervision temps réel (ESP32 → MQTT → NestJS → WebSocket → mobile), un moteur de règles (`Rule` avec conditions/actions JSONB), un historique de mesures (`EnergyMeasurement`), des alertes (`Alert`) et un journal d'audit (`AuditLog`).

La V2 ajoute le **PowerLens Smart Supervisor** : un module d'analyse périodique des données historiques (30j, 90j, tendances saisonnières) capable de :

- détecter des comportements énergétiques anormaux (surconsommation, équipements sous-utilisés/jamais utilisés, règles inefficaces, alertes répétitives) ;
- proposer des créations, modifications ou suppressions de règles, avec justification, impact estimé, économies estimées et niveau de confiance ;
- **ne jamais modifier la production automatiquement** — toute action passe par une validation humaine (administrateur) ;
- garantir une traçabilité complète de chaque suggestion (table `rule_recommendations`).

Ce document couvre les 10 livrables demandés et constitue la base de départ pour l'implémentation (Phase 0 et suivantes, cf. section 9).

---

## 1. Architecture technique détaillée

### 1.1 Nouveau module `SupervisorModule`

Suivant la structure existante de `src/modules/rules/`, un nouveau module est ajouté :

```
powerlens-backend/src/modules/supervisor/
  supervisor.module.ts
  supervisor-analysis.service.ts        // job d'analyse périodique (détection)
  supervisor-recommendations.service.ts // CRUD recommandations + application
  supervisor.controller.ts              // endpoints REST
  dto/
    recommendations-query.dto.ts
    review-recommendation.dto.ts
  detectors/
    excessive-consumption.detector.ts
    underused-equipment.detector.ts
    inefficient-rule.detector.ts
    repetitive-alert.detector.ts
```

### 1.2 Ordonnancement (scheduler)

V1 n'utilise pas `@nestjs/schedule`. On l'ajoute (dépendance officielle NestJS, cohérente avec l'écosystème déjà en place pour Mqtt/Realtime).

- `app.module.ts` importe `ScheduleModule.forRoot()` (ajout unique, non intrusif).
- `SupervisorAnalysisService` expose une méthode décorée `@Cron(process.env.SUPERVISOR_CRON ?? '0 3 * * *')` (03h00, heure creuse).
- Activation contrôlée par feature flag `SUPERVISOR_ENABLED` (cohérent avec le pattern `SIMULATOR_ENABLED` déjà utilisé par `SimulatorModule`).
- Possibilité de restreindre l'analyse à une liste de bâtiments pilotes via `SUPERVISOR_PILOT_BUILDING_IDS` (cf. section 6).

### 1.3 Positionnement dans l'architecture

- **Read-mostly** sur les tables historiques (`EnergyMeasurement`, `Alert`, `AuditLog`, `Rule`), **write-only** sur `RuleRecommendation` et `SupervisorRun`, plus écriture `AuditLog` pour ses propres événements.
- **Aucune dépendance** sur `RealtimeModule` ni `MqttModule` : le Smart Supervisor n'écoute aucun topic MQTT et n'émet aucun événement WebSocket. Le flux temps réel ESP32 → MQTT → NestJS → WebSocket → mobile reste totalement inchangé.
- Ne touche jamais l'état in-memory du `RuleEngineService` (`ruleStates`/`cooldowns`) au moment de l'analyse — seule l'application d'une recommandation approuvée interagit avec lui (cf. section 7, `clearState`).
- Toutes les requêtes d'analyse utilisent des agrégations SQL (`date_trunc`, `AVG`, `SUM`, `COUNT`, `GROUP BY`) via `Prisma.$queryRaw`, sur le même modèle que `measurements.service.ts`. Jamais de `findMany` brut sur `EnergyMeasurement`.
- Exécution nocturne (03h00) pour ne pas concurrencer l'insertion MQTT → DB (déjà asynchrone et non bloquante, mais à charge non négligeable en journée).

### 1.4 Déroulé du job d'analyse

1. `@Cron` déclenche `runAnalysis()`.
2. Création d'une ligne `SupervisorRun{status: RUNNING}`.
3. Pour chaque `Building` actif (ou filtré par `SUPERVISOR_PILOT_BUILDING_IDS`), exécution séquentielle des 4 détecteurs sur les fenêtres 30j/90j.
4. Chaque détecteur retourne 0..n candidats `RuleRecommendation{status: PENDING}`.
5. **Déduplication** : si une recommandation `PENDING` équivalente existe déjà (même `detectorKey` + `targetRuleId`/cible + signature des conditions proposées), on ne recrée pas une ligne — on met à jour `lastDetectedAt`.
6. Mise à jour de `SupervisorRun{status: COMPLETED|FAILED, finishedAt, recommendationsCreated, buildingsScanned}`.
7. Écriture `AuditLog{actorType:'SYSTEM', action:'SUPERVISOR_ANALYSIS_COMPLETED', targetType:'SUPERVISOR_RUN', targetId: run.id, metadata:{recommendationsCreated, durationMs}}` — même convention que `SWITCH_OFF_SENT`.

En cas d'exception : `SupervisorRun{status: FAILED, errorMessage}` + `AuditLog action: 'SUPERVISOR_ANALYSIS_FAILED'`. Le job ne doit jamais throw de manière non gérée — impact zéro sur le reste de l'application.

---

## 2. Schéma de données

Ajouts à `powerlens-backend/prisma/schema.prisma`, dans le style existant (uuid pour les entités métier, enums regroupés en haut de fichier).

### 2.1 Nouveaux enums et modèles

```prisma
/* ===========================
   SMART SUPERVISOR (V2)
   =========================== */

enum RecommendationType {
  CREATE_RULE
  MODIFY_RULE
  DELETE_RULE
}

enum RecommendationStatus {
  PENDING
  APPROVED
  REJECTED
  APPLIED
}

enum RecommendationConfidence {
  LOW
  MEDIUM
  HIGH
}

enum SupervisorRunStatus {
  RUNNING
  COMPLETED
  FAILED
}

model RuleRecommendation {
  id                  String                    @id @default(uuid())
  type                RecommendationType
  title               String                    // ex: "Extinction auto après 22h - Salle 204"
  justification       String                    // explication en français, générée par le détecteur
  detectorKey         String                    // ex: "EXCESSIVE_CONSUMPTION", "INEFFICIENT_RULE_THRESHOLD"
  proposedConditions  Json?                     // format RuleCondition, null si DELETE_RULE
  proposedActions     Json?                     // format RuleAction[], null si DELETE_RULE
  estimatedImpact     String                    // description qualitative
  estimatedSavingsKwh Float?                    // kWh/mois estimés
  estimatedSavingsEur Float?                    // €/mois estimés (tarif configurable)
  confidence          RecommendationConfidence
  status              RecommendationStatus      @default(PENDING)
  author              String                    @default("AI") // figé, traçabilité de l'origine

  buildingId          String
  building            Building @relation(fields: [buildingId], references: [id])

  targetRuleId        String?  // Rule existante visée (MODIFY/DELETE), null si CREATE_RULE
  targetRule          Rule?    @relation(fields: [targetRuleId], references: [id])

  appliedRuleId       String?  // Rule résultante après application (traçabilité)

  approverId          String?  // User.id ayant statué
  approver            User?    @relation(fields: [approverId], references: [id])
  reviewComment       String?
  reviewedAt          DateTime?

  detectionWindowFrom DateTime
  detectionWindowTo   DateTime
  supervisorRunId     String
  supervisorRun       SupervisorRun @relation(fields: [supervisorRunId], references: [id])

  createdAt           DateTime @default(now())
  lastDetectedAt      DateTime @default(now())
  appliedAt           DateTime?

  @@index([buildingId, status])
  @@index([status, createdAt])
  @@index([targetRuleId])
}

model SupervisorRun {
  id                     String              @id @default(uuid())
  startedAt              DateTime            @default(now())
  finishedAt             DateTime?
  status                 SupervisorRunStatus @default(RUNNING)
  buildingsScanned       Int                 @default(0)
  recommendationsCreated Int                 @default(0)
  errorMessage           String?

  recommendations RuleRecommendation[]

  @@index([startedAt])
}
```

Relations inverses à ajouter pour la navigation Prisma :
- `Rule.recommendations RuleRecommendation[]`
- `User.reviewedRecommendations RuleRecommendation[]`

### 2.2 Garde-fou sécurité : `Circuit.isCritical`

```prisma
model Circuit {
  // ... champs existants
  isCritical Boolean @default(false)
}
```

Permet d'exclure (ou de limiter à `confidence: LOW`) les recommandations de coupure (`SWITCH_OFF`) sur des circuits sensibles (éclairage de secours, équipements médicaux/frigorifiques). Détaillé en section 7.

### 2.3 Index correctifs V1 (dette technique, déjà documentée dans `docs/audit-v1.md`)

```prisma
model Alert {
  // ... champs existants
  @@index([createdAt])
  @@index([buildingId, createdAt])
}

model AuditLog {
  // ... champs existants
  @@index([createdAt])
  @@index([action, targetType, createdAt])
}
```

Ces index sont **indispensables** pour les détecteurs "règles inefficaces" et "alertes répétitives" : sans eux, ces requêtes deviendraient des scans séquentiels sur des tables qui croissent indéfiniment.

### 2.4 Décision : pas de table `RuleExecutionLog` dédiée

`AuditLog` contient déjà les actions `SWITCH_OFF_SENT` (actorType SYSTEM, targetType RULE/CIRCUIT), `ACTIVATE`/`DEACTIVATE` (actorType USER) et `SWITCH_OFF_ACK` (actorType HARDWARE). Les détecteurs calculent la fréquence de déclenchement d'une règle sur 90 jours directement depuis `AuditLog` :

```sql
SELECT "targetId", COUNT(*) FROM "AuditLog"
WHERE action = 'SWITCH_OFF_SENT' AND "targetType" = 'RULE'
  AND "createdAt" BETWEEN $90dAgo AND now()
GROUP BY "targetId"
```

Ceci évite la duplication de données et conserve `AuditLog` comme source de vérité unique de l'historique d'actions.

---

## 3. Flux applicatifs

### 3.1 Flux A — Job nocturne → détection → recommandation

1. **Cron 03h00** → `SupervisorAnalysisService.runAnalysis()`.
2. Création `SupervisorRun{status: RUNNING}`.
3. Pour chaque `Building` :
   - **Détecteur "Consommation excessive"** : agrège `EnergyMeasurement` par circuit sur 30j (`date_trunc('hour', measuredAt)`, `GROUP BY circuitId, bucket`). Si un circuit dépasse un seuil paramétrable (ex. P95 historique × 1,5) de manière récurrente (≥ N occurrences/semaine) sur une plage horaire identifiable (ex. tous les soirs après 22h) **et** qu'aucune `Rule` SCHEDULE ne couvre déjà ce circuit → génère `RuleRecommendation{type: CREATE_RULE, proposedConditions: {type:'SCHEDULE', startTime:'22:00', endTime:'06:00', days:[...]}, proposedActions: [{type:'SWITCH_OFF', targetId: circuitId}]}`.
   - **Détecteur "Équipement sous-utilisé / jamais utilisé"** : `SUM(energyKwh)` par circuit sur 90j. Si quasi nul et `Circuit.isActive=true` → recommandation informative (signalement, pas de `SWITCH_OFF` automatique) avec `estimatedImpact = "équipement potentiellement obsolète/à vérifier"`.
   - **Détecteur "Règles inefficaces"** : pour chaque `Rule{ruleType: THRESHOLD}` active, compte les `SWITCH_OFF_SENT` liés sur 90j (via `AuditLog`) et croise avec les `Alert{ruleId}` de niveau WARNING/CRITICAL non acquittées et rapidement re-déclenchées (signe de seuil mal calibré). Si fréquence anormalement haute → `MODIFY_RULE` ajustant `value` du seuil (+10–20%). Si **aucune** entrée `AuditLog` liée depuis ≥ 180j → `DELETE_RULE`.
   - **Détecteur "Alertes répétitives"** : `GROUP BY message, buildingId` sur `Alert` (90j) ; si un même message dépasse un seuil (ex. > 20/mois) sans action corrective → `CREATE_RULE`/`MODIFY_RULE` ciblant la règle source (`alert.ruleId`).
4. Pour chaque candidat : déduplication (cf. 2.1) puis `create` ou mise à jour `lastDetectedAt`.
5. Mise à jour `SupervisorRun{status: COMPLETED, finishedAt, recommendationsCreated}`.
6. `AuditLog{actorType:'SYSTEM', action:'SUPERVISOR_ANALYSIS_COMPLETED', targetType:'SUPERVISOR_RUN', targetId: run.id, metadata:{...}}`.

### 3.2 Flux B — Revue admin → décision → application

1. Admin (`ADMIN`/`SUPER_ADMIN`) consulte `GET /supervisor/recommendations?status=PENDING&buildingId=...`.
2. Détail via `GET /supervisor/recommendations/:id` (justification, impact, confiance, conditions/actions proposées — traduites côté mobile via `ruleDisplay.ts`).
3. Trois actions possibles :
   - **Approuver tel quel** → `PATCH /supervisor/recommendations/:id/approve {comment?}`.
     - Backend : `status: APPROVED, approverId: user.id, reviewedAt: now()`, puis application immédiate :
       - `CREATE_RULE` → `RulesService.createRule({...proposedConditions/Actions, buildingId})`, stocke `appliedRuleId`.
       - `MODIFY_RULE` → `RulesService.updateRule(targetRuleId, {conditions: proposedConditions})`.
       - `DELETE_RULE` → `RulesService.disableRule(targetRuleId)` (suppression logique, cohérent avec V1).
     - `status: APPLIED, appliedAt: now()`.
     - `AuditLog{actorType:'USER', actorId: user.id, action:'RECOMMENDATION_APPROVED', targetType:'RULE_RECOMMENDATION', targetId: rec.id, metadata:{appliedRuleId, type}}`.
   - **Modifier puis approuver** → même endpoint avec `{overrideConditions?, overrideActions?, comment}` : l'admin ajuste les valeurs proposées avant application. Le payload appliqué et la justification de modification sont stockés dans `AuditLog.metadata`.
   - **Rejeter** → `PATCH /supervisor/recommendations/:id/reject {comment}` → `status: REJECTED, approverId, reviewedAt, reviewComment` + `AuditLog action:'RECOMMENDATION_REJECTED'`.
4. Aucune mutation de `Rule` ne peut survenir hors de ce flux contrôlé par `RolesGuard` (ADMIN+) : le détecteur n'a que des droits de lecture (tables historiques) et d'écriture sur `RuleRecommendation`/`SupervisorRun`.

---

## 4. APIs nécessaires

### 4.1 RBAC — introduction de `RolesGuard`

V2 introduit `RolesGuard` + décorateur `@Roles(...)` :
- `src/modules/auth/decorators/roles.decorator.ts`
- `src/modules/auth/guards/roles.guard.ts`

Basé sur `request.user.role` (déjà présent dans le JWT payload via `auth.service.ts`). Appliqué **en complément** de `JwtAuthGuard` : `@UseGuards(JwtAuthGuard, RolesGuard)`.

**Portée V2** : appliqué uniquement aux nouveaux endpoints `/supervisor/*`. Le retrofit RBAC complet des endpoints V1 existants est un chantier séparé (cf. section 6 et 9, Phase 5).

### 4.2 Endpoints `SupervisorController` (`@Controller('supervisor')`)

| Méthode | Path | Rôles | Description |
|---|---|---|---|
| GET | `/supervisor/recommendations` | ADMIN, SUPER_ADMIN | Liste paginée, filtres `status`, `buildingId`, `type`, `confidence` |
| GET | `/supervisor/recommendations/:id` | ADMIN, SUPER_ADMIN | Détail complet (justification, impact, conditions/actions JSON, règle cible, historique de revue) |
| PATCH | `/supervisor/recommendations/:id/approve` | ADMIN, SUPER_ADMIN | Body : `{ comment?, overrideConditions?, overrideActions? }` — applique sur `Rule` |
| PATCH | `/supervisor/recommendations/:id/reject` | ADMIN, SUPER_ADMIN | Body : `{ comment: string }` |
| GET | `/supervisor/runs` | ADMIN, SUPER_ADMIN | Historique des exécutions du job (monitoring) |
| POST | `/supervisor/runs/trigger` | SUPER_ADMIN | Déclenchement manuel hors cron (tests/démo), rate-limité |

### 4.3 Formes de réponse

`GET /supervisor/recommendations` :

```json
{
  "items": [{
    "id": "uuid", "type": "CREATE_RULE", "title": "...",
    "justification": "...", "estimatedImpact": "...",
    "estimatedSavingsKwh": 12.4, "confidence": "HIGH",
    "status": "PENDING", "buildingId": "...", "createdAt": "..."
  }],
  "total": 14, "page": 1, "pageSize": 20
}
```

`GET /supervisor/recommendations/:id` : ajoute `proposedConditions`, `proposedActions`, `targetRule` (résumé si MODIFY/DELETE), `detectionWindowFrom/To`, `supervisorRunId`.

---

## 5. Interfaces utilisateur (mobile)

### 5.1 Décision de navigation

Le module est **admin-only** : pas de nouvel onglet global (éviterait d'impacter la `TabBar` pour les rôles VIEWER/MANAGER). Intégration dans `SettingsStack` (comme `BuildingManagement`, déjà à tendance admin) :

```
SettingsStack
  SettingsHome (existant) -> nouvelle section "Supervision IA" (visible si role ∈ [ADMIN, SUPER_ADMIN])
  BuildingManagement (existant)
  RecommendationsList (NOUVEAU)
  RecommendationDetail (NOUVEAU, modal)
```

Fichiers :
- `powerlens-mobile/src/screens/supervisor/RecommendationsListScreen.tsx`
- `powerlens-mobile/src/screens/supervisor/RecommendationDetailScreen.tsx`
- `powerlens-mobile/src/navigation/SettingsStack.tsx` → 2 `Stack.Screen` supplémentaires
- `powerlens-mobile/src/navigation/types.ts` → `RecommendationsList: undefined; RecommendationDetail: { id: string }`

### 5.2 État et services

- `powerlens-mobile/src/store/supervisorStore.ts` — même pattern que `rulesStore.ts` (fetch + fallback mock) :

```ts
interface SupervisorState {
  recommendations: RuleRecommendation[];
  loading: boolean; error: string | null;
  fetchRecommendations: (filters?) => Promise<void>;
  approve: (id: string, payload?: ApprovePayload) => Promise<void>;
  reject: (id: string, comment: string) => Promise<void>;
}
```

- `powerlens-mobile/src/services/supervisor.ts` — axios, suit `services/rules.ts`.
- Types ajoutés à `src/types/models.ts` : `RuleRecommendation`, `RecommendationType`, `RecommendationStatus`, `RecommendationConfidence` (miroir exact des enums Prisma, comme `Rule`/`RuleCondition`/`RuleAction`).

### 5.3 Écrans

**RecommendationsListScreen** :
- Tabs "En attente" / "Traitées".
- Carte par item : titre, bâtiment, économie estimée (kWh + €), badge `confidence` (HIGH=vert, MEDIUM=orange, LOW=gris), icône par `type` (CREATE/MODIFY/DELETE).

**RecommendationDetailScreen** (modal, comme `RuleFormScreen`) :
- "Justification" (texte IA).
- "Impact estimé" (description + kWh/€ par mois).
- "Règle proposée" — traduite via `ruleDisplay.ts` (même affichage que `ActionsReactionsScreen`).
- Si MODIFY/DELETE : comparaison "avant / après" avec la règle cible actuelle.
- Boutons : "Approuver" (vert), "Modifier puis approuver" (ouvre `RuleFormScreen` pré-rempli avec `proposedConditions/Actions`, soumission avec `overrideConditions/Actions`), "Rejeter" (rouge, commentaire obligatoire).

### 5.4 Intégration aux écrans existants

- **ReportsScreen** (onglet "Historique actions", déjà branché sur `/audit-logs`) : les nouvelles actions `RECOMMENDATION_APPROVED`/`RECOMMENDATION_REJECTED`/`SUPERVISOR_ANALYSIS_COMPLETED` apparaissent automatiquement ; ajouter leurs libellés français si l'affichage actuel mappe explicitement les `action`.
- **SettingsScreen** : ajout d'une rangée "Recommandations IA (N en attente)" avec badge compteur (`GET /supervisor/recommendations?status=PENDING&limit=1`), visible uniquement pour ADMIN/SUPER_ADMIN — premier usage réel de `user.role` pour du gating UI.
- **AlertsScreen** : amélioration optionnelle non bloquante — lien "Voir la suggestion" si une alerte répétée correspond à une `RuleRecommendation{targetRuleId, status: PENDING}`.

---

## 6. Plan de migration V1 → V2

1. **Migration Prisma #1 — fondations non bloquantes** (`npx prisma migrate dev --name v2_supervisor_foundations`) :
   - Index `Alert.createdAt`, `Alert.[buildingId,createdAt]`, `AuditLog.createdAt`, `AuditLog.[action,targetType,createdAt]`.
   - Nouveaux enums + modèles `SupervisorRun`, `RuleRecommendation` (tables vides au départ).
   - `Circuit.isCritical Boolean @default(false)`.

2. **RBAC retrofit (Phase 0, isolée)** :
   - Création `RolesGuard`/`@Roles()`.
   - **Risque identifié** : appliquer `@Roles(...)` aux endpoints existants (`rules`, `circuits`, `buildings`, ...) changerait leur comportement pour les clients mobile actuels (comptes VIEWER/MANAGER utilisant aujourd'hui des routes d'écriture sans contrôle).
   - **Décision** : en V2, `RolesGuard` est appliqué **uniquement** aux nouveaux endpoints `/supervisor/*`. Le retrofit RBAC complet sur V1 est un chantier séparé (Phase 5), avec audit préalable de la cohérence des `User.role` en base.

3. **Backend — module Supervisor en lecture seule** :
   - `npm install @nestjs/schedule`.
   - `SupervisorModule` + `SupervisorAnalysisService`, cron désactivé par défaut (`SUPERVISOR_ENABLED=false`).
   - Déploiement, validation en lecture seule : le job tourne, peuple `SupervisorRun`/`RuleRecommendation(PENDING)`, mais rien n'est exposé côté API/mobile.

4. **Backend — API + application** :
   - `SupervisorController` (section 4), protégé par `RolesGuard`.
   - Activation `SUPERVISOR_ENABLED=true`.

5. **Mobile** : types, `supervisorStore`, `services/supervisor.ts`, écrans, navigation, gating par `user.role` (déjà disponible dans `authStore` depuis le login V1 — aucun changement backend d'auth nécessaire).

6. **Rollout progressif** : le scope est déjà par `Building`. Pour valider la pertinence des recommandations avant généralisation, limiter la première analyse via `SUPERVISOR_PILOT_BUILDING_IDS`.

7. **Aucun impact sur le temps réel** : à aucune étape `SupervisorModule` n'importe `RealtimeModule` ou `MqttModule`. Vérification : `SupervisorModule.imports` ne contient que `PrismaModule` + `RulesModule` (réutilisation de `RulesService` pour l'application).

---

## 7. Analyse des risques

### 7.1 Risques techniques

- **Faux positifs / recommandations non pertinentes** : mitigé par des seuils de confiance conservateurs (HIGH seulement si le pattern est observé ≥ 4 semaines consécutives), zéro application automatique (toute recommandation reste `PENDING` jusqu'à action humaine), et déduplication évitant le spam de recommandations identiques à chaque run.
- **Charge DB du job d'analyse** : agrégations sur `EnergyMeasurement` (table à très haute volumétrie). Mitigé par exécution nocturne, usage exclusif d'agrégats `date_trunc` exploitant l'index `[circuitId, measuredAt]` déjà présent, et fenêtre d'analyse limitée à 90j max. À valider via `EXPLAIN ANALYZE` en recette sur volume réel avant activation prod.
- **État in-memory du `RuleEngineService` non invalidé** : quand une recommandation `MODIFY_RULE`/`DELETE_RULE` est appliquée, `RuleEngineService.ruleStates`/`cooldowns` (Map in-memory) n'est pas invalidé automatiquement. Le code revérifie `isActive` à chaque évaluation (`findMany({where:{isActive:true}})`), donc pas de risque de double-exécution, mais une entrée de state résiduelle reste en mémoire (fuite lente). **Action** : ajouter `RuleEngineService.clearState(ruleId)`, appelé par `SupervisorRecommendationsService` après application d'un MODIFY/DELETE. Le chantier plus large "état du moteur de règles → Redis pour multi-instance" (risque V1 déjà documenté) reste hors scope V2 mais à prioriser avant tout scale-out horizontal.
- **RBAC retrofit cassant des clients existants** : mitigé par la portée limitée aux nouveaux endpoints en V2 (cf. section 6).

### 7.2 Risques gouvernance / conformité

- **Recommandations sur circuits critiques** (éclairage de secours, équipements médicaux/frigorifiques) : le schéma actuel ne distingue pas ces circuits. **Décision** : ajout de `Circuit.isCritical Boolean @default(false)`. Les détecteurs **excluent** tout circuit `isCritical=true` des recommandations `CREATE_RULE`/`MODIFY_RULE` impliquant `SWITCH_OFF`. Tant qu'un circuit n'a pas été explicitement qualifié (`isCritical` non renseigné par un admin), toute recommandation impliquant `SWITCH_OFF` sur ce circuit reçoit automatiquement `confidence: LOW` avec un avertissement dans `justification` — incitation à compléter les données.
- **Responsabilité humaine (accountability)** : toute application est tracée avec `approverId` (FK `User`) — jamais d'application sans identité humaine responsable. `author: "AI"` figé distingue clairement suggestion (IA) et décision (humain).
- **Traçabilité / RGPD-local** : chaque recommandation porte `supervisorRunId`, `detectionWindowFrom/To` → reconstitution exacte des données ayant motivé la suggestion. Aucune donnée personnelle nouvelle n'est introduite (les analyses portent sur des mesures énergétiques et règles, pas sur des données utilisateurs individuelles) ; seul `approverId` relie une décision à un compte admin, déjà couvert par le périmètre RGPD existant de `User`/`AuditLog`.

---

## 8. Estimation de charge serveur

### 8.1 Volumétrie de référence

`EnergyMeasurement` : ~1 ligne/circuit/2s ≈ 43 200 lignes/circuit/jour. Pour un site de 30 circuits : ~1,3M lignes/jour, ~39M/mois, ~470M/an. Sur la fenêtre d'analyse de 90 jours : ~117M lignes.

### 8.2 Requêtes du job (par bâtiment, par run nocturne)

- **Consommation excessive** : une requête agrégée groupée (`GROUP BY circuitId, bucket` avec `date_trunc('hour', ...)`) par bâtiment sur 30j, exploitant l'index `[circuitId, measuredAt]`. Préférer une requête groupée unique plutôt que N requêtes par circuit.
- **Équipement sous-utilisé** : `SUM(energyKwh) GROUP BY circuitId` sur 90j, une requête par bâtiment.
- **Règles inefficaces / alertes répétitives** : requêtes sur `Alert`/`AuditLog` — volumétrie bien inférieure (événements discrets vs mesures périodiques). Avec les nouveaux index (section 2.3), sub-seconde même à plusieurs centaines de milliers de lignes.

### 8.3 Fréquence et durée

1×/jour à 03h00 (heure creuse). Durée estimée : quelques secondes à ~1–2 minutes pour 10–20 bâtiments × 4 détecteurs — largement acceptable hors heures de pointe, sans concurrence significative avec l'insertion MQTT (faible trafic nocturne typique).

### 8.4 Croissance des nouvelles tables

- `SupervisorRun` : 1 ligne/jour → ~365/an, négligeable.
- `RuleRecommendation` : 0–10 nouvelles recommandations/run/bâtiment au démarrage (rattrapage sur historique), puis régime de croisière faible (0–2/semaine/bâtiment). Sur 10 bâtiments × 2/semaine × 52 semaines ≈ 1000 lignes/an — négligeable face à `EnergyMeasurement`.

### 8.5 Recommandation opérationnelle

Si `EnergyMeasurement` dépasse plusieurs centaines de millions de lignes, envisager une politique de rétention/partitionnement (hors scope V2, à noter en roadmap long terme). Le job Supervisor ne scanne jamais au-delà de 90j (`WHERE measuredAt >= now() - interval '90 days'`), garanti par construction.

---

## 9. Roadmap d'implémentation

| Phase | Contenu | Durée estimée |
|---|---|---|
| **Phase 0 — Fondations** | Migration Prisma #1 (index + nouveaux modèles vides + `Circuit.isCritical`), création `RolesGuard`/`@Roles()` (appliqué uniquement aux futurs endpoints), ajout `@nestjs/schedule` | 1–2 semaines |
| **Phase 1 — Détection en lecture seule** | `SupervisorModule` + 4 détecteurs, cron actif (`SUPERVISOR_ENABLED=true`) sur bâtiment(s) pilote(s), écrit `RuleRecommendation`/`SupervisorRun`, **aucun endpoint exposé**. Validation manuelle (SQL direct) de la pertinence sur données réelles | 2–3 semaines |
| **Phase 2 — API lecture + ajustement** | Ajustement des seuils/algorithmes suite à Phase 1, `SupervisorController` (GET liste/détail), tests d'intégration sur fixtures | 2 semaines |
| **Phase 3 — UI mobile d'approbation** | Écrans `RecommendationsListScreen`/`RecommendationDetailScreen`, store, navigation, gating par rôle. `approve`/`reject` existent mais `approve` ne fait QUE changer `status` (pas encore d'application réelle) — validation UX sans risque prod | 2–3 semaines |
| **Phase 4 — Application en production** | Implémentation réelle (`RulesService.createRule/updateRule/disableRule`) dans `approve`, `RuleEngineService.clearState()`, `AuditLog` complet, tests end-to-end (recommandation → approbation → règle active → déclenchement réel observé) | 1–2 semaines |
| **Phase 5 — Généralisation + retrofit RBAC V1** | Extension à tous les bâtiments ; chantier séparé d'application de `RolesGuard` aux endpoints V1 existants, avec audit des comptes et communication | différé / parallèle |

---

## 10. Critères de validation finale

- **Phase 0** : migration appliquée sans erreur sur copie de prod ; `RolesGuard` renvoie 403 sur `/supervisor/*` pour un rôle insuffisant et laisse passer ADMIN/SUPER_ADMIN ; `Circuit.isCritical` migré avec défaut `false` sans casser de requêtes existantes.
- **Phase 1** : le cron s'exécute à l'heure configurée et crée exactement une ligne `SupervisorRun` par exécution avec un `status` cohérent ; aucune ligne `Rule`/`Alert`/`EnergyMeasurement` n'est modifiée par le job (vérifiable par diff de checksums avant/après) ; temps d'exécution < seuil acceptable (ex. 5 min) sur volumétrie de prod ; chaque recommandation générée contient `justification`, `estimatedImpact`, `confidence` non nuls.
- **Phase 2** : `GET /supervisor/recommendations` → 401 sans JWT, 403 pour VIEWER/MANAGER, 200 pour ADMIN/SUPER_ADMIN ; pagination et filtres `status`/`buildingId`/`type` fonctionnels ; aucune recommandation ne référence un `targetRuleId` inexistant ou un `Circuit.isCritical=true` avec action `SWITCH_OFF` et `confidence != LOW`.
- **Phase 3** : écrans accessibles uniquement si `user.role ∈ [ADMIN, SUPER_ADMIN]` ; affichage correct des conditions/actions via `ruleDisplay.ts` ; actions approve/reject déclenchent bien les endpoints (vérifiable via `AuditLog`).
- **Phase 4 (critère central de conformité)** : **aucune ligne de `Rule` ne peut être créée/modifiée/désactivée par le Smart Supervisor sans qu'une `RuleRecommendation` correspondante ait `status=APPLIED` (avec `approverId` non nul et `reviewedAt` renseigné)**. Vérifiable par requête de cohérence : pour toute `Rule` dont `id` apparaît dans `RuleRecommendation.appliedRuleId`, il existe une `RuleRecommendation{status=APPLIED, approverId IS NOT NULL}`. Toute violation = bug bloquant.

### Validation globale V2

- Auditabilité complète : chaque recommandation → son `SupervisorRun` d'origine → chaque décision (approve/reject) → `AuditLog` correspondant, reconstitution intégrale possible.
- Zéro régression sur le chemin temps réel (mesures WebSocket sans latence ajoutée, pendant et hors exécution du job).
- Aucun circuit `isCritical=true` n'a jamais reçu de recommandation `SWITCH_OFF` avec `confidence` autre que `LOW`.
- Démonstration end-to-end : un pattern de consommation simulé (ex. pic récurrent 22h–06h) génère une recommandation `CREATE_RULE` cohérente, approuvée manuellement, et la règle résultante est effectivement évaluée par `RuleEngineService` lors de la prochaine mesure correspondante.

---

## Fichiers critiques pour l'implémentation

- `powerlens-backend/prisma/schema.prisma`
- `powerlens-backend/src/modules/rules/rules-engine.service.ts`
- `powerlens-backend/src/app.module.ts`
- `powerlens-backend/src/modules/audit/audit.service.ts`
- `powerlens-mobile/src/navigation/SettingsStack.tsx`
- `powerlens-mobile/src/store/rulesStore.ts`
- `powerlens-mobile/src/utils/ruleDisplay.ts`
