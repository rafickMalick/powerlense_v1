import { Injectable, NotFoundException } from '@nestjs/common';
import { BuildingPowerStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { measureTopic } from '../../mqtt/config/mqtt.config';
import { CircuitsService } from '../circuits/circuits.service';
import { AuditService } from '../audit/audit.service';
import { FindZonesQueryDto } from './dto/find-zones-query.dto';

@Injectable()
export class ZonesService {
  constructor(
    private prisma: PrismaService,
    private circuitsService: CircuitsService,
    private auditService: AuditService,
  ) {}

  findAll(query: FindZonesQueryDto = {}) {
    return this.prisma.monitoringZone.findMany({
      where: {
        ...(query.buildingId ? { buildingId: query.buildingId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.floor !== undefined ? { floor: query.floor } : {}),
      },
      include: { building: true, parent: true },
    });
  }

  async findById(id: string) {
    const zone = await this.prisma.monitoringZone.findUnique({
      where: { id },
      include: { building: true, parent: true, children: true },
    });

    if (!zone) throw new NotFoundException('Zone not found');

    return zone;
  }

  async getCircuits(zoneId: string) {
    const zone = await this.prisma.monitoringZone.findUnique({
      where: { id: zoneId },
      include: { circuits: true },
    });

    if (!zone) throw new NotFoundException('Zone not found');

    return zone.circuits;
  }

  /** Canaux mesurés par la zone — catalogue de grandeurs disponibles (V4). */
  async getChannels(zoneId: string) {
    const zone = await this.prisma.monitoringZone.findUnique({
      where: { id: zoneId },
      include: { building: true, circuits: { include: { device: true }, take: 1 } },
    });

    if (!zone) throw new NotFoundException('Zone not found');

    const channels = await this.prisma.channel.findMany({ where: { zoneId } });
    const device = zone.circuits[0]?.device;
    const topic = device ? measureTopic(zone.building.id, device.deviceUid) : undefined;

    return channels.map((ch) => ({ ...ch, topic }));
  }

  /**
   * Bascule groupée de l'alimentation d'UNE zone (salle/couloir) — pendant
   * de `BuildingsService.setPowerStatus` mais limité aux circuits de cette
   * zone. Réutilise `CircuitsService.setActive` par circuit (MQTT + audit +
   * WebSocket déjà gérés là-bas) puis ajoute UNE entrée d'audit groupée pour
   * l'action. `MonitoringZone` n'a pas de colonne `powerStatus` persistée
   * (contrairement à `Building`) — le statut affiché côté mobile reste dérivé
   * de l'état des circuits.
   */
  async setPowerStatus(zoneId: string, status: BuildingPowerStatus) {
    await this.findById(zoneId);

    const circuits = await this.prisma.circuit.findMany({ where: { zoneId } });

    const shouldBeActive = (c: { isCritical: boolean }) =>
      status === 'CUTOFF' ? false : status === 'LIMITED' ? c.isCritical : true;

    const changed = circuits.filter((c) => c.isActive !== shouldBeActive(c));

    await Promise.all(
      changed.map((c) => this.circuitsService.setActive(c.id, shouldBeActive(c))),
    );

    await this.auditService.log({
      actorType: 'USER',
      action: 'ZONE_POWER_STATUS_CHANGED',
      targetType: 'ZONE',
      targetId: zoneId,
      metadata: { status, affectedCircuitIds: changed.map((c) => c.id) },
    });

    return { zoneId, status, affectedCircuitIds: changed.map((c) => c.id) };
  }
}
