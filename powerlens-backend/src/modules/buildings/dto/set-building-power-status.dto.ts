import { IsIn } from 'class-validator';
import { BuildingPowerStatus } from '@prisma/client';

export class SetBuildingPowerStatusDto {
  @IsIn(['POWERED', 'LIMITED', 'CUTOFF'])
  status!: BuildingPowerStatus;
}
