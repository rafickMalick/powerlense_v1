import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecommendationStatus, RuleType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RulesService } from '../rules/rules.service';
import { RuleEngineService, RuleCondition } from '../rules/rules-engine.service';
import { SupervisorAnalysisService } from './supervisor-analysis.service';
import { RecommendationsQueryDto } from './dto/recommendations-query.dto';
import { ReviewRecommendationDto } from './dto/review-recommendation.dto';
import { RunsQueryDto } from './dto/runs-query.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_RUNS_LIMIT = 20;

interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

const CONDITION_TYPE_TO_RULE_TYPE: Record<string, RuleType> = {
  THRESHOLD: RuleType.THRESHOLD,
  SCHEDULE: RuleType.SCHEDULE,
  EVENT: RuleType.EVENT,
  PRESENCE: RuleType.PRESENCE,
  AND: RuleType.COMBINED,
  OR: RuleType.COMBINED,
};

@Injectable()
export class SupervisorRecommendationsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private rulesService: RulesService,
    private ruleEngineService: RuleEngineService,
    private supervisorAnalysisService: SupervisorAnalysisService,
  ) {}

  async findAll(query: RecommendationsQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.RuleRecommendationWhereInput = {
      status: query.status,
      buildingId: query.buildingId,
      type: query.type,
      confidence: query.confidence,
    };

    const [items, total] = await Promise.all([
      this.prisma.ruleRecommendation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ruleRecommendation.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  findOne(id: string) {
    return this.prisma.ruleRecommendation.findUniqueOrThrow({
      where: { id },
      include: { targetRule: true, building: true },
    });
  }

  async approve(id: string, dto: ReviewRecommendationDto, user: AuthenticatedUser) {
    const recommendation = await this.prisma.ruleRecommendation.findUnique({ where: { id } });
    if (!recommendation) throw new NotFoundException('Recommandation introuvable');
    if (recommendation.status !== RecommendationStatus.PENDING) {
      throw new BadRequestException('Cette recommandation a déjà été traitée');
    }

    const conditions =
      (dto.overrideConditions as RuleCondition | undefined) ??
      (recommendation.proposedConditions as unknown as RuleCondition | null);
    const actions = dto.overrideActions ?? (recommendation.proposedActions as unknown as Record<string, unknown>[] | null);

    let appliedRuleId: string | null = null;

    switch (recommendation.type) {
      case 'CREATE_RULE': {
        if (!conditions || !actions) {
          throw new BadRequestException('Conditions et actions requises pour créer la règle');
        }
        const ruleType = CONDITION_TYPE_TO_RULE_TYPE[conditions.type] ?? RuleType.COMBINED;
        const rule = await this.rulesService.createRule({
          name: recommendation.title,
          ruleType,
          conditions: conditions as unknown as Record<string, unknown>,
          actions,
          buildingId: recommendation.buildingId,
        });
        appliedRuleId = rule.id;
        break;
      }

      case 'MODIFY_RULE': {
        if (!recommendation.targetRuleId) {
          throw new BadRequestException('Aucune règle cible définie pour cette recommandation');
        }
        if (!conditions || !actions) {
          throw new BadRequestException('Conditions et actions requises pour modifier la règle');
        }
        await this.rulesService.updateRule(recommendation.targetRuleId, {
          conditions: conditions as unknown as Record<string, unknown>,
          actions,
        });
        this.ruleEngineService.clearState(recommendation.targetRuleId);
        appliedRuleId = recommendation.targetRuleId;
        break;
      }

      case 'DELETE_RULE': {
        if (!recommendation.targetRuleId) {
          throw new BadRequestException('Aucune règle cible définie pour cette recommandation');
        }
        await this.rulesService.disableRule(recommendation.targetRuleId);
        this.ruleEngineService.clearState(recommendation.targetRuleId);
        appliedRuleId = recommendation.targetRuleId;
        break;
      }
    }

    const updated = await this.prisma.ruleRecommendation.update({
      where: { id },
      data: {
        status: RecommendationStatus.APPLIED,
        approverId: user.id,
        reviewedAt: new Date(),
        reviewComment: dto.comment,
        appliedRuleId,
        appliedAt: new Date(),
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: user.id,
      action: 'RECOMMENDATION_APPROVED',
      targetType: 'RULE_RECOMMENDATION',
      targetId: id,
      metadata: {
        appliedRuleId,
        type: recommendation.type,
        overridden: !!(dto.overrideConditions || dto.overrideActions),
      },
    });

    return updated;
  }

  async reject(id: string, dto: ReviewRecommendationDto, user: AuthenticatedUser) {
    const recommendation = await this.prisma.ruleRecommendation.findUnique({ where: { id } });
    if (!recommendation) throw new NotFoundException('Recommandation introuvable');
    if (recommendation.status !== RecommendationStatus.PENDING) {
      throw new BadRequestException('Cette recommandation a déjà été traitée');
    }

    const updated = await this.prisma.ruleRecommendation.update({
      where: { id },
      data: {
        status: RecommendationStatus.REJECTED,
        approverId: user.id,
        reviewedAt: new Date(),
        reviewComment: dto.comment,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: user.id,
      action: 'RECOMMENDATION_REJECTED',
      targetType: 'RULE_RECOMMENDATION',
      targetId: id,
      metadata: { type: recommendation.type },
    });

    return updated;
  }

  findRuns(query: RunsQueryDto) {
    return this.prisma.supervisorRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: query.limit ?? DEFAULT_RUNS_LIMIT,
    });
  }

  triggerRun() {
    return this.supervisorAnalysisService.runAnalysis();
  }
}
