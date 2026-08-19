import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConversationService } from './conversation.service';
import { MemoryService } from './memory.service';

@Module({
  providers: [PrismaService, MemoryService, ConversationService],
  exports: [PrismaService, MemoryService, ConversationService],
})
export class MemoryModule {}
