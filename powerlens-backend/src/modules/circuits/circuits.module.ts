import { Module } from '@nestjs/common';
import { CircuitsController } from './circuits.controller';
import { CircuitsService } from './circuits.service';
import { MqttModule } from '../../mqtt/mqtt.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { MeasurementsModule } from '../measurements/measurements.module';

@Module({
  imports: [MqttModule, RealtimeModule, MeasurementsModule],
  controllers: [CircuitsController],
  providers: [CircuitsService],
  exports: [CircuitsService],
})
export class CircuitsModule {}
