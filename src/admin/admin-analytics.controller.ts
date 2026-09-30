import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  AdminAnalyticsService,
  AnalyticsOverview,
  DailyUsersResponse,
  MonthlyUsersResponse,
  WeeklyUsersResponse,
} from './admin-analytics.service';
import { AdminAuthGuard } from './admin-auth.guard';

@Controller('admin/analytics')
@UseGuards(AdminAuthGuard)
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

  @Get('weekly')
  getWeeklyUsers(
    @Query('weeks') weeksStr?: string,
  ): Promise<WeeklyUsersResponse> {
    const weeks = weeksStr ? parseInt(weeksStr, 10) : 12;
    return this.analyticsService.getWeeklyUsers(weeks);
  }

  @Get('monthly')
  getMonthlyUsers(
    @Query('months') monthsStr?: string,
  ): Promise<MonthlyUsersResponse> {
    const months = monthsStr ? parseInt(monthsStr, 10) : 12;
    return this.analyticsService.getMonthlyUsers(months);
  }
}
