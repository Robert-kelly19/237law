import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MemoryService } from './memory.service';

interface ConversationContext {
  userId: string;
  sessionId: string;
  history: any[];
  currentTopic?: string;
  previousTopics?: string[];
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private prisma: PrismaService,
    private memoryService: MemoryService,
  ) {}

  /**
   * Get or create a session for a user
   */
  async getOrCreateSession(userId: string): Promise<string> {
    try {
      // Get the most recent session for this user
      const lastTurn = await this.prisma.conversationTurn.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      // If no turns exist or last turn is older than a day, create new session
      if (!lastTurn) {
        return this.generateSessionId();
      }

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (lastTurn.createdAt < oneDayAgo) {
        return this.generateSessionId();
      }

      return lastTurn.sessionId;
    } catch (error:any) {
      this.logger.error(
        `Failed to get or create session: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get full conversation context for the agent
   */
  async getConversationContext(
    userId: string,
    sessionId: string,
    lastN: number = 10,
  ): Promise<ConversationContext> {
    try {
      const history = await this.memoryService.getConversationHistory(
        userId,
        sessionId,
        { lastN },
      );

      // Extract topics from previous turns
      const previousTopics = history
        .map((turn) => turn.agentThought?.topic)
        .filter(Boolean);

      const currentTopic = previousTopics[previousTopics.length - 1];

      return {
        userId,
        sessionId,
        history,
        currentTopic,
        previousTopics: [...new Set(previousTopics)],
      };
    } catch (error:any) {
      this.logger.error(
        `Failed to get conversation context: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get the next turn number for a session
   */
  async getNextTurnNumber(sessionId: string): Promise<number> {
    try {
      const lastTurn = await this.prisma.conversationTurn.findFirst({
        where: { sessionId },
        orderBy: { turnNumber: 'desc' },
      });

      return (lastTurn?.turnNumber || 0) + 1;
    } catch (error:any) {
      this.logger.error(
        `Failed to get next turn number: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Detect if there's a topic shift between query and context
   */
  detectTopicShift(newQuery: string, currentTopic?: string): boolean {
    if (!currentTopic) {
      return false;
    }

    // Simple keyword matching for topic detection
    const queryLower = newQuery.toLowerCase();
    const topicLower = currentTopic.toLowerCase();

    // If the new query doesn't contain any words from the current topic, it's a shift
    const topicWords = topicLower.split(/\s+/);
    const queryWords = queryLower.split(/\s+/);

    const matchCount = topicWords.filter((word) =>
      queryWords.some((qword) => qword.includes(word) || word.includes(qword)),
    ).length;

    return matchCount < topicWords.length * 0.3; // Less than 30% match = topic shift
  }

  /**
   * Generate a session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a summary of a conversation turn
   */
  async generateTurnSummary(
    turnId: string,
  ): Promise<{ query: string; response: string; tools: string[] }> {
    try {
      const turn = await this.prisma.conversationTurn.findUnique({
        where: { id: turnId },
      });

      if (!turn) {
        throw new Error(`Turn not found: ${turnId}`);
      }

      return {
        query: turn.userQuery,
        response: turn.response,
        tools: turn.toolsUsed,
      };
    } catch (error:any) {
      this.logger.error(
        `Failed to generate turn summary: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId: string): Promise<{
    totalTurns: number;
    topics: string[];
    toolsUsed: string[];
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      const turns = await this.prisma.conversationTurn.findMany({
        where: { sessionId },
        orderBy: { turnNumber: 'asc' },
      });

      if (turns.length === 0) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const allTools = new Set<string>();
      const topics = new Set<string>();

      turns.forEach((turn) => {
        turn.toolsUsed.forEach((tool) => allTools.add(tool));
        if (turn.agentThought) {
          const thought = JSON.parse(turn.agentThought);
          if (thought.topic) {
            topics.add(thought.topic);
          }
        }
      });

      return {
        totalTurns: turns.length,
        topics: Array.from(topics),
        toolsUsed: Array.from(allTools),
        createdAt: turns[0].createdAt,
        updatedAt: turns[turns.length - 1].updatedAt,
      };
    } catch (error:any) {
      this.logger.error(
        `Failed to get session stats: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
