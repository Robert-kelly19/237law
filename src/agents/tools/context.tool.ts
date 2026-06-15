import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MemoryService } from '../../memory/memory.service';
import { EmbeddingService } from '../../embedding.service';

export interface ToolResult {
  success: boolean;
  data: any;
  reasoning: string;
}

@Injectable()
export class ContextTool {
  private readonly logger = new Logger(ContextTool.name);

  constructor(
    private prisma: PrismaService,
    private memoryService: MemoryService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Get conversation context for a user
   */
  async getConversationContext(
    userId: string,
    sessionId?: string,
  ): Promise<ToolResult> {
    try {
      this.logger.debug(
        `Getting conversation context for user: ${userId}, session: ${sessionId}`,
      );

      if (sessionId) {
        const history = await this.memoryService.getConversationHistory(
          userId,
          sessionId,
          { lastN: 10 },
        );

        return {
          success: true,
          data: {
            userId,
            sessionId,
            turnCount: history.length,
            history,
          },
          reasoning: `Retrieved ${history.length} conversation turns for user ${userId}`,
        };
      }

      const conversations = await this.memoryService.getUserConversations(
        userId,
        5,
      );

      return {
        success: true,
        data: {
          userId,
          sessionCount: conversations.sessions.length,
          sessions: conversations.sessions,
        },
        reasoning: `Retrieved ${conversations.sessions.length} conversation sessions for user ${userId}`,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to get conversation context: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        data: null,
        reasoning: `Failed to get conversation context: ${error.message}`,
      };
    }
  }

  /**
   * Store a reasoning step for the agent
   */
  async storeReasoningStep(params: {
    conversationId: string;
    step: number;
    action: string;
    input: string;
    output: string;
    confidence?: number;
  }): Promise<ToolResult> {
    try {
      this.logger.debug(
        `Storing reasoning step ${params.step} for conversation ${params.conversationId}`,
      );

      const reasoningStep = await this.prisma.agentReasoning.create({
        data: {
          conversationId: params.conversationId,
          step: params.step,
          action: params.action,
          input: params.input,
          output: params.output,
          confidence: params.confidence || 1.0,
        },
      });

      return {
        success: true,
        data: reasoningStep,
        reasoning: `Stored ${params.action} reasoning step`,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to store reasoning step: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        data: null,
        reasoning: `Failed to store reasoning step: ${error.message}`,
      };
    }
  }

  /**
   * Get reasoning trace for a conversation
   */
  async getReasoningTrace(conversationId: string): Promise<ToolResult> {
    try {
      this.logger.debug(`Retrieving reasoning trace for ${conversationId}`);

      const steps = await this.prisma.agentReasoning.findMany({
        where: { conversationId },
        orderBy: { step: 'asc' },
      });

      return {
        success: true,
        data: steps,
        reasoning: `Retrieved ${steps.length} reasoning steps`,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to get reasoning trace: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        data: [],
        reasoning: `Failed to get reasoning trace: ${error.message}`,
      };
    }
  }

  /**
   * Store semantic context
   */
  async storeSemanticContext(params: {
    userId: string;
    memoryType:
      | 'topic'
      | 'learned_article'
      | 'user_preference'
      | 'reasoning_trace';

    key: string;
    content: Record<string, any>;
    importance?: number;
  }): Promise<ToolResult> {
    try {
      this.logger.debug(
        `Storing semantic context: ${params.memoryType} - ${params.key}`,
      );

      let embedding: number[] | undefined;
      try {
        const memoryText = [
          params.memoryType,
          params.key,
          JSON.stringify(params.content),
        ].join('\n');
        embedding = await this.embeddingService.generateQueryEmbedding(
          memoryText,
        );
      } catch (error: any) {
        this.logger.warn(
          `Semantic memory embedding failed, storing without vector: ${error.message}`,
        );
      }

      const memory = await this.memoryService.storeSemanticMemory({
        userId: params.userId,
        memoryType: params.memoryType,
        key: params.key,
        content: params.content,
        importance: params.importance,
        embedding,
      });

      return {
        success: true,
        data: memory,
        reasoning: `Stored semantic memory ${params.key}`,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to store semantic context: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        data: null,
        reasoning: `Failed to store semantic context: ${error.message}`,
      };
    }
  }

  /**
   * Retrieve semantic context
   */
  async getSemanticContext(
    userId: string,
    memoryType: string,
  ): Promise<ToolResult> {
    try {
      this.logger.debug(`Getting semantic context ${memoryType} for ${userId}`);

      const context = await this.memoryService.getSemanticContext(
        userId,
        memoryType,
        { limit: 5 },
      );

      return {
        success: true,
        data: context,
        reasoning: `Retrieved ${context.length} semantic memories`,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to get semantic context: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        data: [],
        reasoning: `Failed to get semantic context: ${error.message}`,
      };
    }
  }

  /**
   * Build context summary
   */
  async buildContextSummary(
    userId: string,
    sessionId: string,
  ): Promise<ToolResult> {
    try {
      this.logger.debug(`Building summary for ${userId}`);

      const conversationHistory =
        await this.memoryService.getConversationHistory(userId, sessionId, {
          lastN: 5,
        });

      const recentTopics = await this.memoryService.getSemanticContext(
        userId,
        'topic',
        { limit: 3 },
      );

      const summary = {
        userId,
        sessionId,
        conversationLength: conversationHistory.length,

        recentTurns: conversationHistory.map((turn) => ({
          query: turn.userQuery,
          response: this.truncateText(turn.response, 350),
          topic: turn.agentThought?.topic,
          lawSectionsRef: turn.lawSectionsRef,
          createdAt: turn.createdAt,
        })),

        topicsOfInterest: recentTopics.map((topic) => ({
          key: topic.key,
          importance: topic.importance,
          content: topic.content,
        })),

        lastInteraction:
          conversationHistory[conversationHistory.length - 1]?.createdAt,
      };

      return {
        success: true,
        data: summary,
        reasoning: `Built context summary`,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed building summary: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        data: null,
        reasoning: `Failed building summary: ${error.message}`,
      };
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength).trim()}...`;
  }
}
