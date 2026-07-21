import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { mqttConfig } from './config/mqtt.config';
import { AuditService } from '../modules/audit/audit.service';
import logger from '../utils/logger';

@Injectable()
export class MqttService implements OnModuleDestroy {
  private client: mqtt.MqttClient;
  private readonly subscribedTopics = new Set<string>();
  private wasConnected = false;

  constructor(private readonly auditService: AuditService) {
    this.client = mqtt.connect(mqttConfig.brokerUrl, {
      clientId: mqttConfig.clientId,
      // Identifiants transmis uniquement s'ils sont définis (broker managé) —
      // un Mosquitto local anonyme les ignore.
      username: mqttConfig.username,
      password: mqttConfig.password,
      ...mqttConfig.options,
    });

    this.client.on('connect', () => {
      logger.info('MQTT connecté avec succès');
      this.wasConnected = true;
      this.resubscribeAll();
      void this.auditService.log({
        actorType: 'SYSTEM',
        action: 'MQTT_CONNECTED',
        targetType: 'SYSTEM',
        metadata: { brokerUrl: mqttConfig.brokerUrl },
      });
    });

    this.client.on('reconnect', () => {
      logger.warn('Reconnexion MQTT...');
    });

    this.client.on('close', () => {
      if (!this.wasConnected) return; // évite un faux "disconnect" avant la 1ère connexion
      this.wasConnected = false;
      logger.warn('Connexion MQTT perdue');
      void this.auditService.log({
        actorType: 'SYSTEM',
        action: 'MQTT_DISCONNECTED',
        targetType: 'SYSTEM',
      });
    });

    this.client.on('error', (err) => {
      logger.error('Erreur MQTT', err);
      void this.auditService.log({
        actorType: 'SYSTEM',
        action: 'MQTT_ERROR',
        targetType: 'SYSTEM',
        metadata: { message: err instanceof Error ? err.message : String(err) },
      });
    });
  }

  private resubscribeAll() {
    for (const topic of this.subscribedTopics) {
      this.client.subscribe(topic);
    }
  }

  subscribe(topic: string, callback: mqtt.OnMessageCallback) {
    this.subscribedTopics.add(topic);
    this.client.subscribe(topic);
    this.client.on('message', callback);
  }

  publish(topic: string, payload: any) {
    this.client.publish(topic, JSON.stringify(payload));
    logger.info(`MQTT publish → ${topic}`, payload);
  }

  onModuleDestroy() {
    logger.warn('Arrêt MQTT');
    this.client.end();
  }
}
