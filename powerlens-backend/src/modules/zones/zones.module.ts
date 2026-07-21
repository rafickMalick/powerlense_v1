import { Module } from '@nestjs/common';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { MeasurementsModule } from '../measurements/measurements.module';
import { CircuitsModule } from '../circuits/circuits.module';

@Module({
  imports: [MeasurementsModule, CircuitsModule],
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
