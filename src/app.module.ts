import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RagModule } from './rag.module';
import { RagController } from './rag.controller';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RagModule,
    WhatsAppModule,
  ],
  controllers: [AppController, RagController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
