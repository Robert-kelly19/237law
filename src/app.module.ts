import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PdfService } from './pdf.service';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { AgentsModule } from './agents/agents.module';
import { MemoryModule } from './memory/memory.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { PrismaModule } from './prisma.module';
import { AdminAuthGuard } from './admin/admin-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    CommonModule,
    AgentsModule,
    MemoryModule,
    UsersModule,
    AdminModule,
  ],
  controllers: [AppController, RagController, WhatsappController],
  providers: [
    AppService,
    PdfService,
    RagService,
    WhatsappService,
    AdminAuthGuard,
  ],
})
export class AppModule {}
