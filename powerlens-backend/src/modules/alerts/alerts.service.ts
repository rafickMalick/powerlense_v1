import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MqttService } from '../../mqtt/mqtt.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';
import { alertTopic } from '../../mqtt/config/mqtt.config';
import { AlertsQueryDto } from './dto/alerts-query.dto';
import logger from '../../utils/logger';

const DEFAULT_PAGE_SIZE = 20;

interface CreateAndPublishInput {
  level: AlertLevel;
  message: string;
  ruleId?: string;
  buildingId?: string;
  zoneId?: string;
}

/**
 * Point d'entrée UNIQUE pour créer + publier (MQTT) + journaliser une
 * alerte. Remplace la création directe `prisma.alert.create` qui vivait
 * dans `MeasurementListener.handleRuleDecisions` (RC1 — cf. STATE.md V9/V10).
 */
@Injectable()
export class AlertsService {
  constructor(
    private prisma: PrismaService,
    private mqttService: MqttService,
    private realtime: RealtimeGateway,
    private auditService: AuditService,
  ) {}

  async findAll(query: AlertsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.AlertWhereInput = {
      buildingId: query.buildingId,
      zoneId: query.zoneId,
      level: query.level,
      acknowledged: query.acknowledged,
    };

    const [items, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.alert.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async acknowledge(id: string, user: { id: string }) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');

    const updated = await this.prisma.alert.update({
      where: { id },
      data: { acknowledged: true },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: user.id,
      action: 'ALERT_ACKNOWLEDGED',
      targetType: 'ALERT',
      targetId: id,
    });

    // Ferme la boucle avec le buzzer firmware (cf. STATE.md V9) : un message
    // "cleared:true" sur le même topic permet l'arrêt immédiat côté ESP32,
    // sans attendre la fin du pattern auto-terminé.
    await this.publishMqtt(
      { id: updated.id, level: updated.level, message: updated.message },
      updated.zoneId ?? undefined,
      updated.buildingId ?? undefined,
      /* cleared */ true,
    );

    return updated;
  }

  async createAndPublish(input: CreateAndPublishInput) {
    const alert = await this.prisma.alert.create({
      data: {
        level: input.level,
        message: input.message,
        ruleId: input.ruleId,
        buildingId: input.buildingId,
        zoneId: input.zoneId,
      },
    });

    // Diffusion temps réel inchangée (même shape qu'avant, +zoneId additif).
    this.realtime.emitAlert(alert);

    // Fire-and-forget : ne bloque jamais le chemin d'évaluation des règles
    // (cf. handleRuleDecisions) si le broker MQTT est indisponible.
    void this.publishMqtt(
      { id: alert.id, level: alert.level, message: alert.message },
      input.zoneId,
      input.buildingId,
    ).catch((err) => {
      logger.error('Échec publication MQTT alerte', {
        alertId: alert.id,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    await this.auditService.log({
      actorType: 'SYSTEM',
      action: 'ALERT_PUBLISHED',
      targetType: 'ALERT',
      targetId: alert.id,
      metadata: { level: alert.level, buildingId: input.buildingId, zoneId: input.zoneId, ruleId: input.ruleId },
    });

    return alert;
  }

  /**
   * Résout le(s) topic(s) MQTT device-level à publier selon la portée de
   * l'alerte : ZONE -> device(s) possédant un circuit dans cette zone ;
   * BUILDING (pas de zoneId) -> tous les devices du bâtiment ("topic
   * global" demandé par la mission = fan-out vers chaque device, le
   * contrat MQTT reste strictement scopé par device).
   */
  private async publishMqtt(
    alert: { id: string; level: AlertLevel; message: string },
    zoneId?: string,
    buildingId?: string,
    cleared = false,
  ) {
    let devices: { deviceUid: string; buildingId: string }[] = [];

    if (zoneId) {
      const circuits = await this.prisma.circuit.findMany({
        where: { zoneId },
        include: { device: true },
        distinct: ['deviceId'],
      });
      devices = circuits.map((c) => c.device);
    }

    // Fallback bâtiment-large : soit l'alerte n'a pas de zoneId (portée
    // bâtiment explicite), soit la zone ciblée n'a aucun circuit propre —
    // cas réel des zones BUILDING (agrégation pure, jamais de circuits, cf.
    // seed.ts) qui publient pourtant des mesures et peuvent déclencher des
    // règles/alertes. Sans ce fallback, une alerte scopée à la zone
    // BUILDING ne serait jamais publiée sur aucun device (bug trouvé en
    // test live, cf. STATE.md V10).
    if (devices.length === 0 && buildingId) {
      devices = await this.prisma.device.findMany({ where: { buildingId } });
    }

    for (const device of devices) {
      const topic = alertTopic(device.buildingId, device.deviceUid);
      this.mqttService.publish(topic, {
        alertId: alert.id,
        level: alert.level,
        message: alert.message,
        zoneId,
        cleared,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
