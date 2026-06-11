import { Injectable, Logger } from '@nestjs/common';
import { LawSearchTool } from './tools/law-search.tool';
import { CitationTool } from './tools/citation.tool';
import { ContextTool } from './tools/context.tool';
import { MemoryService } from '../memory/memory.service';
import { ConversationService } from '../memory/conversation.service';
import { PerformanceTrackerService } from '../performance/performance-tracker.service';
import { LLMResponseCacheService } from '../cache/llm-response-cache.service';
import { EmbeddingService } from '../embedding.service';
import { LanguageDetectionService } from '../common/language-detection.service';
import { GreetingsService } from '../common/greetings.service';
import { LEGAL_CORE_RULES_PROMPT } from '../common/legal-core-rules-prompt';
import OpenAI from 'openai';

/**
 * Core legal article type used across RAG pipeline
 */
export interface LawArticle {
  id: string;
  lawName: string;
  articleNumber: string;
  content: string;
}

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

type ToolExecutionResult = {
  searchResults: LawArticle[];
  semanticResults: LawArticle[];
  crossReferences: LawArticle[];
  overallConfidence: number;
};

@Injectable()
export class LegalAgentService {
  private readonly logger = new Logger(LegalAgentService.name);
  private readonly openai: OpenAI;

  constructor(
    private lawSearchTool: LawSearchTool,
    private citationTool: CitationTool,
    private contextTool: ContextTool,
    private memoryService: MemoryService,
    private conversationService: ConversationService,
    private performanceTracker: PerformanceTrackerService,
    private llmCacheService: LLMResponseCacheService,
    private embeddingService: EmbeddingService,
    private languageDetection: LanguageDetectionService,
    private greetingsService: GreetingsService,
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * MAIN ENTRY POINT
   */
  async processQuery(query: AgentQuery): Promise<AgentResponse> {
    return this.performanceTracker.track('processQuery', async () => {
      const reasoningSteps: ReasoningStep[] = [];

      const addReasoningStep = (step: ReasoningStep): void => {
        reasoningSteps.push(step);
      };

      try {
        this.logger.debug(
          `Processing query for (length: ${query.query.length})`,
        );

        // STEP 0: Get session ID first (needed for context checking)
        const sessionId = await this.performanceTracker.track(
          'getOrCreateSession',
          () =>
            query.sessionId
              ? Promise.resolve(query.sessionId)
              : this.conversationService.getOrCreateSession(query.userId),
        );

        // STEP 1: Detect language and check for greetings WITH context awareness
        const detectedLanguage = this.languageDetection.detect(query.query);
        this.logger.debug(`Detected language: ${detectedLanguage}`);

        // NEW: Check context-aware greeting logic
        const isGreetingOnly = this.languageDetection.isGreetingOnly(
          query.query,
        );
        const hasLegalIntent = this.languageDetection.hasLegalIntent(
          query.query,
        );

        if (isGreetingOnly) {
          // Pure greeting without legal content - check if user was recently greeted
          const hasRecentGreeting =
            await this.conversationService.hasRecentGreeting(
              query.userId,
              sessionId,
            );

          if (hasRecentGreeting) {
            // User already greeted in this session, skip greeting response
            this.logger.debug(
              `User already greeted recently, skipping greeting response`,
            );

            const followUpGreeting = this.greetingsService.getFollowUpGreeting(
              detectedLanguage,
            );

            // Use follow-up greeting instead of formal greeting
            return {
              answer: followUpGreeting,
              citations: [],
              reasoning: {
                confidence: 1.0,
                toolsUsed: ['greeting_skip_detector'],
                steps: [
                  {
                    step: 1,
                    action: 'detect_greeting_skip',
                    input: query.query,
                    output: {
                      isGreetingOnly: true,
                      hasRecentGreeting: true,
                      skipped: true,
                    },
                    confidence: 1.0,
                  },
                ],
              },
              relatedArticles: [],
            };
          } else {
            // First greeting in session - send greeting
            const detectedGreetingLanguage =
              this.languageDetection.detectGreetingLanguage(query.query);
            const greeting = this.greetingsService.getGreeting(
              detectedGreetingLanguage,
              query.userId,
            );
            this.logger.debug(`First greeting detected, returning: ${greeting}`);

            return {
              answer: greeting,
              citations: [],
              reasoning: {
                confidence: 1.0,
                toolsUsed: ['greeting_detector'],
                steps: [
                  {
                    step: 1,
                    action: 'detect_greeting',
                    input: query.query,
                    output: {
                      isGreeting: true,
                      language: detectedGreetingLanguage,
                    },
                    confidence: 1.0,
                  },
                ],
              },
              relatedArticles: [],
            };
          }
        }

        // If text has greeting + legal intent, skip greeting response
        if (
          this.languageDetection.isGreeting(query.query) &&
          hasLegalIntent
        ) {
          this.logger.debug(
            `Greeting with legal intent detected, proceeding to legal processing`,
          );
          // Continue to legal processing below
        }

        // STEP 2: Lightweight intent analysis (NO taxonomy)
        const analysis = this.performanceTracker.trackSync(
          'analyze_query',
          () => this.analyzeQuery(query.query),
        );

        addReasoningStep({
          step: 2,
          action: 'analyze_query',
          input: query.query,
          output: analysis,
          confidence: analysis.confidence,
        });

        // STEP 3: Build context with already-fetched sessionId
        const [context] = await Promise.all([
          this.performanceTracker.track('buildContextSummary', async () =>
            this.contextTool.buildContextSummary(query.userId, sessionId),
          ),
          this.performanceTracker.track('generateQueryEmbedding', () =>
            this.embeddingService.generateQueryEmbedding(query.query),
          ),
        ]);

        addReasoningStep({
          step: 3,
          action: 'context',
          input: sessionId,
          output: context.data,
          confidence: 1.0,
        });

        // STEP 4: Tool plan (always semantic-first RAG)
        const toolPlan = this.performanceTracker.trackSync('plan_tools', () =>
          this.planToolUsage(),
        );

        addReasoningStep({
          step: 4,
          action: 'plan_tools',
          input: query.query,
          output: toolPlan,
          confidence: 1.0,
        });

        // STEP 5: Execute retrieval tools
        const toolResults = await this.performanceTracker.track(
          'execute_tools',
          () => this.executeTools(toolPlan, query.query),
        );

        addReasoningStep({
          step: 5,
          action: 'execute_tools',
          input: JSON.stringify(toolPlan),
          output: toolResults,
          confidence: toolResults.overallConfidence,
        });

        // STEP 6: RAG synthesis
        const synthesis = await this.performanceTracker.track(
          'synthesizeResults',
          () =>
            this.synthesizeResults(query.query, toolResults, detectedLanguage),
        );

        addReasoningStep({
          step: 6,
          action: 'synthesize',
          input: JSON.stringify(toolResults),
          output: synthesis,
          confidence: 1.0,
        });

        // STEP 7 & 8: PARALLELIZE conversation storage and semantic memory
        // These can happen in the background and don't block the response
        const turnNumber = await this.performanceTracker.track(
          'getNextTurnNumber',
          () => this.conversationService.getNextTurnNumber(sessionId),
        );

        // Store conversation and semantic memory in parallel
        // (fire and forget - don't wait for completion as they're not critical for response)
        Promise.all([
          this.memoryService.storeConversation({
            userId: query.userId,
            sessionId,
            turnNumber,
            userQuery: query.query,
            response: synthesis.answer,
            toolsUsed: synthesis.toolsUsed,
            lawSectionsRef: synthesis.citedArticles.map((a) => a.id),
            agentThought: {
              confidence: analysis.confidence,
              reasoning: reasoningSteps,
              topic: this.extractTopic(query.query),
            },
          }),
          this.contextTool.storeSemanticContext({
            userId: query.userId,
            memoryType: 'user_preference',
            key: 'legal_query',
            content: {
              query: query.query,
              timestamp: new Date().toISOString(),
              language: detectedLanguage,
            },
            importance: 3,
          }),
        ]).catch((err) => {
          this.logger.error(
            'Error storing conversation/memory in background:',
            err,
          );
        });

        return {
          answer: synthesis.answer,
          citations: synthesis.citations,
          reasoning: {
            confidence: analysis.confidence,
            toolsUsed: synthesis.toolsUsed,
            steps: reasoningSteps,
          },
          relatedArticles: synthesis.relatedArticles,
        };
      } catch (error: any) {
        this.logger.error(error.message, error.stack);
        throw error;
      }
    });
  }

  /**
   * Lightweight semantic intent detection (NO taxonomy)
   */
  private analyzeQuery(query: string): {
    isLegalQuestion: boolean;
    confidence: number;
    requiresCrossRef: boolean;
  } {
    const q = query.toLowerCase();

    const hints = [
      'law',
      'legal',
      'court',
      'rights',
      'police',
      'arrest',
      'contract',
      'judge',
      'warrant',
      'sue',
    ];

    const score = hints.filter((h) => q.includes(h)).length;

    return {
      isLegalQuestion: true,
      confidence: Math.min(0.5 + score * 0.1, 1),
      requiresCrossRef: /\b(related|impact|effect|implication)\b/i.test(query),
    };
  }

  /**
   * Always semantic-first tool planning
   */
  private planToolUsage(): {
    tools: string[];
    sequence: string;
  } {
    const tools = ['search_semantic'];

    return {
      tools,
      sequence: tools.join(' -> '),
    };
  }

  /**
   * TOOL EXECUTION (fully typed)
   */
  private async executeTools(
    toolPlan: any,
    query: string,
  ): Promise<ToolExecutionResult> {
    const results: ToolExecutionResult = {
      searchResults: [],
      semanticResults: [],
      crossReferences: [],
      overallConfidence: 1.0,
    };

    try {
      if (toolPlan.tools.includes('search_semantic')) {
        const merged = new Map<string, LawArticle>();
        const articleMatch = query.match(/\b(?:article|art\.?)\s*([\d\w-]+)/i);

        if (articleMatch) {
          const lawName = this.deriveLawNameFromArticleQuery(
            query,
            articleMatch[1],
          );

          if (lawName) {
            const exactArticleRes =
              await this.lawSearchTool.searchByLawAndArticle(
                lawName,
                articleMatch[1],
              );
            const exactArticleData = exactArticleRes.success
              ? exactArticleRes.data
              : [];

            for (const item of exactArticleData) {
              merged.set(item.id, item);
            }
          } else {
            this.logger.warn(
              `Article number found without a law name; skipping exact article search: ${query}`,
            );
          }
        }

        const [semanticRes, keywordRes] = await Promise.all([
          this.lawSearchTool.searchByTopic(query, 10),
          this.lawSearchTool.searchByKeyword(query, 10),
        ]);

        const semanticData = semanticRes.success ? semanticRes.data : [];
        const keywordData = keywordRes.success ? keywordRes.data : [];

        for (const item of semanticData) {
          merged.set(item.id, item);
        }

        for (const item of keywordData) {
          merged.set(item.id, item);
        }

        results.semanticResults = Array.from(merged.values());
      }

      results.overallConfidence =
        results.semanticResults.length > 0 ? 0.9 : 0.3;
    } catch (error: any) {
      this.logger.error(error.message);
      results.overallConfidence = 0.6;
    }

    return results;
  }

  /**
   * RAG synthesis with LLM and response caching
   */
  private async synthesizeResults(
    query: string,
    toolResults: ToolExecutionResult,
    detectedLanguage?: string,
  ): Promise<{
    answer: string;
    citations: any[];
    citedArticles: any[];
    toolsUsed: string[];
    relatedArticles: any[];
  }> {
    return this.performanceTracker.track('rag_synthesis_with_llm', async () => {
      const unique = toolResults.semanticResults;

      const citations = unique.map((a) =>
        this.citationTool.generateInlineCitation(a),
      );

      // Check LLM response cache
      const cacheKey = this.llmCacheService.generateKey(query, [
        'semantic_search',
        'keyword_search',
      ]);
      const cachedResponse = this.llmCacheService.get(cacheKey);

      let answer: string;

      if (unique.length === 0) {
        answer = `Sorry, I couldn't find a clear legal answer for your question.

NB: This response is provided for informational purposes only and does not constitute legal advice.
For proper legal assistance, please consult a qualified lawyer via the contact details in our bio.`;
      } else if (cachedResponse) {
        this.logger.debug(
          `LLM response cache hit for query: ${query.substring(0, 50)}...`,
        );
        answer = cachedResponse;
      } else {
        const context = unique
          .map(
            (s) => `${s.lawName} - Article ${s.articleNumber}:\n${s.content}`,
          )
          .join('\n\n');

        const languageInstructions =
          this.getLanguageInstructions(detectedLanguage);

        const prompt = `
You are a professional legal assistant specializing exclusively in Cameroonian law. You help ordinary citizens, entrepreneurs, students, and professionals understand their legal rights and obligations under Cameroonian legislation.

---

${languageInstructions}

---

IDENTITY & SCOPE:
- You only advise on Cameroonian law (OHADA, Penal Code, Civil Code, Criminal Procedure Code, Labour Code, Commercial Code, and other applicable Cameroonian statutes).
- You do NOT answer questions about foreign legal systems unless comparing them to Cameroonian law at the user's explicit request.
- You are NOT a substitute for a qualified lawyer. Always remind users of this at the end.

---

${LEGAL_CORE_RULES_PROMPT}

---

CITATION RULES:
- Always cite the exact article/section number and full law name (e.g., "Article 74 of the Cameroonian Penal Code").
- If multiple laws apply (e.g., Penal Code AND Criminal Procedure Code), you MUST cite ALL relevant ones and explain what each contributes.
- If the same topic is covered by both a general law and a special law (e.g., OHADA vs. national Commercial Code), note which one takes precedence and why.
- Never merge or paraphrase two different articles as if they are one.

---

RESPONSE LOGIC — FOLLOW THIS DECISION TREE:
- If the question is "what do I need" / "what are the steps" / "how do I…": → Use a numbered list of requirements or steps.
- If the question is "is it legal" / "can I…" / "am I allowed to…": → State the legal position clearly, then cite the law.
- If the question involves a penalty or crime: → State the act, the applicable law, and the penalty range.
- If the question involves a contract or civil matter: → State the relevant civil/OHADA rule and any formality requirements.
- If multiple laws conflict or overlap: → Explain the difference clearly and state which one applies in this situation.

---

LANGUAGE & TONE:
- Use simple, everyday language. Write short paragraphs — maximum 3 sentences each.
- Avoid legal jargon. If a legal term must be used, define it immediately in plain language.
- Be warm and reassuring — many users may be stressed or intimidated.

---

REQUIRED OUTPUT FORMAT:

**Summary**
[One to two sentences giving the direct answer in plain language.]

**Legal Basis**
- Article/Section [X] of [Full Law Name]: [One sentence explaining what this article says in simple terms.]
- Article/Section [Y] of [Full Law Name] (if applicable): [One sentence explanation.]

**What This Means for You**
[Two to four sentences explaining the practical implication for the user's specific situation.]

**Key Difference** *(only if two or more laws apply)*
[Explain in one to three sentences what each law covers and how they differ.]

**Penalty or Consequence** *(only if mentioned in the context)*
[State the penalty range or legal consequence clearly.]

**Important Notice**
This response is for informational purposes only and does not constitute legal advice. For proper legal assistance tailored to your situation, please consult a qualified Cameroonian lawyer.

---

Context (verified legal sources only):
${context}

User Question:
${query}

Answer:
`;

        const response = await this.performanceTracker.track(
          'openai_chat_completion',
          async () =>
            this.openai.chat.completions.create({
              model: 'gpt-4.1-mini',
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.3,
              max_tokens: 500,
            }),
        );

        const originalAnswer =
          response.choices?.[0]?.message?.content?.trim() || '';

        const fallback = `Sorry, I couldn't find a clear legal answer for your question.

NB: This response is provided for informational purposes only and does not constitute legal advice.
For proper legal assistance, please consult a qualified lawyer via the contact details in our bio.`;

        const isUsableAnswer =
          originalAnswer.length > 0 &&
          !originalAnswer.toLowerCase().includes('generally applies') &&
          !originalAnswer
            .toLowerCase()
            .includes('not in the provided context') &&
          !originalAnswer.toLowerCase().includes('in general');

        if (isUsableAnswer) {
          answer = originalAnswer;
          this.llmCacheService.set(cacheKey, originalAnswer);
        } else {
          answer = fallback;
        }
      }

      return {
        answer,
        citations,
        citedArticles: unique.map((a) => ({
          id: a.id,
          lawName: a.lawName,
          articleNumber: a.articleNumber,
        })),
        toolsUsed: ['semantic_search', 'keyword_search'],
        relatedArticles: [],
      };
    });
  }

  private deriveLawNameFromArticleQuery(
    query: string,
    articleNumber: string,
  ): string | null {
    const escapedArticleNumber = this.escapeRegExp(articleNumber);
    const articlePattern = `\\b(?:article|art\\.?)\\s*${escapedArticleNumber}\\b`;
    const lawNames = [
      'Cameroonian Civil Code',
      'Civil Code',
      'Cameroon Criminal Procedure Code',
      'Criminal Procedure Code',
      'Cameroon Labour Code',
      'Labour Code',
      'Cameroonian Penal Code',
      'Penal Code',
      'OHADA Uniform Act on General Commercial Law',
      'General Commercial Law',
      'OHADA Uniform Act on Simplified Recovery Procedures and Enforcement Measures',
      'Simplified Recovery Procedures and Enforcement Measures',
      'OHADA Uniform Act on Cooperative Societies',
      'Cooperative Societies',
      'Civil Registration System Law',
      'Constitution of Cameroon',
      'Law Relating to Cybersecurity and Cybercriminality',
    ];

    for (const lawName of lawNames) {
      const escapedLawName = this.escapeRegExp(lawName);
      const withOptionalThe = `(?:the\\s+)?${escapedLawName}`;

      if (
        new RegExp(`${escapedLawName}.*${articlePattern}`, 'i').test(query) ||
        new RegExp(
          `${articlePattern}.*\\b(?:of|under|pursuant\\s+to)\\s+${withOptionalThe}\\b`,
          'i',
        ).test(query)
      ) {
        return lawName;
      }
    }

    return null;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Extract topic from query for conversation tracking
   */
  private extractTopic(query: string): string {
    const q = query.toLowerCase();

    const topics: Record<string, string[]> = {
      'property law': [
        'property',
        'land',
        'rent',
        'lease',
        'tenant',
        'landlord',
      ],
      'criminal law': [
        'crime',
        'criminal',
        'arrest',
        'warrant',
        'police',
        'court',
      ],
      'contract law': ['contract', 'agreement', 'sign', 'breach', 'offer'],
      'employment law': ['job', 'work', 'employ', 'salary', 'worker', 'boss'],
      'family law': ['marriage', 'divorce', 'child', 'custody', 'alimony'],
      'business law': ['company', 'business', 'corporation', 'startup'],
    };

    for (const [topic, keywords] of Object.entries(topics)) {
      if (keywords.some((k) => q.includes(k))) {
        return topic;
      }
    }

    return 'general legal inquiry';
  }

  /**
   * Get language-specific instructions for the LLM
   */
  private getLanguageInstructions(language?: string): string {
    switch (language) {
      case 'french':
        return `LANGUAGE INSTRUCTIONS:
- Respond ONLY in French.
- Use formal "vous" form unless the user used informal "tu" form.
- Keep sentences simple and clear for non-lawyers.`;

      case 'pidgin':
        return `LANGUAGE INSTRUCTIONS:
- Respond in Nigerian/Cameroonian Pidgin English.
- Use colloquial but respectful tone.
- Mix English and Pidgin naturally (code-switching is fine).
- Keep it friendly and accessible.`;

      case 'spanish':
        return `LANGUAGE INSTRUCTIONS:
- Respond ONLY in Spanish.
- Use neutral Spanish that works across Spanish-speaking regions.
- Keep sentences simple and clear for non-lawyers.`;

      case 'portuguese':
        return `LANGUAGE INSTRUCTIONS:
- Respond ONLY in Portuguese.
- Use neutral Portuguese that works across Portuguese-speaking regions.
- Keep sentences simple and clear for non-lawyers.`;

      default:
        return `LANGUAGE INSTRUCTIONS:
- Respond in clear, simple English.
- Use everyday language that non-lawyers can understand.
- Keep sentences short and direct.`;
    }
  }
}
