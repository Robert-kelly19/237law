import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentsModule } from '../agents/agents.module';
import { CommonModule } from '../common/common.module';
import { MemoryModule } from '../memory/memory.module';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const baseURL = configService.getOrThrow<string>('MTN_API_BASE_URL');

        try {
          const url = new URL(baseURL);
          if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('unsupported protocol');
          }
        } catch {
          throw new Error(
            'MTN_API_BASE_URL must be a valid HTTP(S) URL (for example, https://api.mtn.com)',
          );
        }

        return { baseURL };
      },
    }),
    AgentsModule,
    MemoryModule,
    CommonModule,
  ],
  controllers: [SmsController],
  providers: [SmsService],
})
export class SmsModule {}
