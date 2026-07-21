import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class RankingQueryDto {
  @IsUUID()
  buildingId!: string;

  @IsOptional()
  @IsIn(['week', 'month', 'quarter'])
  period?: 'week' | 'month' | 'quarter';
}
