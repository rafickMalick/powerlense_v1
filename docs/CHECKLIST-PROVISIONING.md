# Checklist de test — Provisioning du module couloir (à dérouler au flash)

> Fonctionnalité : configuration à l'exécution via un **portail web hébergé par
> l'ESP** (NVS + WebServer + DNS captif). Firmware : `code_couloir/code_couloir-2.ino`.
> Compile avec le core **esp32:esp32 3.x** (FQBN `esp32:esp32:esp32s3`).
>
> ⚠️ Ces tests **n'ont pas pu être exécutés** (pas d'ESP disponible) : seule la
> compilation a été vérifiée. Déroule-les au moniteur série (115200 baud) + navigateur.

## Pré-requis
- Flasher `code_couloir-2.ino` sur l'ESP32-S3.
- Moniteur série ouvert à **115200 baud**.
- Un téléphone/PC avec WiFi + navigateur.

---

## Test 1 — Premier boot = mode point d'accès (aucun WiFi enregistré)
Au premier flash, `wifiSsid` est vide en NVS → mode configuration attendu.

**Log série attendu :**
```
=== PowerLens ESP32 — MODULE COULOIR ===
Broker MQTT : 172.30.104.207:1883
Circuits (4 emplacements, pins 35/36/37/38) :
  - pin 35 : Lampe Couloir  [configure] => 3da50cd3-1e76-42ff-bc37-4481ebde8720
  - pin 36 : Prise Couloir  [configure] => ac85ac61-62da-44d9-8dcb-5fdbf34b9d9c
  - pin 37 : Clim Couloir   [configure] => dfb19deb-5afb-4994-9875-3f902ada8bdd
  - pin 38 : Charge 4       [libre] =>
Aucun WiFi enregistre — demarrage du portail de configuration.
Point d'acces 'PowerLens-Setup' actif — IP 192.168.4.1
Serveur web de configuration demarre (port 80).
=== Mode CONFIGURATION — connecte-toi au WiFi 'PowerLens-Setup' puis ouvre http://192.168.4.1/ ===
```
✅ Attendu : un réseau WiFi **`PowerLens-Setup`** (ouvert) apparaît.

## Test 2 — Le portail captif s'ouvre
1. Connecte le téléphone au WiFi `PowerLens-Setup`.
2. La page de config doit s'ouvrir automatiquement (portail captif). Sinon → `http://192.168.4.1/`.

✅ Attendu : page « PowerLens - Configuration du module » avec 3 sections
(WiFi & broker / Circuits / Activation des relais).

## Test 3 — Toggle des relais depuis la page (mode AP, sans réseau)
Dans la section « Activation des relais », clique un bouton ON/OFF d'une pin.

**Log série attendu** (ex. pin 35 éteinte) :
```
[WEB] Toggle pin 35 => OFF
```
✅ Attendu : le relais commute physiquement ; le bouton passe ON↔OFF ; les 4 pins
(35/36/37/38) sont listées.

## Test 4 — Configuration WiFi + redémarrage
1. Section « Connexion WiFi & broker » : saisis ton SSID **2,4 GHz**, le mot de passe,
   l'IP du broker (PC), le port `1883`.
2. « Enregistrer & redémarrer ».

**Log série attendu :**
```
(page: "Configuration enregistree / Redemarrage du module...")
=== PowerLens ESP32 — MODULE COULOIR ===
...
Connexion MQTT [<IP broker>:1883]...
MQTT OK
```
✅ Attendu : au reboot l'ESP rejoint ton WiFi (plus de mode AP), se connecte au broker.
Vérifie côté backend : `PROVIDER_SWITCHED_TO_MQTT` + `DEVICE_ONLINE`.

## Test 5 — Config persistée (survit au reboot)
Coupe/rallume l'ESP.
✅ Attendu : il se reconnecte **directement** au WiFi enregistré (Test 1 ne réapparaît
pas). La config WiFi + mappings sont en NVS.

## Test 6 — Page accessible sur le LAN (mode STA)
Récupère l'IP LAN de l'ESP (routeur, ou log). Ouvre `http://<IP-ESP>/` depuis un
appareil du même réseau.
✅ Attendu : même page de config/toggle, servie en mode connecté.

## Test 7 — Mapping pin→circuit configurable
1. Section « Circuits » : renseigne l'UUID d'un circuit **existant en base** sur la pin 38
   (+ un libellé), puis « Enregistrer les circuits ».
2. Depuis l'app PowerLens, commande ce circuit.

**Log série attendu :**
```
[MQTT] Commande 'ON' appliquee : <libellé> (pin 38)
```
✅ Attendu : le relais de la pin 38 commute → le mapping local (UUID→pin) est bien pris
en compte. ⚠️ **L'UUID saisi doit exister en base** (sinon la commande de l'app n'est
jamais émise vers cet UUID).

## Test 8 — Mauvais WiFi → retour en mode AP
Configure un SSID/mot de passe erroné, redémarre.
✅ Attendu : après ~10 s d'échec de connexion, l'ESP rebascule en mode
`PowerLens-Setup` (log `WiFi ECHEC` puis `Point d'acces 'PowerLens-Setup' actif`) pour
permettre la correction.

---

## Ce qui a été vérifié vs supposé
- ✅ **Vérifié** : compilation réelle (`arduino-cli`, core esp32 3.3.10, FQBN esp32s3),
  empreinte 85 % flash / 15 % RAM.
- ❓ **Supposé (non testé, pas d'ESP)** : comportement mode AP, rendu de la page,
  portail captif, persistance NVS, toggle relais, reconnexion, routage des commandes.
  Ces points sont à valider via les tests 1-8 ci-dessus.

## Notes / limites connues
- Le portail web **n'a pas d'authentification** (cohérent avec le reste de la démo) —
  à sécuriser avant tout usage hors réseau de confiance.
- `BUILDING_ID`, `DEVICE_UID` et les `zoneId` restent **en dur** (hors périmètre de ce
  lot) : seuls WiFi, broker et les 4 mappings pin→circuit sont configurables.
- Empreinte flash à **85 %** : surveiller avant d'ajouter de grosses fonctionnalités.
- L'état ON/OFF des relais n'est **pas** persisté (défaut ON au boot, comme avant).
- `code_salle.ino` **n'a pas** reçu ce provisioning (demande portait sur le couloir).
