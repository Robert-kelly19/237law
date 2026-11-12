import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PdfService } from './pdf.service';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { AgentsModule } from './agents/agents.module';
import { MemoryModule } from './memory/memory.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { PrismaModule } from './prisma.module';
import { AdminAuthGuard } from './admin/admin-auth.guard';
import { WhatsappModule } from './whatsapp/whatsapp.module';

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
    WhatsappModule,
  ],
  controllers: [AppController, RagController],
  providers: [AppService, PdfService, RagService, AdminAuthGuard],
})
export class AppModule {}
