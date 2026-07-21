import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MqttService } from '../../mqtt/mqtt.service';
import { CommandTrackerService } from '../../mqtt/services/command-tracker.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';
import { commandTopic, measureTopic } from '../../mqtt/config/mqtt.config';
import { UpdateCircuitDto } from './dto/update-circuit.dto';

const CIRCUIT_INCLUDE = {
  zone: { include: { building: true } },
  device: true,
} as const;

@Injectable()
export class CircuitsService {
  constructor(
    private prisma: PrismaService,
    private mqttService: MqttService,
    private commandTracker: CommandTrackerService,
    private realtime: RealtimeGateway,
    private auditService: AuditService,
  ) {}

  async findById(id: string) {
    const circuit = await this.prisma.circuit.findUnique({
      where: { id },
      include: { zone: true, device: true },
    });

    if (!circuit) throw new NotFoundException('Circuit not found');

    return circuit;
  }

  async update(id: string, dto: UpdateCircuitDto) {
    await this.findById(id);

    const circuit = await this.prisma.circuit.update({
      where: { id },
      data: dto,
    });

    if (dto.isActive !== undefined) {
      await this.publishActivation(id, dto.isActive);
    }

    return circuit;
  }

  activate(id: string) {
    return this.setActive(id, true);
  }

  deactivate(id: string) {
    return this.setActive(id, false);
  }

  /**
   * Active/désactive un circuit : met à jour PostgreSQL, publie une commande
   * MQTT vers le device concerné, journalise l'action et diffuse le nouvel
   * état via WebSocket. Public — réutilisé par BuildingsService pour les
   * bascules groupées (PATCH /buildings/:id/power-status).
   */
  async setActive(id: string, isActive: boolean) {
    const existing = await this.prisma.circuit.findUnique({
      where: { id },
      include: CIRCUIT_INCLUDE,
    });

    if (!existing) throw new NotFoundException('Circuit not found');

    const circuit = await this.prisma.circuit.update({
      where: { id },
      data: { isActive },
    });

    await this.publishActivation(id, isActive, existing);

    return circuit;
  }

  private async publishActivation(
    id: string,
    isActive: boolean,
    preloaded?: Awaited<ReturnType<CircuitsService['findCircuitWithBuilding']>>,
  ) {
    const circuit = preloaded ?? (await this.findCircuitWithBuilding(id));
    const buildingId = circuit.zone.building.id;
    const correlationId = `${id}-${Date.now()}`;

    this.mqttService.publish(
      commandTopic(buildingId, circuit.device.deviceUid, id),
      {
        command: isActive ? 'ON' : 'OFF',
        correlationId,
        timestamp: new Date().toISOString(),
      },
    );
    this.commandTracker.track(correlationId, id, isActive);

    await this.auditService.log({
      actorType: 'USER',
      action: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      targetType: 'CIRCUIT',
      targetId: id,
      metadata: { correlationId },
    });

    this.realtime.emitCircuitStatus({ circuitId: id, isActive });
  }

  private findCircuitWithBuilding(id: string) {
    return this.prisma.circuit.findUniqueOrThrow({
      where: { id },
      include: CIRCUIT_INCLUDE,
    });
  }

  /**
   * Canaux mesurés — depuis V4, ce sont ceux de la ZONE du circuit (les
   * circuits ne sont plus mesurés individuellement). Le contrat d'URL
   * `/circuits/:id/channels` est conservé pour compatibilité frontend ; le
   * nouvel endpoint canonique est `GET /zones/:id/channels`.
   */
  async getChannels(id: string) {
    const circuit = await this.findCircuitWithBuilding(id);
    const topic = measureTopic(
      circuit.zone.building.id,
      circuit.device.deviceUid,
    );

    const channels = await this.prisma.channel.findMany({
      where: { zoneId: circuit.zoneId },
    });

    return channels.map((ch) => ({ ...ch, topic }));
  }
}
