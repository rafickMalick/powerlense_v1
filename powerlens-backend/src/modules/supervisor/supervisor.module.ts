import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { SupervisorController } from './supervisor.controller';
import { SupervisorAnalysisService } from './supervisor-analysis.service';
import { SupervisorRecommendationsService } from './supervisor-recommendations.service';
import { SupervisorDashboardService } from './supervisor-dashboard.service';
import { SupervisorRankingService } from './supervisor-ranking.service';
import { ExcessiveConsumptionDetector } from './detectors/excessive-consumption.detector';
import { UnderusedEquipmentDetector } from './detectors/underused-equipment.detector';
import { InefficientRuleDetector } from './detectors/inefficient-rule.detector';
import { RepetitiveAlertDetector } from './detectors/repetitive-alert.detector';

@Module({
  imports: [RulesModule],
  controllers: [SupervisorController],
  providers: [
    SupervisorAnalysisService,
    SupervisorRecommendationsService,
    SupervisorDashboardService,
    SupervisorRankingService,
    ExcessiveConsumptionDetector,
    UnderusedEquipmentDetector,
    InefficientRuleDetector,
    RepetitiveAlertDetector,
  ],
})
export class SupervisorModule {}
