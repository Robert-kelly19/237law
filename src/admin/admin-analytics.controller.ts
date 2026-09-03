import { Controller, Get, Query } from '@nestjs/common';
import {
  AdminAnalyticsService,
  AnalyticsOverview,
  DailyUsersResponse,
} from './admin-analytics.service';

@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) {}

  @Get('overview')
  getOverview(): Promise<AnalyticsOverview> {
    return this.analyticsService.getOverview();
  }

  @Get('daily')
  getDailyUsers(
    @Query('days') daysStr?: string,
  ): Promise<DailyUsersResponse> {
    const days = daysStr ? parseInt(daysStr, 10) : 30;
    return this.analyticsService.getDailyUsers(days);
  }
}
