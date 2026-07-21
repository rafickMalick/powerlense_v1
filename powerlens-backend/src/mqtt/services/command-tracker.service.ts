import { Injectable } from '@nestjs/common';
import { AlertLevel } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../../modules/audit/audit.service';
import logger from '../../utils/logger';

const ACK_TIMEOUT_MS = Number(process.env.COMMAND_ACK_TIMEOUT_MS) || 10000;

interface PendingCommand {
  circuitId: string;
  isActive: boolean;
  timeout: NodeJS.Timeout;
}

/**
 * Corrèle chaque commande ON/OFF envoyée à un circuit à son accusé de
 * réception (`correlationId`, écho par le firmware — cf. code_arduno.ino
 * `onMqttMessage`/`publishAck`). Sans ACK dans le délai imparti, la commande
 * est très probablement partie sur un topic que rien n'écoute — le cas
 * typique étant un `Circuit.deviceId` en base qui ne correspond plus au
 * module physique réel (device renommé/remplacé). Plutôt que de laisser
 * l'interrupteur mobile silencieusement sans effet, ce service rend
 * l'échec visible (alerte + audit) dès qu'il se produit, pour n'importe
 * quel device, sans intervention manuelle.
 */
@Injectable()
export class CommandTrackerService {
  private readonly pending = new Map<string, PendingCommand>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly auditService: AuditService,
  ) {}

  track(correlationId: string, circuitId: string, isActive: boolean): void {
    const timeout = setTimeout(() => {
      void this.handleTimeout(correlationId);
    }, ACK_TIMEOUT_MS);
    this.pending.set(correlationId, { circuitId, isActive, timeout });
  }

  /**
   * À appeler dès qu'un ACK arrive. Retourne l'état voulu par la commande
   * d'origine si elle était suivie et confirmée, sinon `null` (ACK inconnu,
   * déjà expiré, ou commande en échec côté matériel).
   */
  resolve(
    correlationId: string,
    success: boolean,
  ): { circuitId: string; isActive: boolean } | null {
    const entry = this.pending.get(correlationId);
    if (!entry) return null;
    clearTimeout(entry.timeout);
    this.pending.delete(correlationId);
    return success ? { circuitId: entry.circuitId, isActive: entry.isActive } : null;
  }

  private async handleTimeout(correlationId: string): Promise<void> {
    const entry = this.pending.get(correlationId);
    if (!entry) return;
    this.pending.delete(correlationId);

    logger.warn(
      'Commande MQTT sans accusé de réception — device injoignable ou deviceId en base désynchronisé du module physique',
      { correlationId, circuitId: entry.circuitId, timeoutMs: ACK_TIMEOUT_MS },
    );

    await this.auditService.log({
      actorType: 'SYSTEM',
      action: 'COMMAND_TIMEOUT',
      targetType: 'CIRCUIT',
      targetId: entry.circuitId,
      metadata: { correlationId, timeoutMs: ACK_TIMEOUT_MS },
    });

    const alert = await this.prisma.alert
      .create({
        data: {
          level: AlertLevel.WARNING,
          message:
            'Commande non confirmée par le matériel pour un circuit — vérifier que le device associé en base correspond au module physique réel (deviceId).',
        },
      })
      .catch((err: unknown) => {
        logger.error('[CommandTracker] Échec création alerte', { err });
        return null;
      });

    if (alert) this.realtime.emitAlert(alert);
  }
}
