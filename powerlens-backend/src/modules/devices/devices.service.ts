import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Boîtiers (devices) auto-déclarés. La liste sert à la vue « Boîtiers » de
 * l'app : chaque boîtier avec son nom (défini dans son portail) et ses charges.
 * Le statut en ligne/hors ligne temps réel arrive par WebSocket (`device:status`,
 * LWT MQTT) — non recalculé ici.
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.device.findMany({
      orderBy: { name: 'asc' },
      include: {
        building: { select: { id: true, name: true } },
        circuits: {
          orderBy: { pin: 'asc' },
          select: {
            id: true,
            name: true,
            pin: true,
            type: true,
            isActive: true,
            isCritical: true,
            zoneId: true,
          },
        },
      },
    });
  }
}
