import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BillingService } from './billing.service';
import { BillingQueryDto } from './dto/billing-query.dto';
import { GenerateBillingDto } from './dto/generate-billing.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('tariff')
  getTariff(@Query() query: BillingQueryDto) {
    return this.billingService.getActiveTariff(query.buildingId);
  }

  @Get('current')
  getCurrent(@Query() query: BillingQueryDto) {
    return this.billingService.getCurrentMonthEstimate(query.buildingId);
  }

  @Get('history')
  getHistory(@Query() query: BillingQueryDto) {
    return this.billingService.getHistory(query.buildingId);
  }

  @Post('generate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  generate(@Body() dto: GenerateBillingDto) {
    return this.billingService.generateForPeriod(dto.buildingId, dto.period);
  }
}
