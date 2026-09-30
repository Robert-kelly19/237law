import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma.module';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminBroadcastController } from './admin-broadcast.controller';
import { AdminBroadcastService } from './admin-broadcast.service';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [AdminAnalyticsController, AdminBroadcastController],
  providers: [
    AdminAnalyticsService,
    AdminBroadcastService,
    AdminAuthGuard,
    WhatsappService,
  ],
})
export class AdminModule {}
