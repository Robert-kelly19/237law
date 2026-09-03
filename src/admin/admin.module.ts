import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';

@Module({
  controllers: [AdminAnalyticsController],
  providers: [PrismaService, AdminAnalyticsService],
})
export class AdminModule {}