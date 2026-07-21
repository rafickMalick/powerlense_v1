import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class DashboardQueryDto {
  @IsUUID()
  buildingId!: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
