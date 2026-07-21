# Audit du moteur de règles — état des lieux (lecture seule)

> Audit réalisé le 2026-07-15 sur le code tel quel, sans aucune modification.
> Objectif : cartographier l'existant en préparation d'une future délégation d'un
> sous-ensemble de règles à l'ESP32 (mode hors ligne). **Ce document ne conçoit pas
> cette étape future** — il décrit ce qui existe, références de fichiers/lignes à l'appui.
>
> Périmètre exploré : `powerlens-backend/src/modules/rules/`, `src/mqtt/services/measurement.listener.ts`,
> `src/modules/alerts/alerts.service.ts`, `src/modules/supervisor/supervisor-recommendations.service.ts`,
> `prisma/schema.prisma`, `prisma/seed.ts`.

---

## 1. Définition et sauvegarde d'une règle

### 1.1 Modèle de données (Prisma)

`prisma/schema.prisma:235-249` :

```prisma
model Rule {
  id         String   @id @default(uuid())
  name       String
  ruleType   RuleType   // SCHEDULE | THRESHOLD | PRESENCE | EVENT | COMBINED (schema.prisma:41-47)
  conditions Json       // arbre de conditions (grammaire ci-dessous)
  actions    Json       // tableau d'actions
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  buildingId String     // scope : les règles sont chargées PAR bâtiment
  ...
}
```

**Point structurant** : toute la sémantique vit dans les deux colonnes **JSON non typées**
(`conditions`, `actions`). La colonne `ruleType` est **purement décorative** : le moteur
ne la lit jamais (voir §4.1).

### 1.2 Grammaire réelle des conditions

Type TS `RuleCondition` (`rules-engine.service.ts:33-53`), validée à l'écriture par
`rule-validation.ts:14-83` :

| Type | Champs | Notes |
|---|---|---|
| `THRESHOLD` | `field?` (défaut `'power'`, **chaîne libre**), `operator` (`>`/`<`/`==`), `value` (number), `zoneId?` | `field` volontairement non-enum : le Supervisor produit p.ex. `energyKwh` (`rule-validation.ts:5-8`) |
| `SCHEDULE` | `startTime`, `endTime` (`HH:MM`, regex `rule-validation.ts:11`), `days?` (0-6) | gère les plages traversant minuit (`rules-engine.service.ts:179-186`) |
| `PRESENCE` | `field?` (défaut `'presence'`), `expected?` (`ABSENT`/`PRESENT`), `zoneId?`, `durationMinutes?` | ⚠️ `durationMinutes` **non implémenté** (voir §4.4) |
| `EVENT` | `eventName` (chaîne non vide) | comparaison stricte avec `measurement.eventName` |
| `AND` / `OR` | `criteria[]` (récursif, profondeur max 10 — `rule-validation.ts:12`, `rules-engine.service.ts:5`) | correspond au `RuleType.COMBINED` |

### 1.3 Grammaire des actions

Type `RuleAction` (`rules-engine.service.ts:12-19`), validation `rule-validation.ts:85-108` :

| Champ | Valeurs |
|---|---|
| `type` | `SWITCH_OFF` \| `ALERT` \| `MAINTAIN` |
| `targetType?` | `CIRCUIT` (défaut) \| `ZONE` |
| `targetId?` | circuitId ou zoneId selon `targetType` |
| `payload?` | libre — pour `ALERT` : `{ level?: AlertLevel, message?: string }` (`measurement.listener.ts:398-400`) |

Il n'existe **pas** d'action `SWITCH_ON` déclenchable par règle.

Exemple réel seedé (`prisma/seed.ts:421-428`) :
```json
conditions: { "type":"THRESHOLD", "field":"power", "operator":">", "value":500, "zoneId":"<uuid salle>" }
actions:    [ { "type":"SWITCH_OFF", "targetId":"<uuid circuit clim>" },
              { "type":"ALERT", "payload": { "level":"CRITICAL", "message":"..." } } ]
```

### 1.4 Cycle de vie (endpoints & services)

Contrôleur `rules.controller.ts:17-50` (tous derrière `JwtAuthGuard`) :

| Endpoint | Service | Comportement |
|---|---|---|
| `POST /rules` | `createRule` (`rules.service.ts:19-42`) | valide conditions+actions, crée, audite `RULE_CREATED` |
| `GET /rules` | `getAllRules` (`rules.service.ts:44-48`) | ⚠️ règles actives de **tous** les bâtiments (pas de scope) |
| `GET /rules/:id` | `getRuleById` (`:50-52`) | renvoie aussi les règles désactivées |
| `PATCH /rules/:id` | `updateRule` (`:54-77`) | valide si fournis, purge l'état mémoire (`clearState`, ligne 66) |
| `DELETE /rules/:id` | `disableRule` (`:79-95`) | ⚠️ **soft-disable** (`isActive=false`), jamais de suppression physique |

Deuxième voie de création : le **Smart Supervisor**. L'approbation d'une recommandation
appelle `rulesService.createRule` / `updateRule` / `disableRule`
(`supervisor-recommendations.service.ts:92, 110, 123`). Le `ruleType` y est **déduit**
du `conditions.type` via `CONDITION_TYPE_TO_RULE_TYPE` (`:22-29`) — confirmation que la
colonne est purement informative.

Les DTOs (`dto/create-rule.dto.ts`, `dto/update-rule.dto.ts`) ne valident que la forme
extérieure (`@IsObject`/`@IsArray`) ; la vraie validation grammaticale est dans
`rule-validation.ts`, appelée par le service.

---

## 2. Application (évaluation)

### 2.1 Qui évalue, et quand

Un seul évaluateur : **`RuleEngineService.evaluateMeasurement()`**
(`rules-engine.service.ts:71-134`). Deux points de déclenchement, tous deux dans
`MeasurementListener` :

1. **À chaque mesure MQTT** (`powerlens/+/+/measure`) — fin de `handleMeasurement`,
   `measurement.listener.ts:358-359`.
2. **À chaque événement MQTT** (`powerlens/+/+/event`) — `measurement.listener.ts:137`.

**Il n'y a aucun autre déclencheur.** En particulier, **aucun cron/tick périodique**
pour les règles (les seuls `@Cron` du projet sont billing `billing-cron.service.ts:11`
et supervisor `supervisor-analysis.service.ts:34`). Conséquence importante : une règle
`SCHEDULE` ne se déclenche **que si du trafic entre** (mesure ou événement). Ça
fonctionne en pratique parce que l'ESP/simulateur publie toutes les 5 s — mais si aucune
source ne publie, une extinction programmée ne partira jamais (voir §4.3).

### 2.2 Données utilisées pour décider

L'évaluation s'appuie **exclusivement** sur :

| Donnée | Source | Référence |
|---|---|---|
| La **mesure/événement instantané** (`power`, `presence`, `eventName`, `zoneId`… champ libre) | payload MQTT courant | `rules-engine.service.ts:21-31, 161-216` |
| L'**horloge du serveur** (`new Date()`, heure **locale** du process Node) | serveur backend | `:172-174` |
| Les **règles actives du bâtiment** | 1 requête DB par évaluation | `:96-101` |
| La résolution `zoneId → buildingId` si absent du topic | DB (rare : injecté par le listener) | `:84-90` |

**Jamais utilisé pour décider** : l'historique `EnergyMeasurement`, l'état d'autres
devices, des agrégats/moyennes. Aucune requête d'historique n'existe dans le moteur
(le commentaire `:206-209` documente explicitement que la fenêtre glissante
`durationMinutes` est hors scope pour cette raison). L'analyse historique existe
ailleurs (Supervisor) mais produit des *recommandations*, pas des décisions de règle.

La DB est en revanche sollicitée **après** décision, pour exécuter les actions
(résolution des circuits d'une zone, du device d'un circuit — §2.3).

### 2.3 Ce que produit une règle déclenchée

`evaluateMeasurement` retourne des `RuleDecision[]` (`{ruleId, actions}`), exécutées par
`MeasurementListener.handleRuleDecisions` (`measurement.listener.ts:362-435`) :

- **`SWITCH_OFF` ciblant un circuit** : commande MQTT `OFF` publiée sur
  `powerlens/{building}/{deviceUid}/command/{circuitId}` (résolution DB du device,
  `publishCommand`, `:441-476`) + suivi ACK (`commandTracker.track`) + audit
  `SWITCH_OFF_SENT` (`:469-475`).
- **`SWITCH_OFF` ciblant une zone** : requête DB des circuits `isActive && !isCritical`
  de la zone (`:379-381` — les circuits critiques ne sont **jamais** coupés par une
  action de zone), puis une commande par circuit.
- **`ALERT`** : `AlertsService.createAndPublish` (`alerts.service.ts:89-119`) =
  ligne `Alert` en base + WebSocket `alert` + publication MQTT sur le topic `alert`
  du device (fire-and-forget) + audit `ALERT_PUBLISHED`.
- **`MAINTAIN`** : **no-op volontaire**, uniquement journalisé (`:410-421`).

Chaque action est exécutée sous `Promise.allSettled` (un échec n'empêche pas les autres,
`:372, 425-433`) et tout le flux est dans le `try/catch` du listener.

### 2.4 État interne : oui, et il est en mémoire

Le moteur **a une mémoire**, entièrement en RAM du process (`rules-engine.service.ts:66-69`) :

- **Détection de front montant** (`ruleStates: Map`) : l'action ne part que sur la
  transition FALSE→TRUE de la condition ; tant qu'elle reste vraie, pas de re-tir ;
  elle se réarme quand la condition redevient fausse (`:118-130`).
- **Cooldown** de **30 s codé en dur** (`COOLDOWN_MS`, `:69, 114-116`) par couple
  (zone|circuit, règle).
- Clé d'état : `` `${zoneId ?? circuitId ?? 'building'}-${ruleId}` `` (`:110`) — l'état
  est **par zone**, pas par règle (conséquence surprenante en §4.7).
- `clearState(ruleId)` purge ces Maps à la modification/désactivation d'une règle
  (`:136-144`, appelée depuis `rules.service.ts:66, 85`).

⚠️ Cet état est **perdu à chaque redémarrage** du backend (y compris chaque reload du
mode `--watch`) et non partagé entre instances — le commentaire `:66` dit « à migrer
vers Redis pour la prod ».

---

## 3. Cartographie de dépendance (autonomie ESP possible ?)

Rappel de lecture : c'est le **`conditions.type`** qui fait foi (pas `Rule.ruleType`).
Le tableau classe chaque type de **condition**, puis chaque type d'**action** — car une
règle autonome doit avoir SES conditions **et** SES actions auto-suffisantes.

### 3.1 Conditions

| Type | Catégorie | Données requises | Justification (code) |
|---|---|---|---|
| `THRESHOLD` | **Auto-suffisant** ✅ | le champ visé de la **mesure courante** (+ `zoneId` de scoping) | Comparaison pure sur `measurement[field]` (`rules-engine.service.ts:161-169`), aucune requête DB, aucun historique. Un boîtier qui produit la mesure de sa zone a tout sous la main. *Nuance* : sans `zoneId`, la condition s'applique aux mesures de **toutes** les zones du bâtiment (`:162` ne filtre que si `zoneId` présent) — sur un boîtier isolé, seule sa propre zone serait couverte. |
| `SCHEDULE` | **Auto-suffisant** ✅ (avec réserve) | l'heure + le jour courants | Pure fonction de l'horloge (`:172-186`). L'ESP a déjà NTP (`code_couloir-2.ino`, `configTime` dans `setup()`). **Réserve** : côté backend l'évaluation n'a lieu qu'à l'arrivée d'une mesure (§2.1) ; un boîtier autonome devrait l'évaluer sur tick périodique — c'est un changement de déclencheur, pas de données. |
| `PRESENCE` | **Auto-suffisant** ✅ (dans sa forme implémentée) | le booléen `presence` de la mesure courante | État instantané uniquement (`:210-216`) ; le PIR est local au boîtier. La variante `durationMinutes` (absence prolongée) n'est **pas implémentée** (`:207-209`) — si elle l'était côté backend via l'historique, elle resterait implémentable localement avec un simple chronomètre embarqué. |
| `EVENT` | **Ça dépend de la provenance** ⚠️ | l'`eventName` d'un message `event` | Comparaison pure (`:203-204`)… mais le backend écoute `powerlens/+/+/event` de **tous** les devices (`measurement.listener.ts:123`). Auto-suffisant si l'événement est produit par le boîtier lui-même ; **dépendant du backend** (routage inter-devices) si l'événement vient d'un autre module. |
| `AND` / `OR` | **Hérite de ses feuilles** | récursif | (`:190-199`). Auto-suffisant ssi toutes les feuilles le sont. Attention aux mixtes (ex. `AND[THRESHOLD zone A, THRESHOLD zone B]` : multi-zones = multi-boîtiers potentiels). *Nuance* : même 100 % locale, une condition AND mêlant SCHEDULE et THRESHOLD n'est évaluée qu'à l'arrivée d'une mesure (les feuilles sont évaluées sur le même instantané, `:192-199`). |

### 3.2 Actions

| Action | Catégorie | Données requises | Justification |
|---|---|---|---|
| `SWITCH_OFF` (`targetType=CIRCUIT`) | **Auto-suffisant si le circuit est au boîtier** ✅ | mapping circuitId→relais | Le firmware possède déjà ce mapping (`circuits[]` dans le `.ino`). Côté backend la résolution device passe par la DB (`measurement.listener.ts:447-459`), mais localement elle est triviale. **Dépendant** si le circuit appartient à un autre module. |
| `SWITCH_OFF` (`targetType=ZONE`) | **Dépendant du backend** ❌ (partiellement) | liste des circuits de la zone **+ drapeaux `isCritical`** | La résolution se fait en DB (`:379-381`). Un boîtier connaît les circuits de SA zone, mais `isCritical` **n'existe qu'en base** — le firmware ne l'a pas. Sans ce drapeau, la sémantique « ne jamais couper un circuit critique » n'est pas reproductible localement. |
| `ALERT` | **Dépendant du backend** ❌ | création `Alert` en DB, WebSocket, audit | Tout le chemin (`alerts.service.ts:89-119`) est côté serveur. Un mode dégradé local (buzzer) existe déjà dans le firmware, mais ce n'est pas l'action `ALERT` du moteur (pas de persistance, pas de diffusion app). |
| `MAINTAIN` | **Auto-suffisant** ✅ (trivialement) | aucune | No-op journalisé (`measurement.listener.ts:415-421`). |

### 3.3 Synthèse pour la future délégation

Le noyau **conditions THRESHOLD / SCHEDULE / PRESENCE (instantanée) / AND / OR portant sur
la zone du boîtier + action SWITCH_OFF sur ses propres circuits** est intégralement
décidable en local — c'est d'ailleurs le profil des règles seedées « école »
(cf. `prisma/seed.ts`, ex. lignes 421-448 : seuil zone Salle → coupure clim Salle).
Les vraies dépendances dures au backend : `isCritical` (zone), l'action `ALERT`
complète, les événements inter-devices, et la reproduction de **l'état** (front
montant + cooldown 30 s, §2.4) qu'il faudrait réimplémenter à l'identique sur l'ESP
pour un comportement cohérent en ligne/hors ligne.

---

## 4. Écarts et angles morts

### 4.1 `Rule.ruleType` n'est jamais lu par le moteur
Le moteur ne regarde **que** `conditions.type` (`rules-engine.service.ts:106-108, 159`).
`ruleType` est décoratif : il peut diverger des conditions sans aucun effet. Le
Supervisor le *déduit* d'ailleurs des conditions (`supervisor-recommendations.service.ts:22-29, 91`).
`COMMUNICATION-ESP-APP.md` (§5.3 « le moteur de règles (`RuleType.EVENT`) ») et l'énoncé
de cet audit (« `RuleType.MEASUREMENT` ») laissent penser que le type pilote le
dispatch — c'est faux, et **`MEASUREMENT` n'existe pas** dans l'enum
(`schema.prisma:41-47` : SCHEDULE, THRESHOLD, PRESENCE, EVENT, COMBINED).

### 4.2 L'action `MAINTAIN` est absente de la documentation
`README.md` et `COMMUNICATION-ESP-APP.md` ne mentionnent que `SWITCH_OFF`/`ALERT` ; le
code accepte et traite aussi `MAINTAIN` (`rule-validation.ts:10`,
`measurement.listener.ts:415-421`).

### 4.3 Les règles `SCHEDULE` ne tiennent que par le trafic
Aucun tick périodique (§2.1). Si l'ESP est hors ligne **et** le simulateur désactivé,
« Extinction nocturne 19:30 » ne se déclenchera jamais à 19:30 — elle se déclenchera à
la première mesure reçue *pendant* la plage. De plus, l'heure comparée est l'heure
**locale du serveur** (`new Date()`, `:172-174`) : le comportement dépend du fuseau du
process Node, non configuré explicitement (fragile en déploiement).

### 4.4 `PRESENCE.durationMinutes` : champ fantôme
Déclaré dans le type (`rules-engine.service.ts:50`), **accepté silencieusement** par la
validation (`rule-validation.ts:58-65` ne le vérifie même pas), **ignoré** par le moteur
(`:206-216`). Une règle « absence prolongée de 15 min » créée aujourd'hui se comporte
comme « absence instantanée », sans avertissement.

### 4.5 État en mémoire (front montant + cooldown)
Perdu à chaque restart/reload (`--watch` !) et non partagé multi-instances
(`rules-engine.service.ts:66-69`). Après un redémarrage, une condition déjà vraie
re-déclenche l'action (le front remonte de zéro). `COOLDOWN_MS = 30 s` codé en dur.

### 4.6 Validation non rétroactive
`rule.conditions` sort de la DB casté directement (`as unknown as RuleCondition`,
`:107`). Seules les écritures passent par `rule-validation.ts`. Une règle historique ou
modifiée hors API n'est jamais revalidée ; un arbre trop profond fait même lever une
`BadRequestException` **pendant l'évaluation** (`:153-157`) — exception HTTP dans un
contexte MQTT (capturée par le try/catch du listener, mais sémantiquement surprenante).

### 4.7 Front montant par zone, pas par règle
La clé d'état inclut la zone (`:110`). Une règle de bâtiment **sans** `zoneId` est
évaluée sur les mesures de **chaque** zone : elle peut donc se déclencher jusqu'à N fois
(une par zone publiante, chacune avec son cooldown propre). Sur ce projet, un même
module publie 3 zones → jusqu'à 3 tirs de la « même » règle. À garder en tête pour
reproduire le comportement ailleurs.

### 4.8 Divers
- `GET /rules` non scopé par bâtiment (`rules.service.ts:44-48`) alors que le moteur
  scope strictement (`rules-engine.service.ts:96-101`). Anodin avec 1 bâtiment seedé.
- `DELETE /rules/:id` = désactivation douce, pas de suppression (`rules.service.ts:79-95`).
- `THRESHOLD` avec `==` sur des mesures flottantes (`:167`) : quasi jamais vrai en
  pratique — piège d'UX plus que bug.
- 1 requête `rule.findMany` **par mesure reçue** (`:96-101`), soit une requête toutes
  les 5 s par zone publiée — pas de cache. Acceptable à cette échelle, à surveiller.
- **Aucun test unitaire du moteur** : les seuls specs sont `app.controller.spec.ts` et
  `provider-switcher.service.spec.ts`.
- Surprenant : deux fichiers bureautiques dans le code source —
  `src/modules/rules/Power Lens – Module Moteur De Règles (readme).pdf` et
  `readme_complémentaire.docx` (non lus dans cet audit ; s'ils font foi
  fonctionnellement, ils devraient être en `docs/`).

### 4.9 Incertitudes assumées
- Le routage MQTT interne de `AlertsService.publishMqtt` (résolution du device cible
  par zone) n'a pas été lu en détail — vérifié seulement jusqu'à l'appel
  (`alerts.service.ts:105-114`) ; `docs/mqtt.md` le décrit, non contre-vérifié ici.
- Les documents PDF/DOCX du module rules n'ont pas été ouverts ; d'éventuels écarts
  spec ↔ code qu'ils contiendraient ne sont pas couverts.
