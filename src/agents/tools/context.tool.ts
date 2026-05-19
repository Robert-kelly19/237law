import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MemoryService } from '../../memory/memory.service';

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

      // Get all sessions for user
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
    } catch (error:any) {
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
   * Identify legal topic from query
   */
  getTopic(query: string): ToolResult {
    try {
      this.logger.debug(`Identifying topic from query: ${query}`);

      const legalTopics = {
        labor: [
          'labor',
          'employment',
          'worker',
          'salary',
          'wage',
          'contract',
          'dismissal',
          'overtime',
        ],
        penal: [
          'crime',
          'theft',
          'assault',
          'murder',
          'penalty',
          'prison',
          'jail',
          'criminal',
        ],
        civil: [
          'contract',
          'property',
          'inheritance',
          'marriage',
          'divorce',
          'lawsuit',
          'damages',
        ],
        family: [
          'marriage',
          'divorce',
          'child',
          'custody',
          'adoption',
          'inheritance',
          'family',
        ],
        commercial: [
          'business',
          'company',
          'trade',
          'commercial',
          'contract',
          'sale',
          'purchase',
        ],
        procedural: [
          'court',
          'procedure',
          'evidence',
          'trial',
          'lawsuit',
          'jurisdiction',
          'legal',
        ],
        constitutional: [
          'constitution',
          'government',
          'rights',
          'fundamental',
          'state',
          'citizen',
        ],
      };

      const queryLower = query.toLowerCase();
      const scores: Record<string, number> = {};

      // Calculate topic scores
      for (const [topic, keywords] of Object.entries(legalTopics)) {
        scores[topic] = keywords.filter((keyword) =>
          queryLower.includes(keyword),
        ).length;
      }

      // Find the topic with highest score
      const sortedTopics = Object.entries(scores)
        .filter(([, score]) => score > 0)
        .sort(([, scoreA], [, scoreB]) => scoreB - scoreA);

      const identifiedTopics = sortedTopics.map(([topic]) => topic);
      const primaryTopic = identifiedTopics[0] || 'general';
      const confidence =
        sortedTopics.length > 0 ? Math.min(sortedTopics[0][1] / 3, 1) : 0.3;

      return {
        success: true,
        data: {
          primaryTopic,
          relatedTopics: identifiedTopics.slice(1),
          confidence,
          query,
        },
        reasoning: `Identified primary topic as "${primaryTopic}" with ${(confidence * 100).toFixed(0)}% confidence`,
      };
    } catch (error:any) {
      this.logger.error(
        `Failed to identify topic: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: {
          primaryTopic: 'general',
          confidence: 0,
        },
        reasoning: `Failed to identify topic: ${error.message}`,
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
        reasoning: `Stored ${params.action} reasoning step with ${(params.confidence || 1.0) * 100}% confidence`,
      };
    } catch (error:any) {
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
   * Get all reasoning steps for a conversation
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
        reasoning: `Retrieved ${steps.length} reasoning steps for conversation`,
      };
    } catch (error:any) {
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
   * Store semantic context for future reference
   */
  async storeSemanticContext(params: {
    userId: string;
    memoryType: 'topic' | 'learned_article' | 'user_preference' | 'reasoning_trace';
    key: string;
    content: Record<string, any>;
    importance?: number;
  }): Promise<ToolResult> {
    try {
      this.logger.debug(
        `Storing semantic context: ${params.memoryType} - ${params.key}`,
      );

      const memory = await this.memoryService.storeSemanticMemory({
        userId: params.userId,
        memoryType: params.memoryType,
        key: params.key,
        content: params.content,
        importance: params.importance,
      });

      return {
        success: true,
        data: memory,
        reasoning: `Stored semantic memory: ${params.key} with importance ${params.importance || 1}`,
      };
    } catch (error:any) {
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
   * Get semantic context by topic
   */
  async getSemanticContext(
    userId: string,
    memoryType: string,
  ): Promise<ToolResult> {
    try {
      this.logger.debug(
        `Getting semantic context: ${memoryType} for user ${userId}`,
      );

      const context = await this.memoryService.getSemanticContext(
        userId,
        memoryType,
        { limit: 5 },
      );

      return {
        success: true,
        data: context,
        reasoning: `Retrieved ${context.length} semantic memories of type ${memoryType}`,
      };
    } catch (error:any) {
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
   * Build context summary for the agent
   */
  async buildContextSummary(
    userId: string,
    sessionId: string,
  ): Promise<ToolResult> {
    try {
      this.logger.debug(
        `Building context summary for user ${userId}, session ${sessionId}`,
      );

      const conversationHistory = await this.memoryService.getConversationHistory(
        userId,
        sessionId,
        { lastN: 5 },
      );

      const recentTopics = await this.memoryService.getSemanticContext(
        userId,
        'topic',
        { limit: 3 },
      );

      const summary = {
        userId,
        sessionId,
        conversationLength: conversationHistory.length,
        recentQueries: conversationHistory.map((t) => t.userQuery),
        topicsOfInterest: recentTopics.map((t) => t.key),
        lastInteraction: conversationHistory[conversationHistory.length - 1]
          ?.createdAt,
      };

      return {
        success: true,
        data: summary,
        reasoning: `Built context summary with ${conversationHistory.length} turns and ${recentTopics.length} topics`,
      };
    } catch (error:any) {
      this.logger.error(
        `Failed to build context summary: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: null,
        reasoning: `Failed to build context summary: ${error.message}`,
      };
    }
  }
}
