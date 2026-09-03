import { Controller, Get } from '@nestjs/common';
import {
  AdminAnalyticsService,
  AnalyticsOverview,
} from './admin-analytics.service';

@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) {}

  @Get('overview')
  getOverview(): Promise<AnalyticsOverview> {
    return this.analyticsService.getOverview();
  }
}