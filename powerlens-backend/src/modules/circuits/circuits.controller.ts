import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CircuitsService } from './circuits.service';
import { UpdateCircuitDto } from './dto/update-circuit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MeasurementsService } from '../measurements/measurements.service';
import { MeasurementsQueryDto } from '../measurements/dto/measurements-query.dto';

@Controller('circuits')
export class CircuitsController {
  constructor(
    private readonly service: CircuitsService,
    private readonly measurementsService: MeasurementsService,
  ) {}

  @Get(':id')
  getCircuit(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get(':id/channels')
  getChannels(@Param('id') id: string) {
    return this.service.getChannels(id);
  }

  @Get(':id/measurements')
  getMeasurements(
    @Param('id') id: string,
    @Query() query: MeasurementsQueryDto,
  ) {
    return this.measurementsService.findByCircuit(id, query);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCircuitDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.service.activate(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
