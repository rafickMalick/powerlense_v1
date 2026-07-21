import { Injectable, NotFoundException } from '@nestjs/common';
import { BuildingPowerStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CircuitsService } from '../circuits/circuits.service';
import { AuditService } from '../audit/audit.service';
import { UpdateBuildingDto } from './dto/update-building.dto';

@Injectable()
export class BuildingsService {
  constructor(
    private prisma: PrismaService,
    private circuitsService: CircuitsService,
    private auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.building.findMany();
  }

  async findById(id: string) {
    const building = await this.prisma.building.findUnique({ where: { id } });
    if (!building) throw new NotFoundException('Building not found');
    return building;
  }

  async getRooms(buildingId: string) {
    await this.findById(buildingId);
    return this.prisma.monitoringZone.findMany({ where: { buildingId } });
  }

  async update(id: string, dto: UpdateBuildingDto) {
    await this.findById(id);
    return this.prisma.building.update({ where: { id }, data: dto });
  }

  /**
   * Bascule groupée de l'état d'alimentation du bâtiment (Control Center) :
   * - CUTOFF  : tous les circuits OFF
   * - LIMITED : seuls les circuits critiques (isCritical) restent ON
   * - POWERED : tous les circuits ON
   * Réutilise CircuitsService.setActive pour chaque circuit modifié (publie
   * la commande MQTT, journalise et diffuse circuit:status — déjà géré
   * là-bas), puis ajoute UNE entrée d'audit groupée pour l'action globale.
   * C'est le seul point d'écriture de Building.powerStatus : l'API NestJS
   * reste le seul cerveau, le mobile ne fait qu'appeler cet endpoint.
   */
  async setPowerStatus(id: string, status: BuildingPowerStatus) {
    await this.findById(id);

    const circuits = await this.prisma.circuit.findMany({
      where: { zone: { buildingId: id } },
    });

    const shouldBeActive = (c: { isCritical: boolean }) =>
      status === 'CUTOFF' ? false : status === 'LIMITED' ? c.isCritical : true;

    const changed = circuits.filter((c) => c.isActive !== shouldBeActive(c));

    await Promise.all(
      changed.map((c) => this.circuitsService.setActive(c.id, shouldBeActive(c))),
    );

    const building = await this.prisma.building.update({
      where: { id },
      data: { powerStatus: status },
    });

    await this.auditService.log({
      actorType: 'USER',
      action: 'BUILDING_POWER_STATUS_CHANGED',
      targetType: 'BUILDING',
      targetId: id,
      metadata: { status, affectedCircuitIds: changed.map((c) => c.id) },
    });

    return building;
  }
}
