import { Controller, Get, Module, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../common/auth.guards';

@Roles('admin')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  dashboard(
    @Query('days') days?: string,
    @Query('learnerId') learnerId?: string,
    @Query('language') language?: string,
    @Query('provider') provider?: string,
  ) {
    return this.analytics.dashboard({
      days: days ? Number(days) : 30,
      learnerId: learnerId || undefined,
      language: language || undefined,
      provider: provider || undefined,
    });
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
