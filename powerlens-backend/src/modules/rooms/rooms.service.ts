import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FindRoomsQueryDto } from './dto/find-rooms-query.dto';

/** @deprecated Use ZonesService — this wrapper filters MonitoringZone to type=ROOM for backward compatibility. */
@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  findAll(query: FindRoomsQueryDto = {}) {
    return this.prisma.monitoringZone.findMany({
      where: {
        type: 'ROOM',
        ...(query.buildingId ? { buildingId: query.buildingId } : {}),
        ...(query.floor !== undefined ? { floor: query.floor } : {}),
      },
      include: { building: true },
    });
  }

  async getCircuits(zoneId: string) {
    const zone = await this.prisma.monitoringZone.findUnique({
      where: { id: zoneId },
      include: { circuits: true },
    });

    if (!zone) throw new NotFoundException('Zone not found');

    return zone.circuits;
  }
}
