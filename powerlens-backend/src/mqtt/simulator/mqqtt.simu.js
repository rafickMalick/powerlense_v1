const mqtt = require('mqtt');
const readline = require('readline');

const client = mqtt.connect('mqtt://localhost:1883');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const CONFIG = {
  buildingId: 'bld-chicago-001',
  deviceId: 'circuit-main-01'
};

client.on('connect', () => {
  console.log('✅ Connecté au Broker MQTT');
  showMenu();
});

function showMenu() {
  console.log(`
--- MENU DE SIMULATION ---
1. Envoyer TEMP Normale (22°C)
2. Envoyer TEMP Critique (95°C) -> Doit déclencher ALERT
3. Envoyer CONSOMMATION Excessive -> Doit déclencher SWITCH_OFF
4. Envoyer JSON Invalide (Test de crash)
q. Quitter
--------------------------`);
  ask();
}

function ask() {
  rl.question('Choix : ', (choice) => {
    let payload = {
      buildingId: CONFIG.buildingId,
      simulated: true,
      timestamp: new Date().toISOString()
    };

    switch (choice) {
      case '1':
        publish('measurements/temp', { ...payload, type: 'temperature', value: 22 });
        break;
      case '2':
        publish('measurements/temp', { ...payload, type: 'temperature', value: 95 });
        break;
      case '3':
        publish('measurements/energy', { ...payload, type: 'energy', value: 5000, targetId: CONFIG.deviceId });
        break;
      case '4':
        client.publish('measurements/temp', '{"error": "broken'); 
        console.log('⚠️  Payload corrompu envoyé');
        break;
      case 'q':
        client.end();
        process.exit();
      default:
        console.log('❌ Choix invalide');
    }
    
    // On boucle pour pouvoir envoyer un autre message
    setTimeout(ask, 100); 
  });
}

function publish(topic, data) {
  client.publish(topic, JSON.stringify(data), { qos: 1 });
  console.log(`🚀 Message envoyé sur [${topic}]`);
}