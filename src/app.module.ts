import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { PdfService } from './pdf.service';
import { EmbeddingService } from './embedding.service';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';

@Module({
  imports: [],
  controllers: [AppController, RagController],
  providers: [AppService, PrismaService, PdfService, EmbeddingService, RagService],
})
export class AppModule {}
