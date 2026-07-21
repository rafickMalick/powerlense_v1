import { forwardRef, Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { MqttModule } from '../../mqtt/mqtt.module';
import { RealtimeModule } from '../../realtime/realtime.module';

/**
 * `MqttModule` a besoin d'`AlertsService` (via `MeasurementListener`) et
 * `AlertsService` a besoin de `MqttService` (via `MqttModule`) — cycle
 * résolu par `forwardRef()` des deux côtés (idiome standard NestJS).
 */
@Module({
  imports: [forwardRef(() => MqttModule), RealtimeModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
