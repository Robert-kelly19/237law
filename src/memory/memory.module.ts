import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ConversationService } from './conversation.service';
import { MemoryService } from './memory.service';

@Module({
  imports: [PrismaModule],
  providers: [MemoryService, ConversationService],
  exports: [PrismaModule, MemoryService, ConversationService],
})
export class MemoryModule {}
