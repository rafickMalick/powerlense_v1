import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AlertsService } from './alerts.service';
import { AlertsQueryDto } from './dto/alerts-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  findAll(@Query() query: AlertsQueryDto) {
    return this.alertsService.findAll(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @Patch(':id/acknowledge')
  acknowledge(@Param('id') id: string, @Req() req: any) {
    return this.alertsService.acknowledge(id, req.user);
  }
}
