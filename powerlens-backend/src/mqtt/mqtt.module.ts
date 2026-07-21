// src/mqtt/mqtt.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { MeasurementListener } from './services/measurement.listener';
import { CommandTrackerService } from './services/command-tracker.service';
import { RulesModule } from '../modules/rules/rules.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AlertsModule } from '../modules/alerts/alerts.module';

@Module({
  imports: [RulesModule, RealtimeModule, forwardRef(() => AlertsModule)],
  providers: [MqttService, MeasurementListener, CommandTrackerService],
  exports: [MqttService, CommandTrackerService],
})
export class MqttModule {}
