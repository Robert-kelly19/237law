import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentsModule } from '../agents/agents.module';
import { MemoryModule } from '../memory/memory.module';
import { UsersModule } from '../users/users.module';
import { VoiceProcessor } from './voice.processor';
import { VoiceRateLimiter } from './voice-rate-limiter.service';
import { SpeechService } from './speech.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: Number(configService.get<string>('REDIS_PORT', '6379')),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'voice',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    }),
    AgentsModule,
    MemoryModule,
    UsersModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, SpeechService, VoiceRateLimiter, VoiceProcessor],
})
export class WhatsappModule {}
