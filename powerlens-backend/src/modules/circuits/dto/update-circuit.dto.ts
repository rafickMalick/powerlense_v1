import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateCircuitDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  maxPowerWatt?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
