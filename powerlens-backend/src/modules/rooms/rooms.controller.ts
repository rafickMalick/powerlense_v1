import { Controller, Get, Param, Query } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { FindRoomsQueryDto } from './dto/find-rooms-query.dto';
import { MeasurementsService } from '../measurements/measurements.service';
import { MeasurementsQueryDto } from '../measurements/dto/measurements-query.dto';

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly service: RoomsService,
    private readonly measurementsService: MeasurementsService,
  ) {}

  @Get()
  getRooms(@Query() query: FindRoomsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id/circuits')
  getRoomCircuits(@Param('id') id: string) {
    return this.service.getCircuits(id);
  }

  @Get(':id/measurements')
  getRoomMeasurements(
    @Param('id') id: string,
    @Query() query: MeasurementsQueryDto,
  ) {
    return this.measurementsService.findByRoom(id, query);
  }
}
