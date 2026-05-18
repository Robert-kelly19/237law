import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

interface StoreConversationParams {
  userId: string;
  sessionId: string;
  turnNumber: number;
  userQuery: string;
  response: string;
  toolsUsed?: string[];
  lawSectionsRef?: string[];
  agentThought?: Record<string, any>;
}

interface StoreSemanticMemoryParams {
  userId: string;
  memoryType: 'topic' | 'learned_article' | 'user_preference' | 'reasoning_trace';
  key: string;
  content: Record<string, any>;
  importance?: number;
}

interface ConversationHistoryOptions {
  lastN?: number;
}

interface SemanticContextOptions {
  limit?: number;
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Store a conversation turn with agent reasoning and tool usage
   */
  async storeConversation(
    params: StoreConversationParams,
  ): Promise<any> {
    try {
      const conversationTurn = await this.prisma.conversationTurn.create({
        data: {
          userId: params.userId,
          sessionId: params.sessionId,
          turnNumber: params.turnNumber,
          userQuery: params.userQuery,
          response: params.response,
          toolsUsed: params.toolsUsed || [],
          lawSectionsRef: params.lawSectionsRef || [],
          agentThought: params.agentThought
            ? JSON.stringify(params.agentThought)
            : null,
        },
      });

      this.logger.debug(
        `Stored conversation turn: ${conversationTurn.id} for user: ${params.userId}`,
      );
      return conversationTurn;
    } catch (error:any) {
      this.logger.error(
        `Failed to store conversation: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Store semantic memory for a user
   */
  async storeSemanticMemory(
    params: StoreSemanticMemoryParams,
  ): Promise<any> {
    try {
      const semanticMemory = await this.prisma.semanticMemory.create({
        data: {
          userId: params.userId,
          memoryType: params.memoryType,
          key: params.key,
          content: JSON.stringify(params.content),
          importance: params.importance || 1,
        },
      });

      this.logger.debug(
        `Stored semantic memory: ${semanticMemory.id} for user: ${params.userId}`,
      );
      return semanticMemory;
    } catch (error:any) {
      this.logger.error(
        `Failed to store semantic memory: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get conversation history for a user/session
   */
  async getConversationHistory(
    userId: string,
    sessionId: string,
    options?: ConversationHistoryOptions,
  ): Promise<any[]> {
    try {
      const lastN = options?.lastN || 10;

      const turns = await this.prisma.conversationTurn.findMany({
        where: {
          userId,
          sessionId,
        },
        orderBy: {
          turnNumber: 'desc',
        },
        take: lastN,
      });

      // Reverse to get chronological order
      return turns.reverse().map((turn) => ({
        ...turn,
        agentThought: turn.agentThought ? JSON.parse(turn.agentThought) : null,
      }));
    } catch (error:any) {
      this.logger.error(
        `Failed to get conversation history: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get semantic context for a user by topic/type
   */
  async getSemanticContext(
    userId: string,
    memoryType: string,
    options?: SemanticContextOptions,
  ): Promise<any[]> {
    try {
      const limit = options?.limit || 5;

      const memories = await this.prisma.semanticMemory.findMany({
        where: {
          userId,
          memoryType,
        },
        orderBy: {
          importance: 'desc',
        },
        take: limit,
      });

      return memories.map((memory) => ({
        ...memory,
        content: JSON.parse(memory.content),
      }));
    } catch (error:any) {
      this.logger.error(
        `Failed to get semantic context: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Update the importance score of a memory
   */
  async updateMemoryImportance(
    memoryId: string,
    importance: number,
  ): Promise<any> {
    try {
      // Clamp importance between 1 and 5
      const clampedImportance = Math.max(1, Math.min(5, importance));

      const updated = await this.prisma.semanticMemory.update({
        where: { id: memoryId },
        data: { importance: clampedImportance },
      });

      this.logger.debug(
        `Updated memory importance: ${memoryId} to ${clampedImportance}`,
      );
      return updated;
    } catch (error:any) {
      this.logger.error(
        `Failed to update memory importance: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get all conversations for a user (paginated)
   */
  async getUserConversations(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ sessions: any[]; total: number }> {
    try {
      const sessions = await this.prisma.conversationTurn.findMany({
        where: { userId },
        distinct: ['sessionId'],
        orderBy: {
          createdAt: 'desc',
        },
        skip: offset,
        take: limit,
      });

      const total = await this.prisma.conversationTurn.count({
        where: { userId },
      });

      return { sessions, total };
    } catch (error:any) {
      this.logger.error(
        `Failed to get user conversations: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Delete old conversation data for privacy
   */
  async deleteOldConversations(daysOld: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.prisma.conversationTurn.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      this.logger.debug(
        `Deleted ${result.count} conversation turns older than ${daysOld} days`,
      );
      return result.count;
    } catch (error:any) {
      this.logger.error(
        `Failed to delete old conversations: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
