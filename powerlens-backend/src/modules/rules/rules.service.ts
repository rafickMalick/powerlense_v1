// rules.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { RuleEngineService } from './rules-engine.service';
import { validateRuleCondition, validateRuleActions } from './rule-validation';

@Injectable()
export class RulesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private ruleEngine: RuleEngineService,
  ) {}

  async createRule(data: CreateRuleDto) {
    const conditions = validateRuleCondition(data.conditions);
    const actions = validateRuleActions(data.actions);

    const rule = await this.prisma.rule.create({
      data: {
        name: data.name,
        ruleType: data.ruleType,
        conditions: conditions as unknown as Prisma.InputJsonValue,
        actions: actions as unknown as Prisma.InputJsonValue,
        buildingId: data.buildingId,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      action: 'RULE_CREATED',
      targetType: 'RULE',
      targetId: rule.id,
      metadata: { name: rule.name, ruleType: rule.ruleType, buildingId: rule.buildingId },
    });

    return rule;
  }

  getAllRules() {
    return this.prisma.rule.findMany({
      where: { isActive: true },
    });
  }

  getRuleById(id: string) {
    return this.prisma.rule.findUnique({ where: { id } });
  }

  async updateRule(id: string, data: UpdateRuleDto) {
    if (data.conditions !== undefined) validateRuleCondition(data.conditions);
    if (data.actions !== undefined) validateRuleActions(data.actions);

    const rule = await this.prisma.rule.update({
      where: { id },
      data: data as Prisma.RuleUpdateInput,
    });

    // Purge l'état de déclenchement en mémoire (rising-edge + cooldown) — sans
    // ça, une règle éditée pouvait rester bloquée sur un état périmé calculé
    // avant la modification (cf. clearState, jamais appelée avant ce correctif).
    this.ruleEngine.clearState(id);

    await this.auditService.log({
      actorType: 'USER',
      action: 'RULE_UPDATED',
      targetType: 'RULE',
      targetId: rule.id,
      metadata: { name: rule.name },
    });

    return rule;
  }

  async disableRule(id: string) {
    const rule = await this.prisma.rule.update({
      where: { id },
      data: { isActive: false },
    });

    this.ruleEngine.clearState(id);

    await this.auditService.log({
      actorType: 'USER',
      action: 'RULE_DISABLED',
      targetType: 'RULE',
      targetId: rule.id,
    });

    return rule;
  }
}
