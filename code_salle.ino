// =============================================================================
// PowerLens — Firmware ESP32-S3 — MODULE SALLE (ESP32-PL-001)
// =============================================================================
// Ce module est physiquement installé dans la Salle de Réunion : PZEM004T
// (V/I/P/E/Hz/PF réels) + SHT35 (température réelle) + PIR (présence, lue en
// local ET transmise dans le payload MQTT de la zone Salle) + 4 relais
// pilotant les 4 circuits de la salle.
// Il publie aussi, à titre de secours ("ensemble"), une estimation SIMULÉE du
// Couloir et du Départ Général tant que les modules dédiés (ESP32-PL-002,
// etc.) ne sont pas en ligne — dès qu'un vrai module publie pour une zone,
// `measurements.service.ts` bascule dessus (cf. STATE.md V4).
// =============================================================================
#include <Arduino.h>
#include <WiFi.h>
#include "mqtt_client.h"   // esp-mqtt (client MQTT natif ESP-IDF, inclus dans le core Arduino ESP32)
#include <ArduinoJson.h>
#include <time.h>
#include <Wire.h>
#include <HardwareSerial.h>
#include <PZEM004Tv30.h>

// ─── CONFIGURATION RÉSEAU ─────────────────────────────────────────────────────
const char* WIFI_SSID = "T671H7857switchphone";
const char* WIFI_PASS = "01638525";

// IP LAN du PC de démo (broker Mosquitto + backend NestJS)
const char* MQTT_HOST = "172.30.211.227";
const int   MQTT_PORT = 1883;

// Keepalive MQTT : défaut PubSubClient (15 s), sorti en constante pour être
// ajustable. Il borne le délai de détection du LWT par le broker (~1,5× le
// keepalive, soit ~22 s) — c'est la latence de détection d'un ESP disparu.
const int   MQTT_KEEPALIVE_S = 15;
const char* FIRMWARE_VERSION = "salle-lwt-1.0";

// ─── IDENTIFIANTS POWERLENS ───────────────────────────────────────────────────
const char* BUILDING_ID = "a91d4911-0651-4221-b8d3-7781de57e213"; // Building.id (SCOP)
const char* DEVICE_UID  = "ESP32-PL-001";

const char* ZONE_ROOM_ID     = "baf11948-4740-4d42-be62-f0d787bb8d5a"; // Salle de Réunion (réel)
const char* ZONE_CORRIDOR_ID = "b0e06915-e248-45ef-9caa-408f765cc570"; // Couloir Principal (simulé, secours)
const char* ZONE_BUILDING_ID = "d6f0d04a-8514-40d7-a95d-0a6fe9b94f88"; // Départ général (simulé, secours)

// ─── PINS HARDWARE (ne pas modifier — déjà câblés) ────────────────────────────
#define SDA_PIN      8
#define SCL_PIN      9
#define SHT35_ADDR   0x45

#define PZEM_RX_PIN  48
#define PZEM_TX_PIN  47

#define PRESENCE_PIN 14 // ⚠️ non confirmé — déplacé de la pin 10 (désormais Charge 1) — à valider câblage

// ─── CIRCUITS DE LA SALLE — 4 charges, 1 relais chacune ──────────────────────
// charge 1 = Éclairage, charge 2 = Prises, charge 3 = Climatisation, charge 4 = Brasseur.
// ⚠️ Pins 10/11/12/13 : remapping complet suite à confirmation du câblage réel
// des 4 relais — à valider contre le câblage réel avant flashage.
struct CircuitBinding {
  const char* id;
  const char* label;
  uint8_t     pin;
  bool        state; // ON par défaut au démarrage
};

CircuitBinding circuits[] = {
  { "b528100e-78c5-4860-9e70-f610c7d835d9", "Charge 1 - Eclairage Salle",      10, true }, // Éclairage Salle de Réunion
  { "2bf8e37e-1598-4a72-b0a3-b237d4f5e33f", "Charge 2 - Prises Salle",         11, true }, // Prises Salle de Réunion
  { "b2682c9b-0b83-4a0e-a98b-d1aac173695a", "Charge 3 - Climatisation Salle",  12, true }, // Climatisation Salle de Réunion
  { "f064ba71-68d8-4871-8572-573d9ed1f815", "Charge 4 - Brasseur Salle",       13, true }, // Brasseur Salle de Réunion
};
const int NUM_CIRCUITS = sizeof(circuits) / sizeof(circuits[0]);

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
char mqttUri[64];                    // "mqtt://host:port" — construit dans setup()
PZEM004Tv30  *pzem = nullptr;

// ─── TOPICS ───────────────────────────────────────────────────────────────────
char topicMeasure[160];
char topicCmdWildcard[160]; // powerlens/{building}/{device}/command/#  (abonnement)
char topicCmdPrefix[160];   // powerlens/{building}/{device}/command/   (pour extraire le circuitId reçu)
char topicEvent[160];
char topicAlert[160];       // powerlens/{building}/{device}/alert      (abonnement — alertes backend)
char topicStatus[160];      // powerlens/{building}/{device}/status     (LWT + online retained — présence)

// ─── PRÉSENCE (debounce) — lue localement, transmise pour la zone Salle ───────
bool dernierEtatPresence = false;
bool presenceCourante = false;
int compteurPresence = 0;
const int SEUIL_DEBOUNCE = 5;

// ─── SHT35 ────────────────────────────────────────────────────────────────────
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
void viderBufferPZEM();
float lirePZEMavecRetry(float (*lecture)(), int tentatives = 3);
void startBuzzer(const char* level, const char* alertId);
void stopBuzzer();
void updateBuzzer();

// ─── SETUP ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("=== PowerLens ESP32 — MODULE SALLE ===");
  Serial.printf("Broker MQTT : %s:%d\n", MQTT_HOST, MQTT_PORT);
  Serial.printf("Zone reelle : Salle de Reunion — Couloir/Batiment publies en secours (simules)\n");
  Serial.printf("Circuits pilotes (%d) :\n", NUM_CIRCUITS);
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    Serial.printf("  - %s (pin %d) => %s\n", circuits[k].label, circuits[k].pin, circuits[k].id);
  }

  Wire.begin(SDA_PIN, SCL_PIN);
  pzem = new PZEM004Tv30(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

  pinMode(PRESENCE_PIN, INPUT_PULLDOWN);
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    pinMode(circuits[k].pin, OUTPUT);
    digitalWrite(circuits[k].pin, circuits[k].state ? HIGH : LOW);
  }

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW); // silencieux par défaut

  // Construction des topics de base
  snprintf(topicMeasure,      sizeof(topicMeasure),      "powerlens/%s/%s/measure", BUILDING_ID, DEVICE_UID);
  snprintf(topicCmdWildcard,  sizeof(topicCmdWildcard),  "powerlens/%s/%s/command/#", BUILDING_ID, DEVICE_UID);
  snprintf(topicCmdPrefix,    sizeof(topicCmdPrefix),    "powerlens/%s/%s/command/", BUILDING_ID, DEVICE_UID);
  snprintf(topicEvent,        sizeof(topicEvent),        "powerlens/%s/%s/event", BUILDING_ID, DEVICE_UID);
  snprintf(topicAlert,        sizeof(topicAlert),        "powerlens/%s/%s/alert", BUILDING_ID, DEVICE_UID);
  snprintf(topicStatus,       sizeof(topicStatus),       "powerlens/%s/%s/status", BUILDING_ID, DEVICE_UID);

  connectWiFi();

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

  Serial.println("=== Systeme demarre — Publication des 3 zones toutes les 5 s ===");
}

// ─── LOOP ─────────────────────────────────────────────────────────────────────
void loop() {
  if (!WiFi.isConnected()) connectWiFi();
  // esp-mqtt gère connexion/reconnexion dans sa propre tâche FreeRTOS :
  // ni reconnexion manuelle, ni mqtt.loop() ici.

  // --- Buzzer (non-bloquant) ---
  updateBuzzer();

  // --- Présence Réelle (debounce, lue localement uniquement) ---
  bool lecturePresence = digitalRead(PRESENCE_PIN);
  if (lecturePresence != dernierEtatPresence) {
    compteurPresence++;
    if (compteurPresence >= SEUIL_DEBOUNCE) {
      dernierEtatPresence = lecturePresence;
      presenceCourante = lecturePresence;
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
  Serial.printf("\nConnexion WiFi [%s]...", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
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
  Serial.printf("Connexion MQTT [%s:%d]...\n", MQTT_HOST, MQTT_PORT);
  snprintf(mqttUri, sizeof(mqttUri), "mqtt://%s:%d", MQTT_HOST, MQTT_PORT);

  esp_mqtt_client_config_t cfg = {};
  cfg.broker.address.uri            = mqttUri;
  cfg.credentials.client_id         = DEVICE_UID;       // clientId = deviceUid (inchangé)
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
      esp_mqtt_client_subscribe(mqttClient, topicAlert, 0);
      Serial.printf("Abonne au topic d'alerte : %s\n", topicAlert);
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
// circuit connu de ce module, l'action est quand même accusée comme reçue
// (ACK SUCCESS, cf. demande) mais une alerte claire est loggée en Serial —
// aucun relais n'est actionné dans ce cas.
void onMqttMessage(const char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload, length) != DeserializationError::Ok) {
    Serial.printf("[MQTT] JSON invalide sur %s\n", topic);
    return;
  }

  // ─── ALERTE (topic dédié, distinct des commandes) ────────────────────────
  if (strcmp(topic, topicAlert) == 0) {
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

  size_t prefixLen = strlen(topicCmdPrefix);
  if (strncmp(topic, topicCmdPrefix, prefixLen) != 0) {
    Serial.printf("[MQTT] Topic de commande inattendu, ignore : %s\n", topic);
    return;
  }
  const char* circuitIdStr = topic + prefixLen;

  char ackTopic[160];
  snprintf(ackTopic, sizeof(ackTopic), "powerlens/%s/%s/ack/%s", BUILDING_ID, DEVICE_UID, circuitIdStr);

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
      command, DEVICE_UID, circuitIdStr);
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
  // possédée (Salle), pas pour les paquets secours Couloir/Bâtiment. Permet
  // au front de savoir quelle charge est déjà ON/OFF (évite une commande
  // OFF redondante sur une charge déjà éteinte).
  if (includeCircuits) {
    JsonArray arr = doc.createNestedArray("circuits");
    for (int k = 0; k < NUM_CIRCUITS; k++) {
      JsonObject o = arr.createNestedObject();
      o["circuitId"] = circuits[k].id;
      o["isActive"]  = circuits[k].state;
    }
  }

  char buf[1024];
  size_t len = serializeJson(doc, buf, sizeof(buf));
  esp_mqtt_client_publish(mqttClient, topicMeasure, buf, len, 0, 0); // QoS 0 (appelé depuis loop)
}

// ─── LOGIQUE DE PUBLICATION (RÉEL + SIMULATION) ───────────────────────────────
void publishMeasures() {
  Serial.printf("[STATUT] WiFi=%s | MQTT=%s\n",
                WiFi.isConnected() ? "CONNECTE" : "DECONNECTE",
                mqttConnected      ? "CONNECTE" : "DECONNECTE");

  if (!mqttConnected) return;

  // Caches des dernières valeurs PZEM réelles — utilisés par les paquets
  // secours (Couloir/Bâtiment) quand la salle est entièrement éteinte, pour
  // ne pas diviser par une tension nulle ni faire disparaître frequency/pf
  // de ces paquets. Ne concerne jamais le paquet de la zone Salle elle-même
  // (qui, lui, doit explicitement afficher des zéros — cf. plus bas).
  static float dernierVoltageLu   = 220.0f;
  static float dernierFrequenceLue = 50.0f;
  static float dernierPfLu        = 0.95f;
  static float dernierEnergyLue   = 0.0f;

  bool anyCircuitOn = false;
  for (int k = 0; k < NUM_CIRCUITS; k++) {
    if (circuits[k].state) { anyCircuitOn = true; break; }
  }

  float voltage, current, power, energy, frequency, pf;

  if (anyCircuitOn) {
    // 1. Lecture du capteur électrique REEL (Salle de Réunion)
    voltage   = lirePZEMavecRetry([]() { return pzem->voltage(); });
    delay(10);
    current   = lirePZEMavecRetry([]() { return pzem->current(); });
    delay(10);
    power     = lirePZEMavecRetry([]() { return pzem->power(); });
    delay(10);
    energy    = lirePZEMavecRetry([]() { return pzem->energy(); });
    delay(10);
    frequency = lirePZEMavecRetry([]() { return pzem->frequency(); });
    delay(10);
    pf        = lirePZEMavecRetry([]() { return pzem->pf(); });

    if (isnan(voltage)) {
      Serial.println("Erreur PZEM physique — Envois annulés pour ce cycle");
      return;
    }

    dernierVoltageLu    = voltage;
    dernierFrequenceLue = frequency;
    dernierPfLu         = pf;
    dernierEnergyLue    = energy;
  } else {
    // Aucune charge allumée : on ne sollicite pas le PZEM, on publie des
    // zéros pour la zone Salle. L'énergie cumulée n'est PAS remise à zéro
    // (compteur réel) — on republie la dernière valeur connue.
    Serial.println("[SALLE] Toutes les charges sont eteintes — PZEM non interroge, publication de zeros");
    voltage   = 0.0f;
    current   = 0.0f;
    power     = 0.0f;
    energy    = dernierEnergyLue;
    frequency = NAN; // omis du JSON (cf. guard isnan() dans envoyerPaquetZone)
    pf        = NAN;
  }

  // ─── ZONE 1 : SALLE DE RÉUNION (Données Réelles + présence + états relais) ─
  envoyerPaquetZone(ZONE_ROOM_ID, voltage, current, power, energy, frequency, pf, /*sendPresence=*/true, presenceCourante, dernTemp, /*includeCircuits=*/true);
  Serial.printf("[SALLE] %0.1fV | %0.2fA | %0.1fW | Temp: %0.1f°C | Pres: %s\n",
                voltage, current, power, dernTemp, presenceCourante ? "OUI" : "NON");

  delay(60); // Petit temps mort pour l'envoi MQTT sequentially

  // Base électrique stable pour les paquets secours — dernière valeur réelle
  // connue, jamais les zéros de la salle éteinte (évite division par zéro).
  float mainsVoltage   = anyCircuitOn ? voltage   : dernierVoltageLu;
  float mainsFrequency = anyCircuitOn ? frequency : dernierFrequenceLue;
  float mainsPf        = anyCircuitOn ? pf        : dernierPfLu;

  // ─── ZONE 2 : COULOIR (Données Simulées, secours tant qu'ESP32-PL-002 absent) ──
  float simPowerCorridor = 150.0f;
  float simCurrentCorridor = simPowerCorridor / mainsVoltage;
  bool simPresenceCorridor = (millis() % 30000 < 8000); // Mouvement détecté 8s toutes les 30s
  float simTempCorridor = 21.5f; // Température fictive stable

  envoyerPaquetZone(ZONE_CORRIDOR_ID, mainsVoltage, simCurrentCorridor, simPowerCorridor, energy * 0.35f, mainsFrequency, mainsPf, /*sendPresence=*/true, simPresenceCorridor, simTempCorridor);
  Serial.printf("[COULOIR] %0.1fV | %0.2fA | %0.1fW | Temp: %0.1f°C | Pres: %s (SIM)\n",
                mainsVoltage, simCurrentCorridor, simPowerCorridor, simTempCorridor, simPresenceCorridor ? "OUI" : "NON");

  delay(60);

  // ─── ZONE 3 : DÉPART GÉNÉRAL (Données Simulées) ────────────────────────────
  float simPowerBuilding = power + simPowerCorridor + 400.0f;
  float simCurrentBuilding = simPowerBuilding / mainsVoltage;
  float simEnergyBuilding = energy + (energy * 0.35f) + 12.5f;

  envoyerPaquetZone(ZONE_BUILDING_ID, mainsVoltage, simCurrentBuilding, simPowerBuilding, simEnergyBuilding, mainsFrequency, mainsPf, /*sendPresence=*/false, false, NAN);
  Serial.printf("[BATIMENT-GEN] %0.1fV | %0.2fA | %0.1fW (SIM)\n", mainsVoltage, simCurrentBuilding, simPowerBuilding);

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

// Annonce de présence : {online:true} publié en RETAINED sur topicStatus. Le
// retained permet à un client qui se connecte plus tard de recevoir aussitôt le
// dernier statut connu. QoS 0 (limite PubSubClient en publish) ; le willQos du
// LWT reste à 1. Republié périodiquement (cf. loop) pour compenser le QoS 0.
void publishStatusOnline() {
  StaticJsonDocument<160> doc;
  doc["online"]    = true;
  doc["deviceUid"] = DEVICE_UID;
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

// ─── GESTION PZEM ──────────────────────────────────────────────────────────────
void viderBufferPZEM() {
  while (Serial2.available()) Serial2.read();
}

float lirePZEMavecRetry(float (*lecture)(), int tentatives) {
  for (int i = 0; i < tentatives; i++) {
    viderBufferPZEM();
    float val = lecture();
    if (!isnan(val)) return val;
    delay(50);
  }
  return NAN;
}
