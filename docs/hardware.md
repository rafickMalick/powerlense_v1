# Guide d'intégration ESP32 — PowerLens

Ce document est destiné à l'équipe hardware. Il décrit pas à pas comment connecter un ESP32 au système PowerLens : connexion au broker MQTT, découverte des identifiants, formats de payload JSON à transmettre.

> **V4 — changement de modèle.** Les mesures électriques/environnementales sont désormais rattachées à une **zone** (Salle, Couloir, ou départ général du Bâtiment), pas à un circuit précis : un module ESP32 mesure l'arrivée électrique globale de sa zone (un capteur de puissance, éventuellement un capteur température/humidité et un capteur de présence pour les zones ROOM/CORRIDOR), et publie sous un `zoneId`. Les circuits restent individuellement **commandables** (relais ON/OFF), mais ne portent plus leur propre mesure.
>
> **V6/V8 — firmwares séparés par module.** Depuis V6, il n'y a plus un firmware unique : [`../code_salle.ino`](../code_salle.ino) (ESP32-PL-001, zone ROOM réelle, PZEM004T + SHT35 + PIR + 4 relais) et [`../code_couloir/code_couloir.ino`](../code_couloir/code_couloir.ino) (ESP32-PL-002, zone CORRIDOR réelle pour la température seulement, 2 relais) sont les deux références à jour. Chaque module publie aussi, en secours, une estimation simulée des zones qu'il ne possède pas. Depuis V8, chaque module inclut également l'état de ses propres relais (`circuits`, §5.1) et publie des zéros pour sa zone si toutes ses charges sont éteintes.

---

## 1. Prérequis

### 1.1 Matériel

| Composant | Rôle |
|---|---|
| ESP32 (WROOM-32 ou équivalent) | Unité de mesure (par zone) et de contrôle (par circuit) |
| Capteur de puissance (ex. PZEM004T) | Mesure V/I/P/E/Hz/PF de l'arrivée électrique de la **zone** (une mesure globale, pas une par circuit) |
| Relais 5 V (ou 3,3 V) | Coupure/activation de **chaque circuit** (un relais par circuit piloté) |
| Capteur de température (DS18B20, SHT35, DHT22…) | **ROOM uniquement** — mesure ambiante de la zone |
| Capteur de luminosité (BH1750, LDR…) | Zones **ROOM et CORRIDOR** — niveau d'éclairement ambiant de la zone |
| Capteur de présence (PIR HC-SR501…) | Zones **ROOM et CORRIDOR** — détection d'occupation de la zone |
| PC de démo | Héberge le broker MQTT (Mosquitto, Docker) et l'API PowerLens — **pas de Raspberry Pi** dans le déploiement actuel, l'ESP32 et le PC partagent le même réseau WiFi |

### 1.2 Bibliothèques Arduino

Installer via le gestionnaire de bibliothèques Arduino IDE ou PlatformIO :

| Bibliothèque | Version testée | Usage |
|---|---|---|
| `PubSubClient` | ≥ 2.8 | Client MQTT |
| `ArduinoJson` | ≥ 7.0 | Sérialisation JSON |
| `WiFi.h` | intégrée ESP32 | Connexion réseau |
| `time.h` | intégrée ESP32 | Horodatage NTP |

### 1.3 Enregistrement du Device en base de données

Avant de flasher l'ESP32, le Device doit être enregistré dans PowerLens via l'API REST (une seule fois, par un administrateur) :

```http
POST /devices
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "name": "ESP32 Couloir Nord",
  "deviceUid": "ESP32-PL-001",
  "buildingId": "bld-01xxxxxxxxxxxxxxxx"
}
```

Le champ **`deviceUid`** est la clé que l'ESP32 utilisera dans tous ses topics MQTT. Choisissez un nom stable et unique par bâtiment (ex. `ESP32-PL-001`, `ESP32-PL-002`…).

---

## 2. Connexion au broker MQTT

| Paramètre | Valeur |
|---|---|
| Host | Adresse IP du Raspberry Pi sur le réseau local (ex. `192.168.1.100`) |
| Port | `1883` (TCP, pas de TLS en environnement de démo) |
| Authentification | Aucune (à ajouter avant mise en production) |
| Client ID | `deviceUid` (ex. `"ESP32-PL-001"`) — doit être unique sur le broker |
| Keep-alive | 60 s (valeur par défaut de PubSubClient) |
| QoS mesures | 0 (fire-and-forget — acceptable pour des mesures fréquentes) |
| QoS commandes | 1 recommandé (au moins une fois — garantit la réception) |
| Reconnexion | Automatique — relancer `connectMqtt()` dans la boucle principale si `!mqtt.connected()` |

> **Broker down.** Si le Raspberry Pi est injoignable, l'ESP32 doit continuer à mesurer localement. Il republiera les mesures en attente dès la reconnexion (à implémenter selon la mémoire disponible).

---

## 3. Identifiants nécessaires

L'ESP32 a besoin de deux identifiants principaux, plus un `zoneId` par mesure et un `circuitId` par relais piloté :

| Identifiant | Source | Exemple |
|---|---|---|
| `buildingId` | `GET /buildings` → champ `id` | `"bld-01xxxxxxxxxxxxxxxx"` |
| `deviceUid` | Défini lors de `POST /devices` | `"ESP32-PL-001"` |
| `zoneId` | `GET /zones?buildingId=...&type=ROOM\|CORRIDOR` → champ `id` | `"zn-01xxxxxxxxxxxxxxxx"` |
| `circuitId` | `GET /zones/:zoneId/circuits` → champ `id` (un par relais piloté) | `"crc-01xxxxxxxxxxxxxxxx"` |

### 3.1 Récupérer les identifiants

```bash
# Lister les bâtiments
curl http://192.168.1.100:3000/buildings

# Lister les zones mesurables d'un bâtiment (ROOM/CORRIDOR)
curl "http://192.168.1.100:3000/zones?buildingId=bld-01xxx"

# Lister les circuits pilotables d'une zone (relais à câbler)
curl http://192.168.1.100:3000/zones/:zoneId/circuits
```

Le champ `id` d'une zone (type `ROOM`, `CORRIDOR`, ou `BUILDING` pour le module posé sur le départ général) est le `zoneId` à publier dans chaque mesure. Le champ `id` d'un circuit est le `circuitId` à utiliser dans les topics `command`/`ack` de son relais.

### 3.2 Stockage sur l'ESP32

Stockez ces identifiants en dur dans le firmware (pour un prototype) ou en EEPROM/SPIFFS/NVS pour une configuration modifiable sans recompilation. Le déploiement type a 3 modules mesurables (Salle, Couloir, départ général du Bâtiment) : chaque module (`code_salle.ino`/`code_couloir.ino`) déclare les **trois** `zoneId`, mais ne mesure réellement que la zone qu'il possède — il publie une estimation simulée des deux autres en secours (cf. §6) tant que leurs modules dédiés ne sont pas en ligne. Le tableau `circuits[]` liste les relais que **ce** module pilote physiquement :

```cpp
// Configuration à adapter par ESP32
const char* BUILDING_ID      = "bld-01xxxxxxxxxxxxxxxx"; // Building.id
const char* DEVICE_UID       = "ESP32-PL-001";
const char* ZONE_ROOM_ID     = "zn-01xxxxxxxxxxxxxxxx";   // Salle 1 (réelle pour ce module)
const char* ZONE_CORRIDOR_ID = "zn-02xxxxxxxxxxxxxxxx";   // Couloir 1 (secours, simulé)
const char* ZONE_BUILDING_ID = "zn-03xxxxxxxxxxxxxxxx";   // Bâtiment — départ général (secours, simulé)

struct CircuitBinding { const char* id; const char* label; uint8_t pin; bool state; };
CircuitBinding circuits[] = {
  { "crc-01xxxxxxxxxxxxxxxx", "Charge 1 - Eclairage", 10, true }, // relais LIGHTING
  { "crc-02xxxxxxxxxxxxxxxx", "Charge 2 - Prises",    11, true }, // relais SOCKET
};
```

### 3.3 Catalogue des canaux d'une zone

Pour connaître les grandeurs mesurables d'une zone et leurs unités :

```bash
curl http://192.168.1.100:3000/zones/:zoneId/channels
```

Réponse exemple (zone ROOM) :

```json
[
  { "id": "ch-1", "type": "voltage",     "unit": "V",   "mqttTopic": "powerlens/bld-01.../ESP32-PL-001/measure" },
  { "id": "ch-2", "type": "current",     "unit": "A",   "mqttTopic": "..." },
  { "id": "ch-3", "type": "power",       "unit": "W",   "mqttTopic": "..." },
  { "id": "ch-4", "type": "energy",      "unit": "kWh", "mqttTopic": "..." },
  { "id": "ch-5", "type": "frequency",   "unit": "Hz",  "mqttTopic": "..." },
  { "id": "ch-6", "type": "powerFactor", "unit": "",    "mqttTopic": "..." },
  { "id": "ch-7", "type": "luminosity",  "unit": "lux", "mqttTopic": "..." },
  { "id": "ch-8", "type": "presence",    "unit": "bool","mqttTopic": "..." },
  { "id": "ch-9", "type": "temperature", "unit": "°C",  "mqttTopic": "..." }
]
```

`presence` apparaît pour les zones `ROOM` et `CORRIDOR` ; `temperature` uniquement pour `ROOM`. `GET /circuits/:circuitId/channels` reste disponible par compatibilité et résout automatiquement vers les canaux de la zone du circuit.

---

## 4. Schéma de topics MQTT

Tous les topics suivent la structure `powerlens/{buildingId}/{deviceId}/...`.

> **Important :** `{deviceId}` correspond au champ `Device.deviceUid` (la chaîne lisible `ESP32-PL-001`), **pas** à l'UUID interne Prisma.

| Usage | Topic | Direction |
|---|---|---|
| Mesure | `powerlens/{buildingId}/{deviceId}/measure` | ESP32 → Backend |
| Commande | `powerlens/{buildingId}/{deviceId}/command/{circuitId}` | Backend → ESP32 |
| Accusé de réception | `powerlens/{buildingId}/{deviceId}/ack/{circuitId}` | ESP32 → Backend |
| Événement | `powerlens/{buildingId}/{deviceId}/event` | ESP32 → Backend |

**Exemple concret** avec `buildingId = "bld-abc"`, `deviceUid = "ESP32-PL-001"`, `circuitId = "crc-xyz"` :

| Topic | Valeur |
|---|---|
| Mesure | `powerlens/bld-abc/ESP32-PL-001/measure` |
| Commande | `powerlens/bld-abc/ESP32-PL-001/command/crc-xyz` |
| ACK | `powerlens/bld-abc/ESP32-PL-001/ack/crc-xyz` |
| Événement | `powerlens/bld-abc/ESP32-PL-001/event` |

**Un ESP32 qui pilote plusieurs relais** publie sa mesure de zone sur le **même topic `/measure`** (un seul `zoneId` par payload — un module mesure une seule zone), en indiquant le `zoneId`. Il s'abonne à **un topic `/command/{circuitId}` par circuit** qu'il contrôle (relais indépendants de la zone mesurée).

---

## 5. Modèles de données (payloads JSON)

### 5.1 Mesure — ESP32 → Backend

Publié sur `powerlens/{buildingId}/{deviceId}/measure`.

#### Champs obligatoires

| Champ | Type | Description |
|---|---|---|
| `zoneId` | string (UUID) | Identifiant de la zone mesurée (ROOM ou CORRIDOR) |
| `measuredAt` | string (ISO 8601 UTC) | Horodatage de la mesure — ex. `"2026-06-30T10:15:30.000Z"` |

`circuitId` n'est **plus** un champ de mesure (les circuits ne sont plus mesurés individuellement) ; il n'apparaît que dans les topics `command`/`ack`.

#### Champs recommandés (mesures électriques de base)

| Champ | Type | Unité | Description |
|---|---|---|---|
| `voltage` | number | V | Tension efficace (RMS) de l'arrivée de la zone |
| `current` | number | A | Courant efficace (RMS) de l'arrivée de la zone |
| `power` | number | W | Puissance active de la zone |
| `energyKwh` | number | kWh | Énergie cumulée depuis la dernière remise à zéro |

#### Champs optionnels — selon le type de zone

| Champ | Type | Unité | Valide pour |
|---|---|---|---|
| `frequency` | number | Hz | Toutes les zones |
| `powerFactor` | number | 0..1 | Toutes les zones |
| `luminosity` | number | lux | Zones `ROOM` et `CORRIDOR` |
| `presence` | boolean | — | Zones `ROOM` et `CORRIDOR` |
| `temperature` | number | °C | Zones `ROOM` uniquement |

> **Garde-fou backend :** si `temperature` (ou `presence`/`luminosity`) est envoyée pour une zone dont le type ne le permet pas, le backend supprime le(s) champ(s) et enregistre un avertissement. Le reste du payload est traité normalement — ne pas rejeter tout le message.

#### Champ `circuits` (V8) — état des relais du module émetteur

| Champ | Type | Description |
|---|---|---|
| `circuits` | array de `{ circuitId: string, isActive: boolean }` | Optionnel. État réel de **chaque relais piloté par CE module**, à inclure uniquement sur le paquet de la zone que le module possède (jamais sur ses paquets "secours" pour les autres zones). |

Le backend applique ces états à `Circuit.isActive` en base (best-effort — un `circuitId` inconnu est ignoré silencieusement) et rediffuse `circuit:status` via WebSocket, au même titre qu'une commande utilisateur. Objectif : le mobile sait qu'une charge est déjà ON/OFF avant d'émettre une commande redondante.

> **Zéro si toutes les charges sont éteintes.** Si tous les relais d'un module sont OFF, celui-ci publie `voltage`/`current`/`power` à `0` pour sa propre zone (`energyKwh` n'est jamais remis à zéro — c'est un compteur cumulé). Voir [`../STATE.md`](../STATE.md) V8.

#### Payload exemple complet (zone ROOM)

```json
{
  "zoneId": "zn-01xxxxxxxxxxxxxxxx",
  "voltage": 221.3,
  "current": 3.81,
  "power": 843.6,
  "energyKwh": 1.2456,
  "measuredAt": "2026-06-30T10:15:30.000Z",
  "frequency": 50.02,
  "powerFactor": 0.98,
  "luminosity": 450.0,
  "presence": true,
  "temperature": 27.5,
  "circuits": [
    { "circuitId": "crc-01xxxxxxxxxxxxxxxx", "isActive": true },
    { "circuitId": "crc-02xxxxxxxxxxxxxxxx", "isActive": false }
  ]
}
```

#### Payload minimal (zone CORRIDOR)

```json
{
  "zoneId": "zn-02xxxxxxxxxxxxxxxx",
  "voltage": 220.8,
  "current": 2.14,
  "power": 472.0,
  "energyKwh": 0.0013,
  "measuredAt": "2026-06-30T10:15:30.000Z"
}
```

---

### 5.2 Commande — Backend → ESP32

Reçu sur `powerlens/{buildingId}/{deviceId}/command/{circuitId}`.

```json
{
  "command": "OFF",
  "correlationId": "crc-01xxx-1751285730000",
  "timestamp": "2026-06-30T10:15:30.000Z",
  "ruleId": "rule-01xxx"
}
```

| Champ | Type | Description |
|---|---|---|
| `command` | `"ON"` ou `"OFF"` | Action à effectuer sur le relais |
| `correlationId` | string | Identifiant à renvoyer dans l'ACK |
| `timestamp` | string (ISO 8601) | Horodatage d'émission |
| `ruleId` | string (UUID) | Présent uniquement si la commande vient du moteur de règles |

**Action attendue de l'ESP32 :** activer ou désactiver le relais correspondant au `circuitId` du topic, puis publier un ACK.

---

### 5.3 Accusé de réception (ACK) — ESP32 → Backend

Publié sur `powerlens/{buildingId}/{deviceId}/ack/{circuitId}` immédiatement après exécution de la commande.

```json
{
  "correlationId": "crc-01xxx-1751285730000",
  "status": "SUCCESS"
}
```

| Champ | Valeurs | Description |
|---|---|---|
| `correlationId` | string | Repris tel quel depuis la commande reçue |
| `status` | `"SUCCESS"` ou `"FAILURE"` | Résultat de l'exécution physique |

Le backend met à jour `Circuit.isActive` uniquement si `status === "SUCCESS"` et diffuse l'événement WebSocket `circuit:status` à l'application mobile.

---

### 5.4 Événement — ESP32 → Backend

Publié sur `powerlens/{buildingId}/{deviceId}/event` pour signaler un événement physique (ouverture de porte, déclenchement d'un disjoncteur…).

```json
{
  "eventName": "DOOR_OPEN",
  "circuitId": "crc-01xxxxxxxxxxxxxxxx"
}
```

| Champ | Type | Description |
|---|---|---|
| `eventName` | string | Nom de l'événement (à aligner avec les règles `EVENT` configurées dans PowerLens) |
| `circuitId` | string (UUID) | Optionnel — circuit concerné par l'événement |

Les règles de type `EVENT` configurées dans PowerLens se déclenchent en comparant `eventName` et peuvent activer des actions `SWITCH_OFF` ou `ALERT`.

---

## 6. Firmware de référence

Depuis V6, le firmware n'est plus un fichier unique — chaque module physique a le sien, à la racine du dépôt :

- **[`../code_salle.ino`](../code_salle.ino)** (ESP32-PL-001) — zone ROOM réelle : PZEM004T (V/I/P/E/Hz/PF), SHT35 (température), PIR (présence), **4 relais** (un par circuit de la salle, un seul appel `onMqttMessage` route la commande vers le bon relais via le `circuitId` reçu dans le topic).
- **[`../code_couloir/code_couloir.ino`](../code_couloir/code_couloir.ino)** (ESP32-PL-002) — zone CORRIDOR réelle **pour la température uniquement** (SHT35) ; tension/courant/puissance/énergie/présence restent simulées tant que le module n'a pas de PZEM/PIR exploité ; **2 relais**.

Ce sont les références à utiliser, pas des extraits recopiés ici (pour éviter toute divergence entre ce guide et le code réel). Chaque module couvre :

- connexion WiFi + reconnexion automatique ;
- synchronisation NTP pour horodater `measuredAt` ;
- connexion MQTT + reconnexion automatique, abonnement **wildcard** `command/#` (un seul abonnement pour tous les relais du module, le `circuitId` est extrait du dernier segment du topic reçu) ;
- publication d'une mesure pour **sa** zone toutes les 5 s (`circuits` inclus, cf. §5.1), plus une estimation simulée des 2 autres zones en secours ;
- lecture SHT35 toutes les 3 s ; côté Salle, présence PIR avec debounce, transmise dans le payload ;
- si toutes les charges du module sont éteintes, publication de zéros pour sa propre zone (§5.1) ;
- réception de commande sur `command/{circuitId}`, exécution du relais correspondant, envoi de l'ACK.

---

## 7. Gestion des erreurs et bonnes pratiques

### 7.1 Broker MQTT injoignable

- Ne pas bloquer le `loop()` sur la reconnexion — retenter avec un délai progressif.
- Continuer à mesurer localement pendant la coupure.
- Éviter de bufferiser des centaines de mesures en mémoire (RAM limitée) : une mesure par intervalle est suffisante ; les données manquantes seront comblées par l'agrégation côté backend.

### 7.2 Horodatage NTP

Le champ `measuredAt` doit être en **UTC ISO 8601** (`YYYY-MM-DDTHH:MM:SS.000Z`). Sans NTP synchronisé, le backend stockera des horodatages incorrects. Gérer l'échec NTP gracieusement (log + utiliser `millis()` comme fallback de dernier recours).

### 7.3 QoS

- **Mesures** : QoS 0 est acceptable — une mesure perdue sera compensée par la suivante.
- **Commandes** : le backend publie en QoS 0 par défaut. Pour les circuits critiques (`isCritical = true`), envisager QoS 1 en accord avec l'équipe backend.
- **ACK** : QoS 1 recommandé — la non-réception d'un ACK peut amener le backend à croire que la commande a échoué.

### 7.4 Taille des payloads

Depuis V8, `code_salle.ino`/`code_couloir.ino` configurent `mqtt.setBufferSize(1024)` (et un `StaticJsonDocument<1024>`/`char buf[1024]` assortis) — le paquet de zone possédée peut désormais inclure le tableau `circuits` (§5.1), qui à lui seul ajoute ~70 octets par relais et dépasse l'ancienne limite de 512 octets dès 3-4 circuits. Les trois constantes (`mqtt.setBufferSize`, la capacité du `StaticJsonDocument`, la taille du `char buf[]`) doivent toujours être augmentées ensemble, sous peine de troncature silencieuse du JSON publié.

### 7.5 Watchdog et deep sleep

- Ne pas utiliser le **deep sleep** si l'ESP32 doit rester abonné aux topics de commande en permanence.
- Activer le **watchdog hardware** (`esp_task_wdt_init`) pour redémarrer l'ESP32 si la boucle principale se bloque (ex. sur une connexion WiFi qui traîne).

### 7.6 Sécurité (avant mise en production)

- Activer l'authentification sur Mosquitto (`allow_anonymous false`, fichier `passwd`).
- Passer en **TLS** (port 8883) avec certificat auto-signé si l'ESP32 doit communiquer hors du réseau local.
- Ne jamais stocker les credentials WiFi/MQTT en clair dans un dépôt Git.

---

## 8. Récapitulatif des champs à envoyer selon la zone

Le déploiement type comprend 3 modules, un par zone mesurable : une Salle, un Couloir, et le **départ général** du bâtiment (zone de type `BUILDING`, posé sur l'arrivée électrique principale). Tant qu'aucun module n'est branché sur le départ général, le backend calcule une valeur de repli par agrégation des zones `ROOM`/`CORRIDOR` (cf. [`database.md`](database.md)) — dès qu'une mesure existe pour la zone `BUILDING`, elle prend le pas sur ce calcul.

| Champ | CORRIDOR | ROOM |
|---|---|---|
| `zoneId` | ✔ obligatoire | ✔ obligatoire |
| `measuredAt` | ✔ obligatoire | ✔ obligatoire |
| `voltage` / `current` / `power` / `energyKwh` | ✔ | ✔ |
| `frequency` / `powerFactor` | optionnel | optionnel |
| `luminosity` | ✔ | ✔ |
| `presence` | ✔ | ✔ |
| `temperature` | **non** ⚠ | ✔ |

⚠ Le backend supprime silencieusement `temperature` (et `presence`/`luminosity` pour toute zone qui n'est ni `ROOM` ni `CORRIDOR`) avec un avertissement en log — le reste du payload est conservé.
