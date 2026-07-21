import { IsUUID } from 'class-validator';

export class EnergyTodayQueryDto {
  @IsUUID()
  buildingId: string;
}
