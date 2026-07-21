const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://localhost:1883');

// Configuration pour rendre le test réaliste
const CONFIG = {
  buildingId: 'bld-chicago-001',
  deviceId: 'circuit-main-01',
  interval: 5000 // 5 secondes
};

client.on('connect', () => {
  console.log('✅ Simulateur connecté au broker');

  // Boucle de simulation continue
  setInterval(() => {
    const isDangerous = Math.random() > 0.8; // 20% de chance de simuler une anomalie
    
    const payload = {
      buildingId: CONFIG.buildingId,
      targetId: CONFIG.deviceId, // Important pour le SWITCH_OFF action.targetId
      type: 'energy_consumption',
      value: isDangerous ? 950 : 120, // Simule un pic ou une valeur normale
      unit: 'kW',
      simulated: true,
      timestamp: new Date().toISOString()
    };

    const topic = `measurements/${payload.type}`;
    
    client.publish(topic, JSON.stringify(payload), { qos: 1 });
    
    console.log(`📡 Message envoyé sur ${topic} (Danger: ${isDangerous})`);
  }, CONFIG.interval);

  // 1. TEST DE RUPTURE : Payload corrompu (Toutes les 30 sec)
  setInterval(() => {
    client.publish('measurements/temp', '{"malformed_json": true, '); // JSON cassé
    console.warn('⚠️  Test d\'erreur envoyé : JSON invalide');
  }, 30000);

  // 2. TEST D'ALERTE : Température critique
  setTimeout(() => {
    client.publish('measurements/temp', JSON.stringify({
      buildingId: CONFIG.buildingId,
      type: 'temperature',
      value: 100, // Devrait déclencher l'action ALERT dans ton RuleEngine
      simulated: true
    }));
    console.log('🔥 Test d\'alerte envoyé : Température critique');
  }, 2000);
});

client.on('error', (err) => {
  console.error('❌ Erreur MQTT:', err);
});