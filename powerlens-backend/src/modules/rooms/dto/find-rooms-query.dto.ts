import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID } from 'class-validator';

export class FindRoomsQueryDto {
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;
}
