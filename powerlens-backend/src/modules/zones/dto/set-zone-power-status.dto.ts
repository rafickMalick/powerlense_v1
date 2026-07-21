import { IsIn } from 'class-validator';
import { BuildingPowerStatus } from '@prisma/client';

/** Réutilise l'enum BuildingPowerStatus — mêmes sémantiques (POWERED/LIMITED/CUTOFF) à l'échelle d'une zone. */
export class SetZonePowerStatusDto {
  @IsIn(['POWERED', 'LIMITED', 'CUTOFF'])
  status!: BuildingPowerStatus;
}
