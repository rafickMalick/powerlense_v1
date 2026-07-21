import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Query() query: AuditLogsQueryDto) {
    return this.auditService.findAll(query);
  }
}
