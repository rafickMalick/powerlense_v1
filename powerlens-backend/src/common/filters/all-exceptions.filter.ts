import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * Filtre global : capture toute exception non gérée par un contrôleur et
 * garantit qu'aucune erreur API ne reste silencieuse ("journalisation
 * unifiée", cf. claude.md). Ne journalise dans AuditLog que les erreurs
 * serveur (5xx) — les 4xx attendus (401 identifiants invalides, 404
 * ressource absente, 400 validation) sont des réponses API normales, pas
 * des anomalies à tracer.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly auditService: AuditService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Internal server error' };

    this.logger.error(
      `${request.method} ${request.originalUrl} → ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    if (status >= 500) {
      void this.auditService.log({
        actorType: 'SYSTEM',
        action: 'API_ERROR',
        targetType: 'API',
        metadata: {
          method: request.method,
          path: request.originalUrl,
          statusCode: status,
          message: exception instanceof Error ? exception.message : String(exception),
        },
      });
    }

    response.status(status).json(body);
  }
}
