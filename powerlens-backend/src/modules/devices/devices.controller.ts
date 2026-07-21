import { Controller, Get, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('devices')
export class DevicesController {
  constructor(private readonly service: DevicesService) {}

  /** Liste des boîtiers enregistrés + leurs charges (vue « Boîtiers »). */
  @UseGuards(JwtAuthGuard)
  @Get()
  list() {
    return this.service.list();
  }
}
