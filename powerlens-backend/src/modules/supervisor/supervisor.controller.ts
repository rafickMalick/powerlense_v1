import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SupervisorRecommendationsService } from './supervisor-recommendations.service';
import { SupervisorDashboardService } from './supervisor-dashboard.service';
import { SupervisorRankingService } from './supervisor-ranking.service';
import { RecommendationsQueryDto } from './dto/recommendations-query.dto';
import { ReviewRecommendationDto } from './dto/review-recommendation.dto';
import { RunsQueryDto } from './dto/runs-query.dto';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { RankingQueryDto } from './dto/ranking-query.dto';

@Controller('supervisor')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupervisorController {
  constructor(
    private readonly recommendationsService: SupervisorRecommendationsService,
    private readonly dashboardService: SupervisorDashboardService,
    private readonly rankingService: SupervisorRankingService,
  ) {}

  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  getDashboard(@Query() query: DashboardQueryDto) {
    return this.dashboardService.getDashboard(query);
  }

  @Get('ranking')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.VIEWER)
  getRanking(@Query() query: RankingQueryDto) {
    return this.rankingService.getRanking(query);
  }

  @Get('recommendations')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  findAll(@Query() query: RecommendationsQueryDto) {
    return this.recommendationsService.findAll(query);
  }

  @Get('recommendations/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  findOne(@Param('id') id: string) {
    return this.recommendationsService.findOne(id);
  }

  @Patch('recommendations/:id/approve')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  approve(@Param('id') id: string, @Body() dto: ReviewRecommendationDto, @Req() req: any) {
    return this.recommendationsService.approve(id, dto, req.user);
  }

  @Patch('recommendations/:id/reject')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  reject(@Param('id') id: string, @Body() dto: ReviewRecommendationDto, @Req() req: any) {
    return this.recommendationsService.reject(id, dto, req.user);
  }

  @Get('runs')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  findRuns(@Query() query: RunsQueryDto) {
    return this.recommendationsService.findRuns(query);
  }

  @Post('runs/trigger')
  @Roles(UserRole.SUPER_ADMIN)
  async triggerRun() {
    const runId = await this.recommendationsService.triggerRun();
    return { runId };
  }
}
