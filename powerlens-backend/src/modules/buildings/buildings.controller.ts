import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { SetBuildingPowerStatusDto } from './dto/set-building-power-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('buildings')
export class BuildingsController {
  constructor(private readonly service: BuildingsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get(':id/rooms')
  getRooms(@Param('id') id: string) {
    return this.service.getRooms(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBuildingDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/power-status')
  setPowerStatus(@Param('id') id: string, @Body() dto: SetBuildingPowerStatusDto) {
    return this.service.setPowerStatus(id, dto.status);
  }
}
