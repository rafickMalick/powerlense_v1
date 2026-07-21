import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AlertLevel } from '@prisma/client';
import { MqttService } from '../mqtt/mqtt.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../modules/audit/audit.service';
import { mqttConfig } from '../mqtt/config/mqtt.config';
import { SimulatorService } from './simulator.service';
import logger from '../utils/logger';

/**
 * Surveille le bus MQTT pour détecter la présence ou l'absence d'ESP32 réels.
 * Bascule automatiquement entre le simulateur et les données MQTT hardware
 * sans nécessiter de redémarrage.
 *
 * Protocole de détection :
 * - Les messages publiés par SimulatorService contiennent { _sim: true }.
 * - Tout message sur measureSub SANS le champ _sim est considéré comme
 *   provenant d'un ESP32 physique → lastRealTrafficAt est mis à jour.
 * - Un timer vérifie périodiquement si lastRealTrafficAt est récent.
 *   Si non → activation du simulateur (et inversement).
 */
@Injectable()
export class ProviderSwitcherService implements OnModuleInit, OnModuleDestroy {
  private lastRealTrafficAt: Date | null = null;
  // `null` = statut pas encore déterminé (avant la 1ère évaluation). Distinct
  // de `false` pour garantir qu'un `provider:switched` est bien émis au moins
  // une fois au démarrage — sinon, si du trafic ESP réel est déjà présent dès
  // le boot, `hasReal && this.isSimulating` (=== false) ne devient jamais
  // vrai et `switchToMqtt()` (qui émet l'évènement) n'est jamais appelé : le
  // frontend reste bloqué sur son mode par défaut ('simulator').
  private isSimulating: boolean | null = null;
  private checkInterval?: NodeJS.Timeout;
  private startupTimeout?: NodeJS.Timeout;

  constructor(
    private readonly mqtt: MqttService,
    private readonly simulator: SimulatorService,
    private readonly realtime: RealtimeGateway,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit() {
    // Écoute toutes les mesures MQTT (y compris simulées)
    this.mqtt.subscribe(mqttConfig.topics.measureSub, (_, message) => {
      try {
        const payload = JSON.parse(message.toString()) as Record<string, unknown>;
        // Ignorer les messages provenant du simulateur
        if (!payload._sim) {
          this.lastRealTrafficAt = new Date();
        }
      } catch {
        // payload non-JSON : ignoré
      }
    });

    const checkIntervalMs = Number(process.env.ESP_CHECK_INTERVAL_MS) || 5000;
    const startupWaitMs = Number(process.env.ESP_STARTUP_WAIT_MS) || 15000;

    // Première évaluation après le délai de démarrage
    this.startupTimeout = setTimeout(() => {
      void this.evaluate();
    }, startupWaitMs);

    // Évaluation périodique
    this.checkInterval = setInterval(() => {
      void this.evaluate();
    }, checkIntervalMs);

    logger.info(
      `[ProviderSwitcher] Démarré (délai initial ${startupWaitMs}ms, check toutes les ${checkIntervalMs}ms, timeout ESP ${this.getEspTimeoutMs()}ms)`,
    );
  }

  onModuleDestroy() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private getEspTimeoutMs(): number {
    return Number(process.env.ESP_TIMEOUT_MS) || 30000;
  }

  private hasRecentRealTraffic(): boolean {
    if (!this.lastRealTrafficAt) return false;
    return Date.now() - this.lastRealTrafficAt.getTime() < this.getEspTimeoutMs();
  }

  private async evaluate(): Promise<void> {
    const hasReal = this.hasRecentRealTraffic();

    if (hasReal && this.isSimulating !== false) {
      await this.switchToMqtt();
    } else if (!hasReal && this.isSimulating !== true) {
      await this.switchToSimulator();
    }
  }

  private async switchToSimulator(): Promise<void> {
    this.simulator.startSimulation();
    this.isSimulating = true;

    logger.warn('[ProviderSwitcher] Aucun ESP détecté — simulateur activé');

    await this.auditService.log({
      actorType: 'SYSTEM',
      action: 'PROVIDER_SWITCHED_TO_SIMULATOR',
      targetType: 'SYSTEM',
      metadata: {
        reason: 'esp_timeout',
        lastRealTrafficAt: this.lastRealTrafficAt?.toISOString() ?? null,
      },
    });

    // Alerte technique visible dans l'app
    await this.prisma.alert
      .create({
        data: {
          level: AlertLevel.WARNING,
          message: 'Aucun ESP32 détecté sur le réseau — le simulateur de données a été activé automatiquement.',
        },
      })
      .then((alert) => {
        this.realtime.emitAlert(alert);
      })
      .catch((err: unknown) =>
        logger.error('[ProviderSwitcher] Échec création alerte', { err }),
      );

    this.realtime.emitProviderSwitch({ mode: 'simulator', reason: 'esp_timeout' });
  }

  private async switchToMqtt(): Promise<void> {
    this.simulator.stopSimulation();
    this.isSimulating = false;

    logger.info('[ProviderSwitcher] ESP détecté — bascule vers données réelles MQTT');

    await this.auditService.log({
      actorType: 'SYSTEM',
      action: 'PROVIDER_SWITCHED_TO_MQTT',
      targetType: 'SYSTEM',
      metadata: {
        reason: 'esp_reconnected',
        detectedAt: new Date().toISOString(),
      },
    });

    this.realtime.emitProviderSwitch({ mode: 'mqtt', reason: 'esp_reconnected' });
  }

  /** Exposé pour les tests */
  getIsSimulating(): boolean {
    return this.isSimulating === true;
  }
}
