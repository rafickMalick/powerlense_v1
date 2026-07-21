import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { FindZonesQueryDto } from './dto/find-zones-query.dto';
import { SetZonePowerStatusDto } from './dto/set-zone-power-status.dto';
import { MeasurementsService } from '../measurements/measurements.service';
import { MeasurementsQueryDto } from '../measurements/dto/measurements-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('zones')
export class ZonesController {
  constructor(
    private readonly service: ZonesService,
    private readonly measurementsService: MeasurementsService,
  ) {}

  @Get()
  getZones(@Query() query: FindZonesQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  getZone(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get(':id/circuits')
  getZoneCircuits(@Param('id') id: string) {
    return this.service.getCircuits(id);
  }

  @Get(':id/channels')
  getZoneChannels(@Param('id') id: string) {
    return this.service.getChannels(id);
  }

  @Get(':id/measurements')
  getZoneMeasurements(
    @Param('id') id: string,
    @Query() query: MeasurementsQueryDto,
  ) {
    return this.measurementsService.findByZone(id, query);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/power-status')
  setPowerStatus(@Param('id') id: string, @Body() dto: SetZonePowerStatusDto) {
    return this.service.setPowerStatus(id, dto.status);
  }
}
