import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RagModule } from './rag.module';
import { RagController } from './rag.controller';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { PrismaModule } from './prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RagModule,
    WhatsAppModule,
  ],
  controllers: [AppController, RagController],
  providers: [AppService],
})
export class AppModule {}
