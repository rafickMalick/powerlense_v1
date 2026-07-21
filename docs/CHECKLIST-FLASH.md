# Checklist de flash — migration esp-mqtt (à dérouler le jour du flash)

> Ce document remplace les tests matériels que je n'ai **pas pu exécuter** (pas d'ESP32
> disponible au moment de la migration). Déroule les étapes **dans l'ordre**, moniteur série
> à **115200 bauds**. Pour chaque étape : le **log attendu au caractère près** (les `%s`/`%d`
> sont remplacés par les valeurs réelles ; les UUID/pins ci-dessous sont ceux du module
> **Couloir Étage 1** — cf. `COMMUNICATION-ESP-APP.md` §10, adapte pour la salle).
>
> Prérequis : broker + backend démarrés (`./start.sh`), PC et ESP sur le même Wi-Fi 2,4 GHz,
> `MQTT_HOST` = IP du PC. Garde un terminal ouvert :
> `docker exec powerlens-mqtt mosquitto_sub -h localhost -p 1883 -t "powerlens/#" -v`

Contexte de la migration : la couche MQTT est passée de **PubSubClient** à **esp-mqtt**
(client natif ESP-IDF). Un seul log a changé de format : l'échec de connexion (voir étape 8).
Tous les autres logs opérationnels sont **identiques** à l'avant-migration.

---

## 1. Boot & connexion → `DEVICE_ONLINE`

**Action** : flasher, ouvrir le moniteur série, reset.

**Logs série attendus (dans l'ordre)** :
```
=== PowerLens ESP32 — MODULE COULOIR ===
Broker MQTT : 172.30.104.207:1883
...
Connexion WiFi [Technocamon19]....
WiFi OK
Sync NTP... OK
Connexion MQTT [172.30.104.207:1883]...
=== Systeme demarre — Publication des 3 zones toutes les 5 s ===
MQTT OK
[STATUS MQTT] online=true retained -> powerlens/363034de-123c-4471-83d6-b7a4dcc34ff8/ESP32-PL-001/status
Abonne au topic de commande (wildcard) : powerlens/363034de-123c-4471-83d6-b7a4dcc34ff8/ESP32-PL-001/command/#
Abonne au topic d'alerte : powerlens/363034de-123c-4471-83d6-b7a4dcc34ff8/ESP32-PL-001/alert
```
> ⚠️ **Nouveauté esp-mqtt** : `MQTT OK` et les `Abonne…` arrivent **après** `=== Systeme demarre ===`,
> car la connexion est asynchrone (elle survient dans la tâche esp-mqtt, pas dans `setup()`).
> C'est normal et attendu.

**Backend** (`backend.log`) :
```
[AUDIT] HARDWARE DEVICE_ONLINE DEVICE#ESP32-PL-001
```
**App** : indicateur « Temps réel » (plus « ESP hors ligne »).

✅ **OK si** : `MQTT OK` + `[STATUS MQTT] online=true retained` apparaissent, et le backend logue `DEVICE_ONLINE`.

---

## 2. Flux `measure` toutes les 5 s

**Attendu série**, une ligne toutes les 5 s :
```
[STATUT] WiFi=CONNECTE | MQTT=CONNECTE
```
**Terminal `mosquitto_sub`** : un message toutes les 5 s sur
`powerlens/363034de-…/ESP32-PL-001/measure`.

**App** : les mesures de la zone Couloir Étage 1 se mettent à jour.

✅ **OK si** : `[STATUT] … MQTT=CONNECTE` toutes les 5 s + mesures visibles côté broker et app.

---

## 3. Payload `measure` complet avec `circuits[]` (buffer 1024) — **le test clé de la migration**

> Motif : PubSubClient avait un buffer de 256 o et **échouait en silence** au-delà. Le payload
> `measure` du paquet possédé (avec le tableau `circuits[]` et ses UUID) dépasse 256 o.

**Terminal `mosquitto_sub`** sur le topic `measure` — le message du paquet **Couloir** doit
contenir le tableau `circuits` **complet et non tronqué** :
```json
{"zoneId":"ea4e2852-…","measuredAt":"…","voltage":…,"current":…,"power":…,"energyKwh":…,
 "frequency":…,"powerFactor":…,"presence":…,"temperature":…,
 "circuits":[{"circuitId":"3da50cd3-…","isActive":true},
             {"circuitId":"ac85ac61-…","isActive":true},
             {"circuitId":"dfb19deb-…","isActive":true}]}
```
Mesure de contrôle : `docker exec powerlens-mqtt mosquitto_sub -h localhost -p 1883 -t "powerlens/+/+/measure" -v | head`,
puis vérifier la **longueur** du JSON (> 256 o) et la présence des 3 entrées `circuits`.

✅ **OK si** : le JSON arrive **entier** (3 circuits présents, JSON valide, non coupé).
❌ Si tronqué/absent → `buffer.out_size` mal pris en compte (à investiguer).

---

## 4. Commande depuis l'app → relais + ACK

**Action** : basculer un circuit (ex. Clim, pin 37) dans l'app.

**Série attendu** :
```
[MQTT] Commande 'OFF' appliquee : Charge 3 - Clim Couloir (pin 37)
[ACK MQTT] topic=powerlens/363034de-123c-4471-83d6-b7a4dcc34ff8/ESP32-PL-001/ack/dfb19deb-5afb-4994-9875-3f902ada8bdd status=SUCCESS
```
(puis `'ON'` au rallumage). **Le relais physique doit commuter.**

**App** : l'interrupteur passe de « en attente » à confirmé (`circuit:status`).

✅ **OK si** : le relais commute **une fois**, les 2 lignes série apparaissent, l'app confirme.
> Note migration : l'ACK est désormais émis via `esp_mqtt_client_enqueue()` (non bloquant)
> depuis le handler d'événements — comportement observable identique.

---

## 5. Débranchement brutal → `DEVICE_OFFLINE` via LWT

**Action** : couper l'alimentation de l'ESP (ou `kill` de l'alim USB) — **sans** déconnexion propre.

**Backend** (`backend.log`), après un délai **borné par le keepalive** (~1,5 × 15 s ≈ **22 s**) :
```
[AUDIT] HARDWARE DEVICE_OFFLINE DEVICE#ESP32-PL-001
```
**App** : bascule « ESP hors ligne », commandes grisées.

✅ **OK si** : `DEVICE_OFFLINE` apparaît **tout seul** (LWT), sans qu'on touche au backend, en ≤ ~25 s.
> Rappel : le délai vient du keepalive (`MQTT_KEEPALIVE_S = 15`), pas d'un timer applicatif.

---

## 6. Retained : statut immédiat pour un client tardif

**Action** (ESP encore éteint après l'étape 5) : lancer un abonné **neuf** :
```
docker exec powerlens-mqtt mosquitto_sub -h localhost -p 1883 \
  -t "powerlens/363034de-123c-4471-83d6-b7a4dcc34ff8/ESP32-PL-001/status" -v -C 1
```
**Attendu** (reçu **immédiatement**, sans attendre) :
```
powerlens/363034de-…/ESP32-PL-001/status {"online":false}
```
Puis, ESP rallumé, le même test doit renvoyer `{"online":true,…}`.

✅ **OK si** : le dernier statut connu est reçu instantanément (rôle du retained).

---

## 7. Coupure Wi-Fi puis retour → reconnexion **automatique**, sans reboot

**Action** : couper le Wi-Fi (éteindre le hotspot ~20 s) puis le rétablir. **Ne pas** resetter l'ESP.

**Série attendu** :
```
MQTT deconnecte — reconnexion automatique...
```
(pendant la coupure, éventuellement des lignes `[STATUT] … MQTT=DECONNECTE`), puis au retour :
```
MQTT OK
[STATUS MQTT] online=true retained -> powerlens/…/status
Abonne au topic de commande (wildcard) : powerlens/…/command/#
Abonne au topic d'alerte : powerlens/…/alert
```
> ⚠️ **La bannière `=== PowerLens ESP32 — MODULE COULOIR ===` ne doit PAS réapparaître** :
> sa présence signifierait un **reboot**, pas une reconnexion. C'est esp-mqtt qui reconnecte
> seul, sans passer par `setup()`.

✅ **OK si** : reconnexion + re-souscription + `online:true` **sans** reboot (pas de bannière de boot).

---

## 8. (Optionnel) Échec de connexion → nouveaux logs d'erreur

Si le broker est injoignable au démarrage (ex. mauvais `MQTT_HOST`), le log a **changé** vs
PubSubClient (`MQTT ECHEC (état=%d)`). Selon la cause :
- **Erreur transport** (broker éteint / IP fausse / TCP) :
  ```
  MQTT ERREUR transport (errno=<N>) — reconnexion automatique
  ```
- **Refus du broker** (identifiants / protocole) :
  ```
  MQTT REFUS broker (connect_return_code=<N>) — reconnexion automatique
  ```
Cette distinction (transport vs broker) remplace la ligne unique de PubSubClient et servira
au sprint TLS. La reconnexion est **automatique** (pas de reboot, pas de blocage du `loop()`).

---

## 9. Non-régression bascule simulateur ↔ MQTT

**Backend** : à la première mesure réelle de l'ESP →
```
[AUDIT] SYSTEM PROVIDER_SWITCHED_TO_MQTT SYSTEM
```
À l'extinction de l'ESP (après timeout) → `PROVIDER_SWITCHED_TO_SIMULATOR`.

✅ **OK si** : la bascule fonctionne comme avant la migration.

---

## Récapitulatif des changements observables (vs avant-migration)

| Comportement | Avant (PubSubClient) | Après (esp-mqtt) |
|---|---|---|
| `MQTT OK` / `Abonne…` | dans `setup()`/`loop()`, synchrone | **après** `=== Systeme demarre ===` (asynchrone) — étape 1 |
| Échec de connexion | `MQTT ECHEC (état=%d)` | `MQTT ERREUR transport (errno=…)` **ou** `MQTT REFUS broker (…)` — étape 8 |
| Reconnexion | boucle manuelle dans `loop()` | gérée par esp-mqtt (tâche dédiée) — étape 7 |
| Tout le reste (`[STATUT]`, `[MQTT] … (pin N)`, `[ACK MQTT]`, `[STATUS MQTT]`, `[ALERTE MQTT]`, LWT, retained, measure 5 s) | — | **identique** |
