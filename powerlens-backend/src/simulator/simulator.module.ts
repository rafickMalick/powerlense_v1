import { Module } from '@nestjs/common';
import { SimulatorService } from './simulator.service';
import { ProviderSwitcherService } from './provider-switcher.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [MqttModule, RealtimeModule],
  providers: [SimulatorService, ProviderSwitcherService],
  exports: [SimulatorService, ProviderSwitcherService],
})
export class SimulatorModule {}
