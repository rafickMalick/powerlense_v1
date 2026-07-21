import { IsObject, IsOptional, IsString } from 'class-validator';

export class LogEventDto {
  @IsString()
  action!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
