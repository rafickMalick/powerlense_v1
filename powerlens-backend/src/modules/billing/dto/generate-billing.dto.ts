import { IsOptional, IsUUID } from 'class-validator';

export class GenerateBillingDto {
  @IsUUID()
  buildingId: string;

  /** Mois à facturer, format YYYY-MM. Par défaut : le mois précédent. */
  @IsOptional()
  period?: string;
}
