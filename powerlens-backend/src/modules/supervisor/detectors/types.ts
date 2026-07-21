import { RecommendationConfidence, RecommendationType } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RuleAction, RuleCondition } from '../../rules/rules-engine.service';

export interface DetectionCandidate {
  type: RecommendationType;
  title: string;
  justification: string;
  detectorKey: string;
  proposedConditions?: RuleCondition | null;
  proposedActions?: RuleAction[] | null;
  estimatedImpact: string;
  estimatedSavingsKwh?: number | null;
  estimatedSavingsEur?: number | null;
  confidence: RecommendationConfidence;
  targetRuleId?: string | null;
  buildingId: string;
  detectionWindowFrom: Date;
  detectionWindowTo: Date;
}

export interface Detector {
  detect(buildingId: string, prisma: PrismaService): Promise<DetectionCandidate[]>;
}
