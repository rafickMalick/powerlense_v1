import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export type MeasurementGranularity = 'hour' | 'day' | 'week' | 'month';

export const GRANULARITIES: MeasurementGranularity[] = [
  'hour',
  'day',
  'week',
  'month',
];

export class MeasurementsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** @deprecated Les mesures ne sont plus rattachées aux circuits depuis V4 — conservé pour l'historique pré-migration. */
  @IsOptional()
  @IsUUID()
  circuitId?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity?: MeasurementGranularity;
}
