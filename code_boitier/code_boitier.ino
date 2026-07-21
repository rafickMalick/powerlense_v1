// =============================================================================
// PowerLens — Firmware ESP32-S3 — BOÎTIER (firmware unique, tous les boîtiers)
// =============================================================================
// UN SEUL firmware pour tous les boîtiers : plus aucun identifiant en dur. Au
// premier démarrage, le boîtier génère son identité (UUID de zone et de chaque
// charge), la persiste en NVS, et se DÉCLARE au backend via un message
// `announce` retained. Le backend enregistre alors le boîtier et ses charges
// (avec les noms saisis dans le portail) : c'est ce qui les fait apparaître
// dans l'application.
//
// Configuration au montage (portail web servi par le boîtier lui-même) :
//   - nom du boîtier, WiFi (SSID/mot de passe), adresse du broker MQTT
//   - nom de chaque charge sur les pins 35/36/37/38 (+ activation)
//   - commande directe des relais (interface physique, prioritaire sur rien :
//     elle contourne simplement les règles du backend)
//
// Capteurs : température (SHT35) et présence (LD2410C) réelles ; électrique
// RÉEL si un PZEM004T est détecté au démarrage, SIMULÉ sinon.
// =============================================================================
#include <Arduino.h>
#include <WiFi.h>
#include "mqtt_client.h"   // esp-mqtt (client MQTT natif ESP-IDF, inclus dans le core Arduino ESP32)
#include "esp_crt_bundle.h" // paquet d'autorités de certification embarqué (TLS)
#include <ArduinoJson.h>
#include <time.h>
#include <Wire.h>
#include <HardwareSerial.h>
#include <PZEM004Tv30.h>   // compteur d'énergie — utilisé SI présent (auto-détecté)
#include <Preferences.h>   // persistance NVS (config WiFi/broker/mappings)
#include <WebServer.h>     // portail web de configuration (intégré au core)
#include <DNSServer.h>     // portail captif (redirection en mode point d'accès)

// ─── CONFIGURATION RÉSEAU (modifiable à l'exécution via le portail web) ───────
// Ces valeurs sont MUTABLES : chargées depuis la NVS au démarrage, éditables via
// la page de configuration (mode point d'accès "PowerLens-Setup" au 1er boot,
// puis sur l'IP LAN). Les valeurs ci-dessous ne sont que des DÉFAUTS d'usine.
char wifiSsid[33] = "";                 // vide → démarre en mode portail de config
char wifiPass[65] = "";
char mqttHost[64] = "172.30.104.207";   // IP broker par défaut (modifiable dans le portail)
int  mqttPort     = 1883;

// Broker managé (HiveMQ Cloud, EMQX…) : ces brokers imposent TLS + identifiants.
// TLS activé => URI "mqtts://" + vérification du certificat via le paquet d'AC
// embarqué dans l'ESP (aucun certificat à copier à la main).
// ⚠️ TLS exige une horloge juste : la synchro NTP au démarrage est obligatoire.
char mqttUser[64] = "";
char mqttPass[64] = "";
bool mqttTls      = false;

// Point d'accès de configuration (ouvert — réseau local éphémère, portail captif)
const char* AP_SSID = "PowerLens-Setup";

// Keepalive MQTT : défaut PubSubClient (15 s), sorti en constante pour être
// ajustable. Il borne le délai de détection du LWT par le broker (~1,5× le
// keepalive, soit ~22 s) — c'est la latence de détection d'un ESP disparu.
const int   MQTT_KEEPALIVE_S = 15;
const char* FIRMWARE_VERSION = "boitier-2.0";

// ─── IDENTITÉ DU BOÎTIER (auto-déclarée — plus RIEN en dur) ───────────────────
// Le boîtier est la source de vérité de sa propre topologie : il génère ses
// identifiants au 1er démarrage, les persiste en NVS, et les DÉCLARE au backend
// (message `announce`). Le backend enregistre ce qu'il reçoit.
//
//  - deviceUid : dérivé du MAC (unique, stable, jamais saisi ni stocké)
//  - deviceName: nom convivial, modifiable dans le portail
//  - zoneId    : UUID généré une fois (la zone que ce boîtier supervise)
//  - circuitId : UUID généré une fois par charge (cf. tableau circuits[])
char deviceUid[24]  = "";              // ex. "PL-A1B2C3" (calculé au boot depuis le MAC)
char deviceName[32] = "";              // ex. "Boitier Couloir" (défaut : "Boitier <uid>")
char zoneId[40]     = "";              // UUID de la zone supervisée (généré au 1er boot)

// Segment "bâtiment" des topics : le boîtier ne connaît pas l'UUID du bâtiment
// (c'est le backend qui l'attribue). Il publie donc sous un segment neutre et
// s'abonne avec un JOKER (+) — le backend résout le vrai bâtiment via la zone.
const char* BUILDING_SEGMENT = "auto";

// ─── PINS HARDWARE (ne pas modifier — déjà câblés) ────────────────────────────
#define SDA_PIN      8
#define SCL_PIN      9
#define SHT35_ADDR   0x45

#define PRESENCE_PIN 10 // LD2410C (présence, lecture REELLE + debounce logiciel)

// PZEM004T — optionnel : détecté au démarrage. S'il répond, les mesures
// électriques sont RÉELLES ; sinon elles sont simulées. Un seul firmware pour
// tous les boîtiers, instrumentés ou non.
#define PZEM_RX_PIN  48
#define PZEM_TX_PIN  47
PZEM004Tv30* pzem = nullptr;
bool pzemDetecte = false;

// ─── CHARGES PILOTÉES ─────────────────────────────────────────────────────────
// Charges pilotées par ce boîtier — 4 emplacements à PINS FIXES (35/36/37/38).
// L'`id` (UUID) est GÉNÉRÉ par le boîtier au 1er démarrage puis persisté en NVS :
// il n'est jamais saisi par l'utilisateur. Le portail ne demande que le NOM et
// si la charge est activée. C'est ce nom qui remonte au backend (source de
// vérité de la topologie) et qui s'affiche dans l'app.
struct CircuitBinding {
  char    id[40];      // UUID auto-généré (identité stable de la charge)
  char    label[32];   // nom donné dans le portail → nom affiché dans l'app
  uint8_t pin;         // FIXE : 35/36/37/38
  bool    enabled;     // false = emplacement non câblé : ni déclaré, ni publié
  bool    state;       // ON par défaut au démarrage
};

// Défauts d'usine : 3 charges activées avec des noms génériques (à renommer dans
// le portail), la 4e désactivée. Les UUID sont vides ici — générés au 1er boot.
CircuitBinding circuits[4] = {
  { "", "Charge 1", 35, true,  true },
  { "", "Charge 2", 36, true,  true },
  { "", "Charge 3", 37, true,  true },
  { "", "Charge 4", 38, false, true },
};
const int NUM_CIRCUITS = 4;

// ─── BUZZER D'ALERTE (GPIO 45) — silencieux par défaut, piloté par MQTT ───────
#define BUZZER_PIN 45
// Index par niveau : 0=INFO (silencieux), 1=WARNING, 2=CRITICAL
const unsigned long BUZZER_BEEP_ON_MS[]  = { 0, 400, 150 };
const unsigned long BUZZER_BEEP_OFF_MS[] = { 0, 400, 150 };
const int           BUZZER_BEEP_COUNT[]  = { 0, 3,   8   }; // nb de bips avant arrêt auto

// ─── INTERVALLES ──────────────────────────────────────────────────────────────
const unsigned long MEASURE_INTERVAL_MS = 5000;   // publication MQTT de toutes les zones
const unsigned long STATUS_REPUBLISH_INTERVAL_MS = 60000; // republication du status retained (compense le QoS 0 en publish)
const unsigned long SHT_INTERVAL_MS     = 3000;   // lecture SHT35 réel

// ─── OBJETS MQTT (esp-mqtt) ───────────────────────────────────────────────────
esp_mqtt_client_handle_t mqttClient = nullptr;
volatile bool mqttConnected = false; // MAJ par le handler d'événements (tâche FreeRTOS esp-mqtt)
char mqttUri[128];                   // "mqtts://host:port" — construit dans mqttStart()

// ─── TOPICS ───────────────────────────────────────────────────────────────────
// Publication : segment bâtiment neutre ("auto") — le backend résout le vrai
// bâtiment via la zone. Abonnements : JOKER (+) sur le segment bâtiment, car le
// backend publie ses commandes avec l'UUID réel du bâtiment.
char topicMeasure[160];
char topicCmdWildcard[160]; // powerlens/+/{device}/command/#   (abonnement, joker bâtiment)
char topicEvent[160];
char topicAlertSub[160];    // powerlens/+/{device}/alert       (abonnement, joker bâtiment)
char topicStatus[160];      // powerlens/auto/{device}/status   (LWT + online retained — présence)
char topicAnnounce[160];    // powerlens/auto/{device}/announce (auto-déclaration retained)

// ─── PROVISIONING (NVS + portail web de configuration) ────────────────────────
Preferences prefs;                 // stockage persistant (namespace "plcfg")
WebServer   server(80);            // page de config, servie en permanence (AP + LAN)
DNSServer   dnsServer;             // portail captif (mode point d'accès)
bool        apMode = false;        // true = mode configuration (point d'accès, pas de MQTT)
const byte  DNS_PORT = 53;

// ─── PRÉSENCE (debounce logiciel — filtre les fluctuations avant publication) ──
bool dernierEtatPresence = false;
int  compteurPresence    = 0;
const int SEUIL_DEBOUNCE = 5;

// ─── SHT35 (réel — seule mesure physique de ce module) ────────────────────────
float dernTemp = NAN, dernHum = NAN;
unsigned long dernierSHT = 0;

unsigned long lastMeasureMs = 0;
unsigned long lastStatusMs  = 0;

// ─── BUZZER — état non-bloquant ────────────────────────────────────────────────
bool         buzzerActive         = false;
bool         buzzerPinState       = false;
int          buzzerLevelIdx       = 0;   // index dans BUZZER_BEEP_* (0=INFO,1=WARNING,2=CRITICAL)
int          buzzerBeepsRemaining = 0;
unsigned long buzzerLastToggleMs  = 0;
String       buzzerAlertId        = "";

// ─── PROTOTYPES ───────────────────────────────────────────────────────────────
void connectWiFi();
void mqttStart();
static void mqttEventHandler(void* handlerArgs, esp_event_base_t base, int32_t eventId, void* eventData);
void onMqttMessage(const char* topic, byte* payload, unsigned int length);
void publishMeasures();
void envoyerPaquetZone(const char* zoneId, float v, float i, float p, float e, float f, float pf, bool sendPresence, bool presence, float temp, bool includeCircuits = false);
void publishAck(const char* ackTopic, const char* correlationId, bool success);
void publishStatusOnline();
String buildTimestamp();
bool lireSHT35(float &temperature, float &humidite);
void scanI2C();
void startBuzzer(const char* level, const char* alertId);
void stopBuzzer();
void updateBuzzer();
// Provisioning / portail web
void loadConfig();
void computeDeviceUid();
void generateUuid(char* out, size_t size);
void ensureIdentity();
void announceDevice();
void saveWifiConfig();
void saveCircuitsConfig();
bool hasWifiConfig();
void initRelays();
void buildTopics();
void startProvisioningAP();
void startWebServer();
void handleRoot();
void handleSaveWifi();
void handleSaveCircuits();
void handleToggle();
void handleState();
void handleNotFound();
String configPageHtml();

// ─── SETUP ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(1000);
  randomSeed(micros());

  Serial.println("=== PowerLens ESP32 — BOITIER ===");

  computeDeviceUid(); // identité matérielle (MAC) — avant tout le reste
  loadConfig();       // WiFi / broker / nom / zone / charges depuis la NVS
  ensureIdentity();   // génère ce qui manque au 1er boot (nom, UUID zone/charges)
  buildTopics();      // topics MQTT (basés sur deviceUid)

  Serial.printf("Boitier      : %s (\"%s\")\n", deviceUid, deviceName);
  Serial.printf("Zone         : %s\n", zoneId);
  Serial.printf("Broker MQTT  : %s:%d\n", mqttHost, mqttPort);
  Serial.printf("Charges (%d emplacements, pins 35/36/37/38) :\n", NUM_CIRCUITS);
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    Serial.printf("  - pin %d : %-14s [%s] => %s\n", circuits[k].pin, circuits[k].label,
                  circuits[k].enabled ? "active" : "inactive", circuits[k].id);
  }

  Wire.begin(SDA_PIN, SCL_PIN);
  scanI2C();

  // Auto-détection du PZEM : s'il répond une tension plausible, on l'exploite ;
  // sinon le boîtier bascule en mesures électriques simulées.
  pzem = new PZEM004Tv30(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);
  delay(200);
  float testTension = pzem->voltage();
  pzemDetecte = !isnan(testTension) && testTension > 50.0f;
  Serial.printf("PZEM004T     : %s\n",
                pzemDetecte ? "detecte (mesures REELLES)" : "absent (mesures simulees)");

  pinMode(PRESENCE_PIN, INPUT_PULLDOWN);
  initRelays();

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW); // silencieux par défaut

  // Connexion WiFi avec les identifiants enregistrés. Si aucun n'est enregistré
  // OU si la connexion échoue → bascule en mode POINT D'ACCÈS pour permettre la
  // configuration via le portail web.
  if (hasWifiConfig()) {
    connectWiFi();
  } else {
    Serial.println("Aucun WiFi enregistre — demarrage du portail de configuration.");
  }

  if (WiFi.isConnected()) {
    apMode = false;
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    Serial.print("Sync NTP");
    struct tm timeinfo;
    int ntpRetries = 0;
    while (!getLocalTime(&timeinfo) && ntpRetries++ < 20) {
      Serial.print(".");
      delay(500);
    }
    Serial.println(getLocalTime(&timeinfo) ? " OK" : " ECHEC (horodatage par défaut)");
    mqttStart();
  } else {
    startProvisioningAP(); // SoftAP "PowerLens-Setup" + DNS captif
  }

  startWebServer(); // TOUJOURS actif : portail (AP) + interface légère (LAN)

  Serial.println(apMode
    ? "=== Mode CONFIGURATION — connecte-toi au WiFi 'PowerLens-Setup' puis ouvre http://192.168.4.1/ ==="
    : "=== Systeme demarre — page de config/toggle sur http://<IP-ESP>/ ===");
}

// ─── LOOP ─────────────────────────────────────────────────────────────────────
void loop() {
  // Portail de config : toujours servi (AP pour le setup, LAN pour les toggles).
  server.handleClient();
  if (apMode) {
    dnsServer.processNextRequest(); // portail captif : tout domaine → l'ESP
    return;                          // mode configuration : pas de MQTT ni capteurs
  }

  if (!WiFi.isConnected()) connectWiFi();
  // esp-mqtt gère connexion/reconnexion dans sa propre tâche FreeRTOS :
  // ni reconnexion manuelle, ni mqtt.loop() ici.

  // --- Buzzer (non-bloquant) ---
  updateBuzzer();

  // --- Présence LD2410C (debounce, lu à chaque tour) ---
  bool lecturePresence = digitalRead(PRESENCE_PIN);
  if (lecturePresence != dernierEtatPresence) {
    compteurPresence++;
    if (compteurPresence >= SEUIL_DEBOUNCE) {
      dernierEtatPresence = lecturePresence;
      compteurPresence = 0;
    }
  } else {
    compteurPresence = 0;
  }

  // --- SHT35 Réel (toutes les 3s) ---
  if (millis() - dernierSHT >= SHT_INTERVAL_MS) {
    dernierSHT = millis();
    lireSHT35(dernTemp, dernHum);
  }

  // --- Publication multi-zone toutes les 5s ---
  if (millis() - lastMeasureMs >= MEASURE_INTERVAL_MS) {
    lastMeasureMs = millis();
    publishMeasures();
  }

  // --- Republication périodique du status retained (compense le QoS 0) ---
  if (millis() - lastStatusMs >= STATUS_REPUBLISH_INTERVAL_MS) {
    lastStatusMs = millis();
    if (mqttConnected) publishStatusOnline();
  }
}

// ─── WIFI ─────────────────────────────────────────────────────────────────────
void connectWiFi() {
  if (WiFi.isConnected()) return;
  Serial.printf("\nConnexion WiFi [%s]...", wifiSsid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid, wifiPass);
  int attempts = 0;
  while (!WiFi.isConnected() && attempts++ < 20) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(WiFi.isConnected() ? "\nWiFi OK" : "\nWiFi ECHEC — nouvelle tentative au prochain cycle.");
}

// ─── MQTT (esp-mqtt) ──────────────────────────────────────────────────────────
// Connexion ASYNCHRONE gérée par une tâche FreeRTOS dédiée d'esp-mqtt. Il n'y a
// donc AUCUNE reconnexion à la main dans loop() (contrairement à PubSubClient) :
// esp-mqtt retente tout seul (reconnect_timeout_ms). Le LWT et les buffers sont
// posés dans la config, pas dans un connect().
void mqttStart() {
  // Schéma selon le mode : "mqtts" (broker managé, chiffré) ou "mqtt" (local).
  snprintf(mqttUri, sizeof(mqttUri), "%s://%s:%d",
           mqttTls ? "mqtts" : "mqtt", mqttHost, mqttPort);
  Serial.printf("Connexion MQTT [%s] %s%s...\n", mqttUri,
                mqttTls ? "TLS" : "en clair",
                strlen(mqttUser) > 0 ? " + authentification" : " sans authentification");

  esp_mqtt_client_config_t cfg = {};
  cfg.broker.address.uri            = mqttUri;
  cfg.credentials.client_id         = deviceUid;        // clientId = identifiant materiel

  // Authentification (brokers managés) — omise si aucun utilisateur configuré.
  if (strlen(mqttUser) > 0) {
    cfg.credentials.username                 = mqttUser;
    cfg.credentials.authentication.password  = mqttPass;
  }
  // TLS : validation du certificat du broker via le paquet d'AC embarqué.
  if (mqttTls) {
    cfg.broker.verification.crt_bundle_attach = esp_crt_bundle_attach;
  }
  cfg.session.keepalive             = MQTT_KEEPALIVE_S; // 15 s (inchangé)
  cfg.session.disable_clean_session = false;            // clean session = true (inchangé)
  // LWT : {online:false} QoS 1 retained, publié par le broker à notre place.
  cfg.session.last_will.topic       = topicStatus;
  cfg.session.last_will.msg         = "{\"online\":false}";
  cfg.session.last_will.msg_len     = 0;                // 0 = strlen
  cfg.session.last_will.qos         = 1;
  cfg.session.last_will.retain      = 1;
  // Buffers 1 Ko : le payload `measure` avec circuits[] (UUID) dépasse les 256 o
  // du défaut PubSubClient. size = entrant, out_size = SORTANT (le measure l'est).
  cfg.buffer.size                   = 1024;
  cfg.buffer.out_size               = 1024;
  cfg.network.reconnect_timeout_ms  = 3000;             // ~"nouvelle tentative dans 3 s"

  mqttClient = esp_mqtt_client_init(&cfg);
  esp_mqtt_client_register_event(mqttClient, MQTT_EVENT_ANY, mqttEventHandler, nullptr);
  esp_mqtt_client_start(mqttClient);
}

// Handler d'événements esp-mqtt — s'exécute dans la TÂCHE MQTT (pas dans loop()).
// ⚠️ Toute publication émise D'ICI (ACK, status) DOIT passer par
// esp_mqtt_client_enqueue() et JAMAIS esp_mqtt_client_publish() : en QoS 1,
// publish() bloque jusqu'au PUBACK, or ce PUBACK est traité par CETTE même tâche
// → interblocage. enqueue() est non bloquant quel que soit le QoS. Le sprint
// suivant passe les ACK en QoS 1 : ne « simplifiez » pas ceci en publish().
static void mqttEventHandler(void* handlerArgs, esp_event_base_t base, int32_t eventId, void* eventData) {
  esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t) eventData;
  switch ((esp_mqtt_event_id_t) eventId) {
    case MQTT_EVENT_CONNECTED:
      mqttConnected = true;
      Serial.println("MQTT OK");
      publishStatusOnline(); // annonce {online:true} retained dès la connexion
      esp_mqtt_client_subscribe(mqttClient, topicCmdWildcard, 0); // QoS 0 (inchangé)
      Serial.printf("Abonne au topic de commande (wildcard) : %s\n", topicCmdWildcard);
      esp_mqtt_client_subscribe(mqttClient, topicAlertSub, 0);
      Serial.printf("Abonne au topic d'alerte : %s\n", topicAlertSub);
      announceDevice(); // auto-déclaration : nom du boîtier + ses charges
      break;

    case MQTT_EVENT_DISCONNECTED:
      mqttConnected = false;
      Serial.println("MQTT deconnecte — reconnexion automatique...");
      break;

    case MQTT_EVENT_DATA: {
      // esp-mqtt ne termine PAS topic/data par '\0' et peut fragmenter un gros
      // payload. Les commandes/alertes entrantes sont petites (< buffer 1024) →
      // un seul fragment complet : on ignore tout message partiel (garde ci-dessous).
      if (event->topic_len == 0 || event->current_data_offset != 0 ||
          event->data_len != event->total_data_len) {
        break;
      }
      char topicBuf[160];
      char dataBuf[512];
      int tl = event->topic_len < (int) sizeof(topicBuf) - 1 ? event->topic_len : (int) sizeof(topicBuf) - 1;
      int dl = event->data_len  < (int) sizeof(dataBuf)  - 1 ? event->data_len  : (int) sizeof(dataBuf)  - 1;
      memcpy(topicBuf, event->topic, tl); topicBuf[tl] = '\0';
      memcpy(dataBuf,  event->data,  dl); dataBuf[dl]  = '\0';
      onMqttMessage(topicBuf, (byte*) dataBuf, dl); // logique de commande/alerte INCHANGÉE
      break;
    }

    case MQTT_EVENT_ERROR: {
      // Distinction transport (TCP/TLS) vs refus du broker — sera cruciale au
      // sprint TLS. Remplace la ligne "MQTT ECHEC (état=%d)" de PubSubClient.
      esp_mqtt_error_codes_t* err = event->error_handle;
      if (err && err->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
        Serial.printf("MQTT ERREUR transport (errno=%d) — reconnexion automatique\n",
                      err->esp_transport_sock_errno);
      } else if (err) {
        Serial.printf("MQTT REFUS broker (connect_return_code=%d) — reconnexion automatique\n",
                      (int) err->connect_return_code);
      } else {
        Serial.println("MQTT ERREUR (inconnue) — reconnexion automatique");
      }
      break;
    }

    default:
      break;
  }
}

// ─── CALLBACK COMMANDE RELAIS ─────────────────────────────────────────────────
// Route la commande vers le relais correspondant au circuitId reçu (dernier
// segment du topic). Robustesse : si le circuitId ne correspond à AUCUN
// circuit connu de ce module (ex. "circuit 2" qui n'existerait pas), l'action
// est quand même accusée comme reçue (ACK SUCCESS, cf. demande) mais une
// alerte claire est loggée en Serial — aucun relais n'est actionné dans ce cas.
void onMqttMessage(const char* topic, byte* payload, unsigned int length) {
  // Trace de réception BRUTE : affiche TOUT message entrant (commande ou alerte)
  // dès son arrivée, avant tout traitement — pour voir au moniteur série que le
  // boîtier reçoit bien, et quel est le contenu exact.
  Serial.printf("[MQTT] >> Recu | topic=%s | payload=%.*s\n", topic, (int) length, (const char*) payload);

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload, length) != DeserializationError::Ok) {
    Serial.printf("[MQTT] JSON invalide sur %s\n", topic);
    return;
  }

  // ─── ALERTE (topic dédié, distinct des commandes) ────────────────────────
  // Abonnements avec joker : le segment bâtiment du topic REÇU est l'UUID réel
  // du backend, jamais le nôtre → on identifie le flux par son SUFFIXE.
  size_t topicLen = strlen(topic);
  const char* ALERT_SUFFIX = "/alert";
  size_t alertSuffixLen = strlen(ALERT_SUFFIX);
  bool isAlert = topicLen >= alertSuffixLen &&
                 strcmp(topic + topicLen - alertSuffixLen, ALERT_SUFFIX) == 0;

  if (isAlert) {
    const char* alertId = doc["alertId"];
    const char* level   = doc["level"];
    const char* message = doc["message"];
    bool cleared = doc["cleared"] | false;

    Serial.printf("[ALERTE MQTT] id=%s niveau=%s message=%s cleared=%s\n",
                  alertId ? alertId : "?", level ? level : "?", message ? message : "",
                  cleared ? "oui" : "non");

    if (cleared) {
      if (alertId && buzzerAlertId == alertId) {
        stopBuzzer();
      }
    } else if (level) {
      startBuzzer(level, alertId ? alertId : "");
    }
    return;
  }

  const char* command       = doc["command"];
  const char* correlationId = doc["correlationId"];
  if (!command || !correlationId) {
    Serial.println("[MQTT] Commande malformee (command/correlationId manquant)");
    return;
  }

  // Le circuitId est le DERNIER segment du topic — extraction robuste quel que
  // soit l'UUID de bâtiment placé par le backend (abonnement avec joker).
  if (!strstr(topic, "/command/")) {
    Serial.printf("[MQTT] Topic de commande inattendu, ignore : %s\n", topic);
    return;
  }
  const char* lastSlash = strrchr(topic, '/');
  const char* circuitIdStr = lastSlash ? lastSlash + 1 : "";

  char ackTopic[160];
  snprintf(ackTopic, sizeof(ackTopic), "powerlens/%s/%s/ack/%s", BUILDING_SEGMENT, deviceUid, circuitIdStr);

  bool isOn;
  if (strcmp(command, "ON") == 0) {
    isOn = true;
  } else if (strcmp(command, "OFF") == 0) {
    isOn = false;
  } else {
    Serial.printf("[MQTT] Commande inconnue '%s' pour circuit %s\n", command, circuitIdStr);
    publishAck(ackTopic, correlationId, false);
    return;
  }

  int idx = -1;
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    if (strcmp(circuits[k].id, circuitIdStr) == 0) { idx = k; break; }
  }

  if (idx >= 0) {
    circuits[idx].state = isOn;
    digitalWrite(circuits[idx].pin, isOn ? HIGH : LOW);
    Serial.printf("[MQTT] Commande '%s' appliquee : %s (pin %d)\n", command, circuits[idx].label, circuits[idx].pin);
  } else {
    Serial.printf(
      "[ALERTE] Commande '%s' recue pour un circuit INCONNU sur ce module (%s) : %s — aucun relais actionne, ACK envoye quand meme\n",
      command, deviceUid, circuitIdStr);
  }

  // "Action validee" dans tous les cas (circuit connu ou non) tant que la
  // commande ON/OFF elle-meme etait valide.
  publishAck(ackTopic, correlationId, true);
}

// ─── FONCTION D'ENVOI FACTORISÉE ──────────────────────────────────────────────
void envoyerPaquetZone(const char* zoneId, float v, float i, float p, float e, float f, float pf, bool sendPresence, bool presence, float temp, bool includeCircuits) {
  StaticJsonDocument<1024> doc;
  doc["zoneId"]     = zoneId;
  doc["measuredAt"] = buildTimestamp();
  doc["voltage"]    = v;
  doc["current"]    = i;
  doc["power"]      = p;
  doc["energyKwh"]  = isnan(e) ? 0.0f : e;

  if (!isnan(f))  doc["frequency"]   = f;
  if (!isnan(pf)) doc["powerFactor"] = pf;

  if (sendPresence) doc["presence"] = presence;
  if (!isnan(temp)) doc["temperature"] = temp;

  // État des relais de CE module — uniquement pour le paquet de la zone
  // possédée (Couloir), pas pour les paquets secours Salle/Bâtiment.
  if (includeCircuits) {
    JsonArray arr = doc.createNestedArray("circuits");
    for (int k = 0; k < NUM_CIRCUITS; k++) {
      if (!circuits[k].enabled) continue; // charge non activée → ni déclarée ni publiée
      JsonObject o = arr.createNestedObject();
      o["circuitId"] = circuits[k].id;
      o["pin"]       = circuits[k].pin;   // numéro de pin physique (mapping → backend/app)
      o["label"]     = circuits[k].label; // libellé configuré localement
      o["isActive"]  = circuits[k].state;
    }
  }

  char buf[1024];
  size_t len = serializeJson(doc, buf, sizeof(buf));
  esp_mqtt_client_publish(mqttClient, topicMeasure, buf, len, 0, 0); // QoS 0 (appelé depuis loop)
}

// ─── LOGIQUE DE PUBLICATION (RÉEL TEMPÉRATURE + SIMULATION) ───────────────────
void publishMeasures() {
  Serial.printf("[STATUT] WiFi=%s | MQTT=%s\n",
                WiFi.isConnected() ? "CONNECTE" : "DECONNECTE",
                mqttConnected      ? "CONNECTE" : "DECONNECTE");

  if (!mqttConnected) return;

  // Base électrique : LUE SUR LE PZEM s'il a été détecté au démarrage, SIMULÉE
  // sinon. Un seul firmware couvre ainsi les boîtiers instrumentés et les autres.
  float voltage, frequency, pf;
  if (pzemDetecte) {
    voltage   = pzem->voltage();
    frequency = pzem->frequency();
    pf        = pzem->pf();
    // Lecture ratée (capteur momentanément muet) → repli sur des valeurs plausibles
    if (isnan(voltage))   voltage   = 220.0f;
    if (isnan(frequency)) frequency = 50.0f;
    if (isnan(pf))        pf        = 0.95f;
  } else {
    voltage   = 220.0f + (random(-30, 31) / 10.0f); // 217–223 V
    frequency = 50.0f + (random(-10, 11) / 100.0f); // 49.9–50.1 Hz
    pf        = 0.90f + (random(0, 9) / 100.0f);    // 0.90–0.98
  }

  // ─── ZONE SUPERVISÉE (température + présence RÉELLES ; électrique PZEM ou simulé) ─
  // Nombre de charges actuellement actives sur ce boîtier (toutes pins confondues).
  bool anyCircuitOn = false;
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    if (circuits[k].enabled && circuits[k].state) { anyCircuitOn = true; break; }
  }

  float corridorPower, corridorVoltage, corridorCurrent, corridorEnergyRead;
  static float corridorEnergySim = 0.0f;

  if (pzemDetecte) {
    // Mesures réelles du compteur (arrivée électrique de la zone).
    corridorPower      = pzem->power();
    corridorCurrent    = pzem->current();
    corridorEnergyRead = pzem->energy();
    corridorVoltage    = voltage;
    if (isnan(corridorPower))      corridorPower      = 0.0f;
    if (isnan(corridorCurrent))    corridorCurrent    = 0.0f;
    if (isnan(corridorEnergyRead)) corridorEnergyRead = 0.0f;
  } else {
    // Estimation : chaque charge active contribue une puissance typique.
    corridorPower = 0.0f;
    if (circuits[0].enabled && circuits[0].state) corridorPower += 300.0f; // éclairage
    if (circuits[1].enabled && circuits[1].state) corridorPower += 150.0f; // prises
    if (circuits[2].enabled && circuits[2].state) corridorPower += 800.0f; // clim/HVAC
    if (circuits[3].enabled && circuits[3].state) corridorPower += 100.0f; // divers
    if (anyCircuitOn) corridorPower += random(-20, 21); // bruit si au moins une charge active
    if (corridorPower < 0) corridorPower = 0;

    corridorVoltage = anyCircuitOn ? voltage : 0.0f;
    corridorCurrent = anyCircuitOn ? (corridorPower / corridorVoltage) : 0.0f;
    corridorEnergySim += (corridorPower / 1000.0f) * (MEASURE_INTERVAL_MS / 3600000.0f);
    corridorEnergyRead = corridorEnergySim;
  }
  float corridorEnergy = corridorEnergyRead;
  bool presenceCorridor = dernierEtatPresence; // Lecture REELLE du LD2410C, filtrée par debounce

  // Un boîtier ne publie QUE la zone qu'il supervise (zoneId auto-déclaré).
  // Les anciennes zones « secours » simulées (Salle / Départ général) ont été
  // supprimées : dans le modèle multi-boîtiers, chaque zone a son propre boîtier.
  envoyerPaquetZone(zoneId, corridorVoltage, corridorCurrent, corridorPower, corridorEnergy,
                    frequency, pf, /*sendPresence=*/true, presenceCorridor, dernTemp,
                    /*includeCircuits=*/true);
  Serial.printf("[%s] %0.1fV | %0.2fA | %0.1fW | Temp: %0.1f°C | Pres: %s | %s\n",
                deviceName, corridorVoltage, corridorCurrent, corridorPower, dernTemp,
                presenceCorridor ? "OUI" : "NON", pzemDetecte ? "PZEM(REEL)" : "SIMULE");

  Serial.println("----------------------------------------------------------------");
}

// ─── PUBLICATION ACK ────────────────────────────────────────────────────────────
void publishAck(const char* ackTopic, const char* correlationId, bool success) {
  StaticJsonDocument<128> doc;
  doc["correlationId"] = correlationId;
  doc["status"]        = success ? "SUCCESS" : "FAILURE";

  char buf[128];
  size_t len = serializeJson(doc, buf, sizeof(buf));
  // enqueue (non bloquant) : appelé depuis le handler d'événements (cf. mqttEventHandler).
  esp_mqtt_client_enqueue(mqttClient, ackTopic, buf, len, 0, 0, /*store=*/true); // QoS 0
  Serial.printf("[ACK MQTT] topic=%s status=%s\n", ackTopic, success ? "SUCCESS" : "FAILURE");
}

// AUTO-DÉCLARATION — le boîtier décrit sa topologie au backend : son identité
// (uid + nom), la zone qu'il supervise, et ses charges (UUID + nom + pin).
// Publié en RETAINED : le backend retrouve la déclaration même s'il démarre
// après le boîtier. Envoyé à chaque connexion et après chaque changement de
// config. C'est CE message qui fait apparaître le boîtier et ses charges dans
// l'app (le backend fait un upsert de Device / Zone / Circuits).
void announceDevice() {
  StaticJsonDocument<1024> doc;
  doc["deviceUid"] = deviceUid;
  doc["name"]      = deviceName;
  doc["zoneId"]    = zoneId;
  doc["zoneName"]  = deviceName; // la zone supervisée porte le nom du boîtier
  doc["firmware"]  = FIRMWARE_VERSION;

  JsonArray arr = doc.createNestedArray("charges");
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    if (!circuits[k].enabled) continue; // emplacement non câblé → non déclaré
    JsonObject o = arr.createNestedObject();
    o["circuitId"] = circuits[k].id;
    o["name"]      = circuits[k].label;
    o["pin"]       = circuits[k].pin;
    o["isActive"]  = circuits[k].state;
  }

  char buf[1024];
  size_t len = serializeJson(doc, buf, sizeof(buf));
  // enqueue : appelé depuis le handler d'événements MQTT (cf. mqttEventHandler).
  esp_mqtt_client_enqueue(mqttClient, topicAnnounce, buf, len, 0, /*retain=*/1, /*store=*/true);
  Serial.printf("[ANNONCE] %s (\"%s\") — %d charge(s) declaree(s)\n",
                deviceUid, deviceName, arr.size());
}

// Annonce de présence : {online:true} publié en RETAINED sur topicStatus. Le
// retained permet à un client qui se connecte plus tard de recevoir aussitôt le
// dernier statut connu. QoS 0 (limite PubSubClient en publish) ; le willQos du
// LWT reste à 1. Republié périodiquement (cf. loop) pour compenser le QoS 0.
void publishStatusOnline() {
  StaticJsonDocument<160> doc;
  doc["online"]    = true;
  doc["deviceUid"] = deviceUid;
  doc["firmware"]  = FIRMWARE_VERSION;

  char buf[160];
  size_t len = serializeJson(doc, buf, sizeof(buf));
  // enqueue (non bloquant) : appelé depuis le handler (MQTT_EVENT_CONNECTED) ET depuis loop().
  esp_mqtt_client_enqueue(mqttClient, topicStatus, buf, len, 0, /*retain=*/1, /*store=*/true);
  Serial.printf("[STATUS MQTT] online=true retained -> %s\n", topicStatus);
}

// ─── HORODATAGE ISO8601 ────────────────────────────────────────────────────────
String buildTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return "1970-01-01T00:00:00.000Z";
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S.000Z", &timeinfo);
  return String(buf);
}

// ─── DRIVER SHT35 ──────────────────────────────────────────────────────────────
bool lireSHT35(float &temperature, float &humidite) {
  Wire.beginTransmission(SHT35_ADDR);
  Wire.write(0x2C);
  Wire.write(0x06);
  if (Wire.endTransmission() != 0) return false;

  delay(20);

  Wire.requestFrom(SHT35_ADDR, 6);
  if (Wire.available() != 6) return false;

  uint16_t tempRaw = (Wire.read() << 8) | Wire.read();
  Wire.read();
  uint16_t humRaw  = (Wire.read() << 8) | Wire.read();
  Wire.read();

  temperature = -45.0 + 175.0 * tempRaw / 65535.0;
  humidite    = 100.0 * humRaw  / 65535.0;
  return true;
}

// ─── BUZZER D'ALERTE ────────────────────────────────────────────────────────────
// Non-bloquant (aucun delay()) : startBuzzer() arme le pattern, updateBuzzer()
// (appelée à chaque loop()) fait clignoter le buzzer et s'arrête seule une fois
// le nombre de bips épuisé — double garantie d'arrêt avec le "cleared:true"
// explicite envoyé par le backend quand l'alerte est levée (cf. onMqttMessage).
void startBuzzer(const char* level, const char* alertId) {
  int idx = 0; // INFO par défaut (silencieux)
  if (strcmp(level, "WARNING") == 0)  idx = 1;
  else if (strcmp(level, "CRITICAL") == 0) idx = 2;

  if (BUZZER_BEEP_COUNT[idx] == 0) {
    Serial.printf("[BUZZER] Niveau '%s' — pas de son configure\n", level);
    return;
  }

  buzzerLevelIdx       = idx;
  buzzerBeepsRemaining = BUZZER_BEEP_COUNT[idx] * 2; // *2 = compte les phases ON+OFF
  buzzerActive         = true;
  buzzerPinState       = true;
  buzzerAlertId        = String(alertId);
  buzzerLastToggleMs   = millis();
  digitalWrite(BUZZER_PIN, HIGH);

  Serial.printf("[BUZZER] Demarrage (niveau=%s, alertId=%s)\n", level, alertId);
}

void stopBuzzer() {
  if (!buzzerActive) return;
  buzzerActive = false;
  buzzerPinState = false;
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println("[BUZZER] Fin");
  buzzerAlertId = "";
}

void updateBuzzer() {
  if (!buzzerActive) return;

  unsigned long interval = buzzerPinState
    ? BUZZER_BEEP_ON_MS[buzzerLevelIdx]
    : BUZZER_BEEP_OFF_MS[buzzerLevelIdx];

  if (millis() - buzzerLastToggleMs >= interval) {
    buzzerLastToggleMs = millis();
    buzzerPinState = !buzzerPinState;
    digitalWrite(BUZZER_PIN, buzzerPinState ? HIGH : LOW);
    buzzerBeepsRemaining--;

    if (buzzerBeepsRemaining <= 0) {
      stopBuzzer();
    }
  }
}

// ─── SCANNER I2C (diagnostic cablage) ──────────────────────────────────────────
// Le SHT35 a DEUX adresses possibles selon le cablage de sa broche ADDR :
// 0x44 (ADDR->GND) ou 0x45 (ADDR->VDD, valeur codee en dur ici). Si la
// lecture renvoie systematiquement NAN, ce scan permet de voir tout de suite
// quelle adresse repond reellement sur le bus avant de modifier SHT35_ADDR.
void scanI2C() {
  Serial.println("[I2C] Scan du bus...");
  int trouve = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[I2C] Peripherique detecte a l'adresse 0x%02X%s\n",
                    addr, addr == SHT35_ADDR ? " (= SHT35_ADDR configuree)" : "");
      trouve++;
    }
  }
  if (trouve == 0) {
    Serial.println("[I2C] AUCUN peripherique detecte — verifier cablage SDA/SCL/alimentation du SHT35");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PROVISIONING — persistance NVS + portail web de configuration
// ═════════════════════════════════════════════════════════════════════════════

bool hasWifiConfig() { return strlen(wifiSsid) > 0; }

static void copyToBuf(char* dst, size_t dstSize, const String& src) {
  strncpy(dst, src.c_str(), dstSize - 1);
  dst[dstSize - 1] = '\0';
}

// Charge la configuration depuis la NVS (namespace "plcfg"). Les valeurs par
// défaut passées à get*() sont les DÉFAUTS D'USINE globaux → conservés tant
// qu'aucune config n'a été enregistrée.
void loadConfig() {
  prefs.begin("plcfg", /*readOnly=*/true);

  copyToBuf(wifiSsid, sizeof(wifiSsid), prefs.getString("wifi_ssid", wifiSsid));
  copyToBuf(wifiPass, sizeof(wifiPass), prefs.getString("wifi_pass", wifiPass));
  copyToBuf(mqttHost, sizeof(mqttHost), prefs.getString("mqtt_host", mqttHost));
  mqttPort = prefs.getInt("mqtt_port", mqttPort);
  copyToBuf(mqttUser, sizeof(mqttUser), prefs.getString("mqtt_user", mqttUser));
  copyToBuf(mqttPass, sizeof(mqttPass), prefs.getString("mqtt_pass", mqttPass));
  mqttTls = prefs.getBool("mqtt_tls", mqttTls);

  // Identité auto-déclarée : nom du boîtier + UUID de la zone supervisée.
  copyToBuf(deviceName, sizeof(deviceName), prefs.getString("dev_name", ""));
  copyToBuf(zoneId,     sizeof(zoneId),     prefs.getString("zone_id", ""));

  // Charges : UUID généré + nom + activation (chargés si déjà enregistrés).
  if (prefs.getBool("c_saved", false)) {
    char key[12];
    for (int k = 0; k < NUM_CIRCUITS; k++) {
      snprintf(key, sizeof(key), "c%d_id", k);
      copyToBuf(circuits[k].id, sizeof(circuits[k].id), prefs.getString(key, ""));
      snprintf(key, sizeof(key), "c%d_lbl", k);
      copyToBuf(circuits[k].label, sizeof(circuits[k].label), prefs.getString(key, circuits[k].label));
      snprintf(key, sizeof(key), "c%d_en", k);
      circuits[k].enabled = prefs.getBool(key, circuits[k].enabled);
    }
  }

  prefs.end();
}

// deviceUid = identifiant matériel unique, calculé UNE fois puis persisté.
// ⚠️ On lit l'eFuse via ESP.getEfuseMac() et NON WiFi.macAddress() : cette
// dernière renvoie 00:00:00 tant que le WiFi n'est pas démarré — tous les
// boîtiers se retrouvaient alors avec le même uid "PL-000000" (collision de
// clientId MQTT et d'identité en base). La persistance garantit en plus que
// l'uid ne change jamais, même si la méthode de calcul évolue.
void computeDeviceUid() {
  prefs.begin("plcfg", /*readOnly=*/false);
  String saved = prefs.getString("dev_uid", "");
  if (saved.length() > 0) {
    copyToBuf(deviceUid, sizeof(deviceUid), saved);
  } else {
    uint64_t mac = ESP.getEfuseMac(); // eFuse : lisible sans WiFi
    snprintf(deviceUid, sizeof(deviceUid), "PL-%02X%02X%02X",
             (uint8_t) (mac >> 16), (uint8_t) (mac >> 8), (uint8_t) mac);
    // Garde-fou : eFuse illisible → suffixe aléatoire (persisté, donc stable).
    if (strcmp(deviceUid, "PL-000000") == 0) {
      snprintf(deviceUid, sizeof(deviceUid), "PL-%06X",
               (unsigned) (esp_random() & 0xFFFFFF));
    }
    prefs.putString("dev_uid", deviceUid);
    Serial.printf("Identifiant materiel genere : %s\n", deviceUid);
  }
  prefs.end();
}

// UUID v4 aléatoire — sert d'identité stable à la zone et à chaque charge.
void generateUuid(char* out, size_t size) {
  uint8_t b[16];
  for (int i = 0; i < 16; i++) b[i] = (uint8_t)(esp_random() & 0xFF);
  b[6] = (b[6] & 0x0F) | 0x40; // version 4
  b[8] = (b[8] & 0x3F) | 0x80; // variant RFC 4122
  snprintf(out, size,
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
           b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
}

// Complète (une seule fois) ce qui manque : nom par défaut, UUID de zone, UUID
// de chaque charge. Persiste uniquement si quelque chose a été créé.
void ensureIdentity() {
  bool dirty = false;

  if (strlen(deviceName) == 0) {
    snprintf(deviceName, sizeof(deviceName), "Boitier %s", deviceUid);
    dirty = true;
  }
  if (strlen(zoneId) == 0) {
    generateUuid(zoneId, sizeof(zoneId));
    dirty = true;
  }
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    if (strlen(circuits[k].id) == 0) {
      generateUuid(circuits[k].id, sizeof(circuits[k].id));
      dirty = true;
    }
  }

  if (dirty) {
    saveCircuitsConfig(); // persiste nom + zone + charges
    Serial.println("Identite du boitier generee et enregistree (1er demarrage).");
  }
}

void saveWifiConfig() {
  prefs.begin("plcfg", /*readOnly=*/false);
  prefs.putString("wifi_ssid", wifiSsid);
  prefs.putString("wifi_pass", wifiPass);
  prefs.putString("mqtt_host", mqttHost);
  prefs.putInt("mqtt_port", mqttPort);
  prefs.putString("mqtt_user", mqttUser);
  prefs.putString("mqtt_pass", mqttPass);
  prefs.putBool("mqtt_tls", mqttTls);
  prefs.putString("dev_name", deviceName); // nom du boîtier (saisi dans le même formulaire)
  prefs.end();
}

// Persiste toute l'identité déclarative : nom du boîtier, UUID de zone, et pour
// chaque charge son UUID + son nom + son activation.
void saveCircuitsConfig() {
  prefs.begin("plcfg", /*readOnly=*/false);
  prefs.putBool("c_saved", true);
  prefs.putString("dev_name", deviceName);
  prefs.putString("zone_id", zoneId);
  char key[12];
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    snprintf(key, sizeof(key), "c%d_id", k);
    prefs.putString(key, circuits[k].id);
    snprintf(key, sizeof(key), "c%d_lbl", k);
    prefs.putString(key, circuits[k].label);
    snprintf(key, sizeof(key), "c%d_en", k);
    prefs.putBool(key, circuits[k].enabled);
  }
  prefs.end();
}

void initRelays() {
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    pinMode(circuits[k].pin, OUTPUT);
    digitalWrite(circuits[k].pin, circuits[k].state ? HIGH : LOW);
  }
}

// Publications sous le segment neutre ; abonnements avec joker sur le bâtiment
// (le backend publie ses commandes avec l'UUID réel, inconnu du boîtier).
void buildTopics() {
  snprintf(topicMeasure,     sizeof(topicMeasure),     "powerlens/%s/%s/measure",  BUILDING_SEGMENT, deviceUid);
  snprintf(topicEvent,       sizeof(topicEvent),       "powerlens/%s/%s/event",    BUILDING_SEGMENT, deviceUid);
  snprintf(topicStatus,      sizeof(topicStatus),      "powerlens/%s/%s/status",   BUILDING_SEGMENT, deviceUid);
  snprintf(topicAnnounce,    sizeof(topicAnnounce),    "powerlens/%s/%s/announce", BUILDING_SEGMENT, deviceUid);
  snprintf(topicCmdWildcard, sizeof(topicCmdWildcard), "powerlens/+/%s/command/#", deviceUid);
  snprintf(topicAlertSub,    sizeof(topicAlertSub),    "powerlens/+/%s/alert",     deviceUid);
}

void startProvisioningAP() {
  apMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID); // réseau ouvert
  IPAddress ip = WiFi.softAPIP();
  dnsServer.start(DNS_PORT, "*", ip); // portail captif : tout domaine → l'ESP
  Serial.printf("Point d'acces '%s' actif — IP %s\n", AP_SSID, ip.toString().c_str());
}

void startWebServer() {
  server.on("/", HTTP_GET, handleRoot);
  server.on("/wifi", HTTP_POST, handleSaveWifi);
  server.on("/circuits", HTTP_POST, handleSaveCircuits);
  server.on("/toggle", HTTP_GET, handleToggle);
  server.on("/state", HTTP_GET, handleState);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("Serveur web de configuration demarre (port 80).");
}

// En mode portail captif, toute URL inconnue redirige vers la page ; 404 sinon.
void handleNotFound() {
  if (apMode) {
    server.sendHeader("Location", "/", true);
    server.send(302, "text/plain", "");
  } else {
    server.send(404, "text/plain", "Not found");
  }
}

void handleRoot() {
  server.send(200, "text/html; charset=utf-8", configPageHtml());
}

void handleSaveWifi() {
  if (server.hasArg("name")) copyToBuf(deviceName, sizeof(deviceName), server.arg("name"));
  if (server.hasArg("ssid")) copyToBuf(wifiSsid, sizeof(wifiSsid), server.arg("ssid"));
  // Mot de passe : mis à jour seulement si non vide (laissé vide = inchangé).
  if (server.hasArg("pass") && server.arg("pass").length() > 0)
    copyToBuf(wifiPass, sizeof(wifiPass), server.arg("pass"));

  // Broker en un seul champ "hôte:port" — on colle directement l'adresse (IP
  // locale OU domaine ngrok, ex. "0.tcp.ngrok.io:14872"). On tolère un préfixe
  // de schéma (tcp://, mqtt://) et on sépare sur le DERNIER ':' (port).
  if (server.hasArg("broker")) {
    String b = server.arg("broker");
    b.trim();
    int scheme = b.indexOf("://");
    if (scheme >= 0) b = b.substring(scheme + 3);
    int colon = b.lastIndexOf(':');
    if (colon > 0) {
      copyToBuf(mqttHost, sizeof(mqttHost), b.substring(0, colon));
      int p = b.substring(colon + 1).toInt();
      mqttPort = (p > 0) ? p : 1883;
    } else if (b.length() > 0) {
      copyToBuf(mqttHost, sizeof(mqttHost), b);
      mqttPort = 1883; // pas de port fourni → défaut MQTT
    }
  }

  // Identifiants du broker (brokers managés type HiveMQ) + chiffrement TLS.
  if (server.hasArg("muser")) copyToBuf(mqttUser, sizeof(mqttUser), server.arg("muser"));
  // Mot de passe : mis à jour seulement si non vide (laissé vide = inchangé).
  if (server.hasArg("mpass") && server.arg("mpass").length() > 0)
    copyToBuf(mqttPass, sizeof(mqttPass), server.arg("mpass"));
  mqttTls = server.hasArg("mtls"); // case à cocher : absente du POST si décochée

  saveWifiConfig();
  server.send(200, "text/html; charset=utf-8",
    "<meta charset='utf-8'><body style='font-family:system-ui;padding:2rem'>"
    "<h2>Configuration enregistree</h2><p>Redemarrage du module...</p></body>");
  delay(800);
  ESP.restart();
}

// Les UUID ne sont plus saisis : seuls le NOM et l'activation le sont. Après
// enregistrement, on re-déclare aussitôt la topologie au backend.
void handleSaveCircuits() {
  char key[8];
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    snprintf(key, sizeof(key), "lbl%d", k);
    if (server.hasArg(key)) copyToBuf(circuits[k].label, sizeof(circuits[k].label), server.arg(key));
    // Case à cocher : absente du POST quand elle est décochée.
    snprintf(key, sizeof(key), "en%d", k);
    circuits[k].enabled = server.hasArg(key);
  }
  saveCircuitsConfig();
  if (mqttConnected) announceDevice(); // met à jour les noms côté backend/app
  server.sendHeader("Location", "/", true);
  server.send(302, "text/plain", "");
}

// Commande directe d'un relais : /toggle?pin=35&on=1 (on omis = inverse l'état).
void handleToggle() {
  if (!server.hasArg("pin")) { server.send(400, "text/plain", "pin manquant"); return; }
  int pin = server.arg("pin").toInt();
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    if (circuits[k].pin == pin) {
      bool on = server.hasArg("on") ? (server.arg("on").toInt() != 0) : !circuits[k].state;
      circuits[k].state = on;
      digitalWrite(circuits[k].pin, on ? HIGH : LOW);
      Serial.printf("[WEB] Toggle pin %d => %s\n", pin, on ? "ON" : "OFF");
      break;
    }
  }
  handleState();
}

void handleState() {
  StaticJsonDocument<512> doc;
  JsonArray arr = doc.createNestedArray("circuits");
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    JsonObject o = arr.createNestedObject();
    o["pin"]        = circuits[k].pin;
    o["label"]      = circuits[k].label;
    o["enabled"] = circuits[k].enabled;
    o["state"]      = circuits[k].state;
  }
  char buf[512];
  serializeJson(doc, buf, sizeof(buf));
  server.send(200, "application/json", buf);
}

// Page de configuration (HTML+CSS+JS autonome, servie par l'ESP). Les valeurs
// courantes sont pré-remplies. Attributs en guillemets simples pour éviter tout
// échappement dans la chaîne C.
String configPageHtml() {
  String h;
  h.reserve(5000);
  h += F("<!DOCTYPE html><html lang='fr'><head><meta charset='utf-8'>"
         "<meta name='viewport' content='width=device-width,initial-scale=1'>"
         "<title>PowerLens - Configuration</title><style>"
         "body{font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:16px;background:#f8fafc;color:#0f172a}"
         "h1{font-size:1.15rem}h2{font-size:1rem;margin:0 0 4px}"
         "section{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px}"
         "label{display:block;font-size:.8rem;color:#64748b;margin:10px 0 2px}"
         "input{width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:8px;font-size:1rem}"
         "button{background:#1e40af;color:#fff;border:0;border-radius:8px;padding:11px 14px;font-size:1rem;margin-top:14px;cursor:pointer;width:100%}"
         ".row{display:flex;gap:10px;align-items:center;margin:8px 0}.row b{width:54px}"
         ".sw{margin-left:auto;padding:7px 16px;border-radius:999px;border:1px solid #cbd5e1;cursor:pointer;font-weight:600}"
         ".on{background:#10b981;color:#fff;border-color:#10b981}.off{background:#fff;color:#64748b}"
         "details{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:8px 16px;margin-bottom:14px}"
         "summary{cursor:pointer;font-weight:600;padding:8px 0}"
         "small{color:#94a3b8;display:block;margin-top:6px}"
         ".hint{font-size:.78rem;color:#94a3b8;margin-top:2px}"
         ".chk{display:flex;align-items:center;gap:8px;margin-top:8px}"
         ".chk input{width:auto}"
         "label.inline{display:inline;margin:0;font-size:.85rem;color:#0f172a}</style></head><body>"
         "<h1>PowerLens - Configuration</h1>");

  // ── Section 1 : Identité + réseau ──
  h += F("<section><h2>Boitier &amp; reseau</h2><form method='POST' action='/wifi'>"
         "<label>Nom du boitier</label><input name='name' value='");
  h += deviceName;
  h += F("'><div class='hint'>Identifiant materiel : ");
  h += deviceUid;
  h += F(" (automatique). Ce nom est celui affiche dans l'application.</div>"
         "<label>Reseau WiFi (SSID)</label><input name='ssid' value='");
  h += wifiSsid;
  h += F("'><label>Mot de passe WiFi</label><input name='pass' type='password' placeholder='(inchange si vide)'>"
         "<label>Adresse du broker</label><input name='broker' value='");
  h += mqttHost;
  h += F(":");
  h += String(mqttPort);
  h += F("'><div class='hint'>Local : IP:port (ex. 192.168.1.10:1883). Broker cloud : hote:8883 (ex. abc123.s1.eu.hivemq.cloud:8883).</div>"
         "<div class='chk'><input type='checkbox' id='mtls' name='mtls'");
  h += (mqttTls ? F(" checked") : F(""));
  h += F("><label for='mtls' class='inline'>Connexion securisee TLS (broker cloud)</label></div>"
         "<label>Utilisateur MQTT</label><input name='muser' value='");
  h += mqttUser;
  h += F("' placeholder='(vide si broker local)'>"
         "<label>Mot de passe MQTT</label><input name='mpass' type='password' placeholder='(inchange si vide)'>"
         "<button type='submit'>Enregistrer &amp; redemarrer</button></form></section>");

  // ── Section 2 : Relais (toggles live, bien visibles) ──
  h += F("<section><h2>Relais</h2><div id='sw'></div>"
         "<small>Commande directe du relais, independante de l'app.</small></section>");

  // ── Section avancée (repliée) : mapping pin → circuit ──
  h += F("<details open><summary>Nommer les charges</summary>"
         "<form method='POST' action='/circuits'>"
         "<div class='hint'>Donne un nom a chaque charge branchee : c'est ce nom qui apparaitra dans l'application. Decoche les pins non cablees.</div>");
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    String kk = String(k);
    h += F("<label>Pin ");
    h += String(circuits[k].pin);
    h += F("</label><input name='lbl");
    h += kk;
    h += F("' value='");
    h += circuits[k].label;
    h += F("'><div class='chk'><input type='checkbox' id='en");
    h += kk;
    h += F("' name='en");
    h += kk;
    h += F("'");
    h += (circuits[k].enabled ? F(" checked") : F(""));
    h += F("><label for='en");
    h += kk;
    h += F("' class='inline'>Charge branchee sur cette pin</label></div>");
  }
  h += F("<button type='submit'>Enregistrer les charges</button></form></details>");

  // JS : remplit les toggles depuis /state, rafraîchit toutes les 4 s
  h += F("<script>"
         "async function load(){let r=await fetch('/state');let d=await r.json();"
         "let e=document.getElementById('sw');e.innerHTML='';"
         "d.circuits.forEach(function(c){var row=document.createElement('div');row.className='row';"
         "row.innerHTML=\"<b>Pin \"+c.pin+\"</b><span>\"+(c.label||'-')+\"</span>\";"
         "var b=document.createElement('button');b.className='sw '+(c.state?'on':'off');"
         "b.textContent=c.state?'ON':'OFF';"
         "b.onclick=async function(){await fetch('/toggle?pin='+c.pin+'&on='+(c.state?0:1));load();};"
         "row.appendChild(b);e.appendChild(row);});}"
         "load();setInterval(load,4000);</script></body></html>");

  return h;
}
