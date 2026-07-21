import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from './billing.service';

const logger = new Logger('BillingCronService');

@Injectable()
export class BillingCronService {
  constructor(private billingService: BillingService) {}

  @Cron(process.env.BILLING_CRON ?? CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleCron() {
    if (process.env.BILLING_ENABLED !== 'true') return;

    try {
      const records = await this.billingService.generatePreviousMonthForAllBuildings();
      logger.log(`Factures générées pour ${records.length} bâtiment(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Génération des factures mensuelles échouée', message);
    }
  }
}
