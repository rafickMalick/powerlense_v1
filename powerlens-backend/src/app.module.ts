import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { RulesModule } from './modules/rules/rules.module';
import { MqttModule } from './mqtt/mqtt.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { CircuitsModule } from './modules/circuits/circuits.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { MeasurementsModule } from './modules/measurements/measurements.module';
import { AuthModule } from './modules/auth/auth.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SimulatorModule } from './simulator/simulator.module';
import { AuditModule } from './modules/audit/audit.module';
import { SupervisorModule } from './modules/supervisor/supervisor.module';
import { ZonesModule } from './modules/zones/zones.module';
import { DevicesModule } from './modules/devices/devices.module';
import { BillingModule } from './modules/billing/billing.module';
import { AlertsModule } from './modules/alerts/alerts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    RealtimeModule,
    MqttModule,
    RulesModule,
    RoomsModule,
    CircuitsModule,
    BuildingsModule,
    MeasurementsModule,
    SimulatorModule,
    AuditModule,
    SupervisorModule,
    ZonesModule,
    DevicesModule,
    BillingModule,
    AlertsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
