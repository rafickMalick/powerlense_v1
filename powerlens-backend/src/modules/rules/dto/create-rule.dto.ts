import { RuleType } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateRuleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(RuleType)
  ruleType: RuleType;

  @IsObject()
  conditions: Record<string, unknown>;

  @IsArray()
  actions: Record<string, unknown>[];

  @IsUUID()
  buildingId: string;
}
