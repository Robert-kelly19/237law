import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { PrismaModule } from './prisma.module';
import { EmbeddingService } from './embedding.service';
import { PdfService } from './pdf.service';

@Module({
  imports: [PrismaModule],
  providers: [RagService, EmbeddingService, PdfService],
  exports: [RagService],
})
export class RagModule {}
