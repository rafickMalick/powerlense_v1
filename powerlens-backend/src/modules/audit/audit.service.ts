import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';
import logger from '../../utils/logger';

const DEFAULT_LIMIT = 50;

/**
 * `AuditLog.id` est un BigInt (auto-incrément) : non sérialisable en JSON
 * tel quel, on le convertit en string pour l'API (cf. measurements.service.ts).
 */
function serializeAuditLog(log: AuditLog) {
  return { ...log, id: log.id.toString() };
}

export interface AuditLogEntry {
  actorType: string;
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Point d'entrée UNIQUE de journalisation ("journalisation unifiée") : tout
 * module qui doit produire un événement traçable (commande, connexion MQTT,
 * bascule simulateur, erreur API/WS, action utilisateur…) appelle `log()`
 * plutôt que d'écrire directement dans `prisma.auditLog`. Chaque appel est
 * systématiquement : (1) affiché dans le terminal backend, (2) enregistré
 * dans la table AuditLog, (3) consultable via GET /audit-logs.
 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    logger.info(
      `[AUDIT] ${entry.actorType} ${entry.action} ${entry.targetType}${entry.targetId ? '#' + entry.targetId : ''}`,
      entry.metadata ?? {},
    );

    try {
      await this.prisma.auditLog.create({
        data: { ...entry, metadata: entry.metadata as Prisma.InputJsonValue | undefined },
      });
    } catch (err) {
      logger.error('Échec écriture AuditLog', {
        err: err instanceof Error ? err.message : String(err),
        entry,
      });
    }
  }

  async findAll(query: AuditLogsQueryDto) {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? DEFAULT_LIMIT,
    });
    return logs.map(serializeAuditLog);
  }
}
