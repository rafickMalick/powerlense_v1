import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { LogEventDto } from './dto/log-event.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Point d'entrée pour les événements observables uniquement côté client
 * (consultation d'écran, déconnexion…) — le frontend doit rester un client
 * pur : toute action visible doit être tracée côté backend (cf. claude.md §
 * "VÉRIFICATION DU FRONTEND").
 */
@Controller('audit')
export class AuditEventsController {
  constructor(private readonly auditService: AuditService) {}

  @UseGuards(JwtAuthGuard)
  @Post('events')
  async logEvent(
    @Body() dto: LogEventDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    await this.auditService.log({
      actorType: 'USER',
      actorId: req.user.id,
      action: dto.action,
      targetType: 'CLIENT_EVENT',
      metadata: dto.metadata,
    });
    return { ok: true };
  }
}
