import { Injectable, Logger } from '@nestjs/common';
import { LawSearchTool } from './tools/law-search.tool';
import { CitationTool } from './tools/citation.tool';
import { ContextTool } from './tools/context.tool';
import { MemoryService } from '../memory/memory.service';
import { ConversationService } from '../memory/conversation.service';
import { PerformanceTrackerService } from '../performance/performance-tracker.service';
import {
  LLMResponseCacheService,
  LLMSynthesisCacheValue,
} from '../cache/llm-response-cache.service';
import { LanguageDetectionService } from '../common/language-detection.service';
import { GreetingsService } from '../common/greetings.service';
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

type SynthesisResult = LLMSynthesisCacheValue;

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

            const followUpGreeting =
              this.greetingsService.getFollowUpGreeting(detectedLanguage);

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
            this.logger.debug(
              `First greeting detected, returning: ${greeting}`,
            );

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
        if (this.languageDetection.isGreeting(query.query) && hasLegalIntent) {
          this.logger.debug(
            `Greeting with legal intent detected, proceeding to legal processing`,
          );
          // Continue to legal processing below
        }

        const earlyCachedResult = this.getCachedAnswer(query.query);
        if (earlyCachedResult) {
          this.logger.debug(
            `LLM response cache hit before retrieval for query: ${query.query.substring(0, 50)}...`,
          );

          return {
            answer: earlyCachedResult.answer,
            citations: earlyCachedResult.citations,
            reasoning: {
              confidence: 1.0,
              toolsUsed: ['answer_cache'],
              steps: [
                {
                  step: 2,
                  action: 'answer_cache_hit',
                  input: query.query,
                  output: 'cached_answer',
                  confidence: 1.0,
                },
              ],
            },
            relatedArticles: earlyCachedResult.relatedArticles,
          };
        }

        const lowValueResponse = this.getLowValueQueryResponse(
          query.query,
          detectedLanguage,
        );
        if (lowValueResponse) {
          return {
            answer: lowValueResponse,
            citations: [],
            reasoning: {
              confidence: 1.0,
              toolsUsed: ['low_value_query_guard'],
              steps: [
                {
                  step: 2,
                  action: 'skip_openai_for_low_value_query',
                  input: query.query,
                  output: lowValueResponse,
                  confidence: 1.0,
                },
              ],
            },
            relatedArticles: [],
          };
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
        const context = await this.performanceTracker.track(
          'buildContextSummary',
          async () =>
            this.contextTool.buildContextSummary(query.userId, sessionId),
        );

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
   * Keyword-first tool planning to avoid unnecessary OpenAI embedding calls.
   */
  private planToolUsage(): {
    tools: string[];
    sequence: string;
  } {
    const tools = ['search_keyword', 'search_semantic_fallback'];

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
      if (toolPlan.tools.includes('search_keyword')) {
        const keywordRes = await this.lawSearchTool.searchByKeyword(query, 3);

        if (keywordRes.success) {
          results.searchResults = keywordRes.data;
        }
      }

      // Semantic search uses OpenAI embeddings, so only use it when keyword
      // search found nothing useful.
      if (
        results.searchResults.length === 0 &&
        toolPlan.tools.includes('search_semantic_fallback')
      ) {
        const res = await this.lawSearchTool.searchByTopic(query, 3);

        if (res.success) {
          results.semanticResults = res.data;
        }
      }

      results.overallConfidence =
        results.searchResults.length > 0
          ? 0.75
          : results.semanticResults.length > 0
            ? 0.9
            : 0.3;
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
  ): Promise<SynthesisResult> {
    return this.performanceTracker.track('rag_synthesis_with_llm', async () => {
      const unique = this.dedupeArticles([
        ...toolResults.searchResults,
        ...toolResults.semanticResults,
      ]).slice(0, 3);

      const citations = unique.map((a) =>
        this.citationTool.generateInlineCitation(a),
      );

      // Check LLM response cache
      const cacheKey = this.getAnswerCacheKey(query);
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
        return cachedResponse;
      } else {
        const context = unique
          .map(
            (s) =>
              `${s.lawName} - Article ${s.articleNumber}:\n${this.truncateForPrompt(s.content, 1200)}`,
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

CORE RULES — NEVER VIOLATE THESE:
1. NEVER invent, fabricate, or paraphrase laws. Only cite laws explicitly found in the provided context.
2. NEVER use internal identifiers such as "chunk-*", "doc-*", or any database IDs.
3. NEVER start your response with "Yes" or "No" unless the question is a direct yes/no question (e.g., "Is it legal to…?").
4. If the context contains NO relevant legal provision, respond EXACTLY with: "No clear legal provision was found in the available laws for this question. Please consult a qualified Cameroonian lawyer."
5. Do NOT speculate or fill gaps with general legal knowledge when the context is silent.

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

        try {
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

          answer = response.choices?.[0]?.message?.content?.trim() || '';
        } catch (error: any) {
          this.logger.error(
            `OpenAI answer generation failed, using retrieved law fallback: ${error.message}`,
            error.stack,
          );
          answer = this.buildRetrievedLawFallbackAnswer(unique);
        }

        if (!answer) {
          answer = `Sorry, I couldn't find a clear legal answer for your question.

NB: This response is provided for informational purposes only and does not constitute legal advice.
For proper legal assistance, please consult a qualified lawyer via the contact details in our bio.`;
        }
      }

      const synthesis = {
        answer,
        citations,
        citedArticles: unique.map((a) => ({
          id: a.id,
          lawName: a.lawName,
          articleNumber: a.articleNumber,
        })),
        toolsUsed:
          toolResults.searchResults.length > 0
            ? ['keyword_search']
            : ['semantic_search'],
        relatedArticles: [],
      };

      if (unique.length > 0) {
        this.llmCacheService.set(cacheKey, synthesis);
      }

      return synthesis;
    });
  }

  private getAnswerCacheKey(query: string): string {
    return this.llmCacheService.generateKey(this.normalizeQuery(query), [
      'legal_answer_v2',
    ]);
  }

  private getCachedAnswer(query: string): SynthesisResult | null {
    return this.llmCacheService.get(this.getAnswerCacheKey(query));
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private getLowValueQueryResponse(
    query: string,
    detectedLanguage?: string,
  ): string | null {
    const normalized = this.normalizeQuery(query).replace(/[?.!,]+$/g, '');
    const words = normalized.split(/\s+/).filter(Boolean);
    const lowValueMessages = new Set([
      'ok',
      'okay',
      'yes',
      'no',
      'thanks',
      'thank you',
      'cool',
      'fine',
      'alright',
      'good',
      'hmm',
      'lol',
    ]);

    if (lowValueMessages.has(normalized)) {
      return this.getClarifyingLegalQuestionPrompt(detectedLanguage);
    }

    if (
      words.length <= 2 &&
      !this.hasLegalKeyword(normalized) &&
      !this.languageDetection.hasLegalIntent(query)
    ) {
      return this.getClarifyingLegalQuestionPrompt(detectedLanguage);
    }

    return null;
  }

  private getClarifyingLegalQuestionPrompt(language?: string): string {
    switch (language) {
      case 'french':
        return 'Veuillez poser une question juridique précise sur le droit camerounais afin que je puisse vous aider.';
      case 'pidgin':
        return 'Abeg ask one clear legal question about Cameroon law so I fit help you well.';
      default:
        return 'Please ask a clear legal question about Cameroonian law so I can help you.';
    }
  }

  private hasLegalKeyword(query: string): boolean {
    const legalKeywords = [
      'law',
      'legal',
      'court',
      'judge',
      'arrest',
      'lawsuit',
      'sue',
      'contract',
      'rights',
      'police',
      'warrant',
      'bail',
      'charge',
      'guilty',
      'innocent',
      'attorney',
      'lawyer',
      'case',
      'trial',
      'verdict',
      'sentence',
      'crime',
      'criminal',
      'civil',
      'property',
      'inheritance',
      'divorce',
      'custody',
      'harassment',
      'assault',
      'theft',
      'fraud',
      'liability',
      'rent',
      'tenant',
      'landlord',
      'marriage',
      'employment',
      'salary',
    ];

    return legalKeywords.some((keyword) => query.includes(keyword));
  }

  private dedupeArticles(articles: LawArticle[]): LawArticle[] {
    const seen = new Set<string>();
    return articles.filter((article) => {
      const key = article.id || `${article.lawName}:${article.articleNumber}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private truncateForPrompt(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    return `${content.slice(0, maxLength).trim()}...`;
  }

  private buildRetrievedLawFallbackAnswer(articles: LawArticle[]): string {
    const legalBasis = articles
      .map(
        (article) =>
          `- Article ${article.articleNumber} of ${article.lawName}: ${this.truncateForPrompt(article.content, 500)}`,
      )
      .join('\n');

    return `I found relevant Cameroonian legal provisions, but I could not generate a full AI explanation right now.

**Legal Basis**
${legalBasis}

**Important Notice**
This response is for informational purposes only and does not constitute legal advice. For proper legal assistance tailored to your situation, please consult a qualified Cameroonian lawyer.`;
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
