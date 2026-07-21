import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditEventsController } from './audit-events.controller';
import { AuditService } from './audit.service';

/**
 * @Global() : AuditService.log() est un point de journalisation transversal
 * appelé depuis de nombreux modules (MQTT, circuits, règles, auth…) — le
 * rendre global évite de réimporter AuditModule partout.
 */
@Global()
@Module({
  controllers: [AuditController, AuditEventsController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
