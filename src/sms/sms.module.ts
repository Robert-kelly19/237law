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
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get<string>('MTN_API_BASE_URL'),
      }),
    }),
    AgentsModule,
    MemoryModule,
    CommonModule,
  ],
  controllers: [SmsController],
  providers: [SmsService],
})
export class SmsModule {}
