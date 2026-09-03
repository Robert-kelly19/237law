import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminAnalyticsController],
  providers: [AdminAnalyticsService],
})
export class AdminModule {}
