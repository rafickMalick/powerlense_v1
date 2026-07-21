export const mqttConfig = {
  brokerUrl: process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883',
  // Identifiants du broker — vides en local (Mosquitto anonyme), requis par les
  // brokers managés (HiveMQ Cloud, EMQX…) qui imposent TLS + authentification.
  // L'URL passe alors de `mqtt://host:1883` à `mqtts://host:8883`.
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: 'rule-engine-client',
  options: {
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 2000,
  },
  topics: {
    // Souscriptions (wildcards MQTT, `+` = un niveau)
    measureSub: 'powerlens/+/+/measure',
    ackSub: 'powerlens/+/+/ack/+',
    eventSub: 'powerlens/+/+/event',
    statusSub: 'powerlens/+/+/status',
    announceSub: 'powerlens/+/+/announce',
  },
};

/**
 * Contrat MQTT PowerLens :
 *  - Mesures   : powerlens/{buildingId}/{deviceId}/measure
 *  - Commandes : powerlens/{buildingId}/{deviceId}/command/{circuitId}
 *  - Acks      : powerlens/{buildingId}/{deviceId}/ack/{circuitId}
 *  - Événements: powerlens/{buildingId}/{deviceId}/event
 *  - Alertes   : powerlens/{buildingId}/{deviceId}/alert (backend → device, publish-only, pas de souscription backend)
 *  - Statut    : powerlens/{buildingId}/{deviceId}/status (device → backend, LWT + online retained ; présence matérielle)
 */
export function measureTopic(buildingId: string, deviceId: string): string {
  return `powerlens/${buildingId}/${deviceId}/measure`;
}

export function commandTopic(
  buildingId: string,
  deviceId: string,
  circuitId: string,
): string {
  return `powerlens/${buildingId}/${deviceId}/command/${circuitId}`;
}

export function ackTopic(
  buildingId: string,
  deviceId: string,
  circuitId: string,
): string {
  return `powerlens/${buildingId}/${deviceId}/ack/${circuitId}`;
}

export function eventTopic(buildingId: string, deviceId: string): string {
  return `powerlens/${buildingId}/${deviceId}/event`;
}

/**
 * Alertes : un seul topic PAR DEVICE (pas par circuit) — les deux firmwares
 * (salle/couloir) s'y abonnent au démarrage comme ils le font déjà pour
 * command/#. La portée de l'alerte (zone/bâtiment) est encodée dans le
 * PAYLOAD (zoneId), pas dans le topic — une alerte n'a pas de cible
 * d'exécution unique comme une commande.
 */
export function alertTopic(buildingId: string, deviceId: string): string {
  return `powerlens/${buildingId}/${deviceId}/alert`;
}

/**
 * Statut de présence du device (Last Will and Testament MQTT). Le device
 * publie `{online:true}` (retained) à la connexion et republie périodiquement ;
 * le broker publie le LWT `{online:false}` (retained) à sa place dès qu'il le
 * déclare mort (timeout keepalive). Détection primaire de déconnexion —
 * `ProviderSwitcherService`/`ESP_TIMEOUT_MS` ne sert plus que de filet.
 */
export function statusTopic(buildingId: string, deviceId: string): string {
  return `powerlens/${buildingId}/${deviceId}/status`;
}

/**
 * Auto-déclaration d'un boîtier (retained, device → backend). Le boîtier y
 * décrit son identité (uid + nom), la zone qu'il supervise et ses charges
 * (UUID + nom + pin) : le backend en fait un upsert Device/Zone/Circuits.
 * C'est ce message qui fait apparaître un nouveau boîtier dans l'application —
 * il n'y a plus d'identifiants codés en dur côté firmware.
 */
export function announceTopic(buildingId: string, deviceId: string): string {
  return `powerlens/${buildingId}/${deviceId}/announce`;
}

/**
 * Extrait { buildingId, deviceId, segment, last } d'un topic
 * `powerlens/{buildingId}/{deviceId}/{segment}[/{last}]`.
 */
export function parseTopic(topic: string): {
  buildingId?: string;
  deviceId?: string;
  segment?: string;
  last?: string;
} {
  const [, buildingId, deviceId, segment, last] = topic.split('/');
  return { buildingId, deviceId, segment, last };
}
