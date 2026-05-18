import { Injectable, Logger } from '@nestjs/common';
import { LawSearchTool } from './tools/law-search.tool';
import { CitationTool } from './tools/citation.tool';
import { ContextTool } from './tools/context.tool';
import { MemoryService } from '../memory/memory.service';
import { ConversationService } from '../memory/conversation.service';

export interface AgentQuery {
  userId: string;
  sessionId?: string;
  query: string;
  context?: Record<string, any>;
}

export interface AgentResponse {
  answer: string;
  citations: any[];
  reasoning: {
    topic: string;
    confidence: number;
    toolsUsed: string[];
    steps: any[];
  };
  relatedArticles: any[];
  conversationTurnId?: string;
}

interface ReasoningStep {
  step: number;
  action: string;
  input: string;
  output: any;
  confidence: number;
}

@Injectable()
export class LegalAgentService {
  private readonly logger = new Logger(LegalAgentService.name);
  private reasoningSteps: ReasoningStep[] = [];

  constructor(
    private lawSearchTool: LawSearchTool,
    private citationTool: CitationTool,
    private contextTool: ContextTool,
    private memoryService: MemoryService,
    private conversationService: ConversationService,
  ) {}

  /**
   * Main agent entry point - processes a user query
   */
  async processQuery(query: AgentQuery): Promise<AgentResponse> {
    this.reasoningSteps = [];

    try {
      this.logger.debug(`Processing query for user ${query.userId}: ${query.query}`);

      // Step 1: Classify and identify topic
      const classification = await this.classifyQuery(query.query);
      this.addReasoningStep({
        step: 1,
        action: 'classify',
        input: query.query,
        output: classification,
        confidence: classification.confidence,
      });

      if (!classification.isLegalQuestion) {
        return this.buildRefusalResponse(
          'I can only assist with Cameroonian law questions.',
          classification,
        );
      }

      // Step 2: Get or create session and context
      let sessionId = query.sessionId;
      if (!sessionId) {
        sessionId = await this.conversationService.getOrCreateSession(
          query.userId,
        );
      }

      const conversationContext = await this.contextTool.buildContextSummary(
        query.userId,
        sessionId,
      );
      this.addReasoningStep({
        step: 2,
        action: 'context',
        input: sessionId,
        output: conversationContext.data,
        confidence: 1.0,
      });

      // Step 3: Plan tool usage
      const toolPlan = this.planToolUsage(classification);
      this.addReasoningStep({
        step: 3,
        action: 'plan',
        input: JSON.stringify(classification),
        output: toolPlan,
        confidence: 1.0,
      });

      // Step 4: Execute tools
      const toolResults = await this.executeTools(toolPlan, query.query);
      this.addReasoningStep({
        step: 4,
        action: 'execute_tools',
        input: JSON.stringify(toolPlan),
        output: toolResults,
        confidence: toolResults.overallConfidence,
      });

      // Step 5: Synthesize results
      const synthesis = this.synthesizeResults(
        query.query,
        toolResults,
        classification,
      );
      this.addReasoningStep({
        step: 5,
        action: 'synthesize',
        input: JSON.stringify(toolResults),
        output: synthesis,
        confidence: 1.0,
      });

      // Step 6: Store conversation turn
      const turnNumber = await this.conversationService.getNextTurnNumber(
        sessionId,
      );

      const conversationTurn = await this.memoryService.storeConversation({
        userId: query.userId,
        sessionId,
        turnNumber,
        userQuery: query.query,
        response: synthesis.answer,
        toolsUsed: synthesis.toolsUsed,
        lawSectionsRef: synthesis.citedArticles.map((a: any) => a.id),
        agentThought: {
          topic: classification.topic,
          confidence: classification.confidence,
          reasoning: this.reasoningSteps,
        },
      });

      // Step 7: Store semantic memory
      if (classification.topic !== 'general') {
        await this.contextTool.storeSemanticContext({
          userId: query.userId,
          memoryType: 'topic',
          key: classification.topic,
          content: {
            lastAsked: new Date().toISOString(),
            queryCount: 1,
          },
          importance: Math.ceil(classification.confidence * 5),
        });
      }

      this.logger.debug(
        `Successfully processed query for user ${query.userId}`,
      );

      return {
        answer: synthesis.answer,
        citations: synthesis.citations,
        reasoning: {
          topic: classification.topic,
          confidence: classification.confidence,
          toolsUsed: synthesis.toolsUsed,
          steps: this.reasoningSteps,
        },
        relatedArticles: synthesis.relatedArticles,
        conversationTurnId: conversationTurn.id,
      };
    } catch (error) {
      this.logger.error(`Query processing failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Classify the incoming query
   */
  private async classifyQuery(query: string): Promise<{
    topic: string;
    isLegalQuestion: boolean;
    confidence: number;
    requiresCrossRef: boolean;
  }> {
    const topicResult = this.contextTool.getTopic(query);

    if (!topicResult.success) {
      return {
        topic: 'general',
        isLegalQuestion: false,
        confidence: 0,
        requiresCrossRef: false,
      };
    }

    const topic = topicResult.data.primaryTopic;
    const confidence = topicResult.data.confidence;

    // Determine if cross-referencing is needed based on keywords
    const requiresCrossRef =
      /\b(related|also|further|connection|implication|impact|effect)\b/i.test(
        query,
      );

    return {
      topic,
      isLegalQuestion: confidence > 0.3 || topic !== 'general',
      confidence: Math.max(confidence, 0.5),
      requiresCrossRef,
    };
  }

  /**
   * Plan which tools to use
   */
  private planToolUsage(classification: any): {
    tools: string[];
    sequence: string;
  } {
    const tools: string[] = [];

    // Primary search tool
    tools.push('search_by_keyword');

    // Add topic-specific searches
    if (classification.topic !== 'general') {
      tools.push('search_by_topic');
    }

    // Add cross-reference tool if needed
    if (classification.requiresCrossRef) {
      tools.push('get_cross_references');
    }

    return {
      tools,
      sequence: tools.join(' -> '),
    };
  }

  /**
   * Execute the planned tools
   */
  private async executeTools(
    toolPlan: any,
    query: string,
  ): Promise<{
    searchResults: any[];
    topicResults: any[];
    crossReferences: any[];
    overallConfidence: number;
  }> {
    const results = {
      searchResults: [],
      topicResults: [],
      crossReferences: [],
      overallConfidence: 1.0,
    };

    try {
      // Execute keyword search
      if (toolPlan.tools.includes('search_by_keyword')) {
        const searchResult = await this.lawSearchTool.searchByKeyword(
          query,
          5,
        );
        if (searchResult.success) {
          results.searchResults = searchResult.data;
        }
      }

      // Execute topic search
      if (toolPlan.tools.includes('search_by_topic')) {
        const topicResult = await this.lawSearchTool.searchByTopic(query, 3);
        if (topicResult.success) {
          results.topicResults = topicResult.data;
        }
      }

      // Execute cross-reference search
      if (
        toolPlan.tools.includes('get_cross_references') &&
        results.searchResults.length > 0
      ) {
        const primaryArticle: any = results.searchResults[0];
        const crossRefResult = await this.lawSearchTool.getCrossReferences(
          primaryArticle.id,
          3,
        );
        if (crossRefResult.success) {
          results.crossReferences = crossRefResult.data;
        }
      }

      results.overallConfidence = 0.95;
    } catch (error) {
      this.logger.error(`Tool execution failed: ${error.message}`);
      results.overallConfidence = 0.6;
    }

    return results;
  }

  /**
   * Synthesize tool results into a coherent answer
   */
  private synthesizeResults(
    query: string,
    toolResults: any,
    classification: any,
  ): {
    answer: string;
    citations: any[];
    citedArticles: any[];
    toolsUsed: string[];
    relatedArticles: any[];
  } {
    const allArticles = [
      ...toolResults.searchResults,
      ...toolResults.topicResults,
    ];

    // Remove duplicates by ID
    const uniqueArticles = Array.from(
      new Map(allArticles.map((a) => [a.id, a])).values(),
    );

    // Generate citations
    const citations = uniqueArticles.map((article: any) =>
      this.citationTool.generateInlineCitation(article),
    );

    // Build answer
    let answer = '';

    if (uniqueArticles.length === 0) {
      answer =
        'I was unable to find specific Cameroonian law provisions directly addressing your question. ' +
        'Could you rephrase your question or provide more details about which area of law you are interested in?';
    } else {
      const primaryArticle: any = uniqueArticles[0];
      answer =
        `Based on Cameroonian law, specifically ${this.citationTool.generateInlineCitation(primaryArticle)}:\n\n` +
        `${primaryArticle.content}\n\n` +
        (uniqueArticles.length > 1
          ? `This provision is related to:\n${uniqueArticles.slice(1).map((a: any) => `- ${this.citationTool.generateInlineCitation(a)}`).join('\n')}`
          : '');
    }

    // Prepare related articles
    const relatedArticles = toolResults.crossReferences.slice(0, 3);

    return {
      answer,
      citations,
      citedArticles: uniqueArticles.map((a: any) => ({
        id: a.id,
        lawName: a.lawName,
        articleNumber: a.articleNumber,
      })),
      toolsUsed: ['search_by_keyword', 'search_by_topic', 'get_cross_references'].filter(
        (t) => {
          if (t === 'search_by_keyword')
            return toolResults.searchResults.length > 0;
          if (t === 'search_by_topic')
            return toolResults.topicResults.length > 0;
          if (t === 'get_cross_references')
            return toolResults.crossReferences.length > 0;
          return false;
        },
      ),
      relatedArticles,
    };
  }

  /**
   * Build a refusal response for non-legal questions
   */
  private buildRefusalResponse(
    message: string,
    classification: any,
  ): AgentResponse {
    return {
      answer: message,
      citations: [],
      reasoning: {
        topic: classification.topic,
        confidence: classification.confidence,
        toolsUsed: [],
        steps: this.reasoningSteps,
      },
      relatedArticles: [],
    };
  }

  /**
   * Add a reasoning step
   */
  private addReasoningStep(step: ReasoningStep): void {
    this.reasoningSteps.push(step);
  }
}
