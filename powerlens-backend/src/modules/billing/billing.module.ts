import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingCronService } from './billing-cron.service';

@Module({
  imports: [MeasurementsModule],
  controllers: [BillingController],
  providers: [BillingService, BillingCronService],
  exports: [BillingService],
})
export class BillingModule {}
