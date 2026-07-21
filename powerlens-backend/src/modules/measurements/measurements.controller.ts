import { Controller, Get, Query } from '@nestjs/common';
import { MeasurementsService } from './measurements.service';
import { MeasurementsQueryDto } from './dto/measurements-query.dto';
import { EnergyTodayQueryDto } from './dto/energy-today-query.dto';

@Controller('measurements')
export class MeasurementsController {
  constructor(private readonly measurementsService: MeasurementsService) {}

  @Get()
  findAll(@Query() query: MeasurementsQueryDto) {
    return this.measurementsService.findAll(query);
  }

  @Get('energy-today')
  getEnergyToday(@Query() query: EnergyTodayQueryDto) {
    return this.measurementsService.getEnergyToday(query.buildingId);
  }
}
