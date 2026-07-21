// src/modules/rules/rules.module.ts
import { Module } from '@nestjs/common';
import { RuleEngineService } from './rules-engine.service';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

@Module({
  controllers: [RulesController],
  providers: [RuleEngineService, RulesService],
  exports: [RuleEngineService, RulesService],
})
export class RulesModule {}
