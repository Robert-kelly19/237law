import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { PrismaService } from './prisma.service';
import { EmbeddingService } from './embedding.service';
import { PdfService } from './pdf.service';

@Module({
  providers: [RagService, PrismaService, EmbeddingService, PdfService],
  exports: [RagService],
})
export class RagModule {}
