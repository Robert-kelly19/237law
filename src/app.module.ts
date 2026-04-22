import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    PrismaModule,
    RagModule,
    WhatsAppModule,
  ],
  controllers: [AppController, RagController],
  providers: [AppService],
})
export class AppModule {}
