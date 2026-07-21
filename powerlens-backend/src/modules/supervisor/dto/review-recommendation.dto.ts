import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class ReviewRecommendationDto {
  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsObject()
  overrideConditions?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  overrideActions?: Record<string, unknown>[];
}
