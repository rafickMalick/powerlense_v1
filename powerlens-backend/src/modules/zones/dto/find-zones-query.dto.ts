import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID } from 'class-validator';
import { ZoneType } from '@prisma/client';

export class FindZonesQueryDto {
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @IsOptional()
  @IsEnum(ZoneType)
  type?: ZoneType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;
}
