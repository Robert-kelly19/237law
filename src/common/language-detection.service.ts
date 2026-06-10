import { Injectable, Logger } from '@nestjs/common';

export type DetectedLanguage = 'english' | 'french' | 'pidgin' | 'unknown';

@Injectable()
export class LanguageDetectionService {
  private readonly logger = new Logger(LanguageDetectionService.name);

  /**
   * Common greeting patterns for different languages
   */
  private readonly greetingPatterns: Record<DetectedLanguage, RegExp> = {
    english:
      /\b(hi|hello|hey|greetings|good\s+(morning|afternoon|evening|night)|what\'s\s+up|sup|howdy)\b/i,
    french: /\b(bonjour|bonsoir|salut|ça\s+va|allô|coucou|hé)\b/i,
    pidgin:
      /\b(howdy|wey\s+dey|hello|hey|alright|how\s+body|washer|how\s+na|wha\s+\w+|abi|innit)\b/i,
    unknown: /(?!)/,
  };

  /**
   * Language-specific word patterns
   */
  private readonly languageIndicators: Record<DetectedLanguage, RegExp> = {
    english:
      /\b(hi|hello|hey|greetings|good\s+(morning|afternoon|evening|night)|what\'s\s+up|sup|howdy)\b/i,
    french:
      /\b(le|la|les|un|une|des|et|est|sont|je|tu|il|elle|nous|vous|ils|elles|qui|que|quoi|où|quand|pourquoi|comment|s'il\s+vous\s+plaît|merci|oui|non)\b/i,
    pidgin:
      /\b(dey|wey|no\s+be|abi|eh|innit|masa|sef|o|o\s+lord|aunty|bro|fam|bruv|mandem|wallahi|alhamdulillah|walloh)\b/i,
    unknown: /(?!)/,
  };

  detect(text: string): DetectedLanguage {
    if (!text || text.trim().length === 0) {
      return 'unknown';
    }

    const normalizedText = text.toLowerCase();
    const scores: Record<DetectedLanguage, number> = {
      english: 0,
      french: 0,
      pidgin: 0,
      unknown: 0,
    };

    // Score each language
    for (const [lang, pattern] of Object.entries(this.languageIndicators)) {
      const matches = (normalizedText.match(pattern) || []).length;
      scores[lang as DetectedLanguage] = matches;
    }

    // Find language with highest score
    let detectedLanguage: DetectedLanguage = 'unknown';
    let maxScore = 0;

    for (const [lang, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        detectedLanguage = lang as DetectedLanguage;
      }
    }

    this.logger.debug(
      `Language detection scores: ${JSON.stringify(scores)}, Detected: ${detectedLanguage}`,
    );

    return detectedLanguage;
  }

  /**
   * Check if the text is a greeting
   */
  isGreeting(text: string): boolean {
    const normalizedText = text.toLowerCase().trim();

    // Check all greeting patterns
    for (const pattern of Object.values(this.greetingPatterns)) {
      if (pattern.test(normalizedText)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect greeting language specifically
   */
  detectGreetingLanguage(text: string): DetectedLanguage {
    if (!text || text.trim().length === 0) {
      return 'unknown';
    }

    const normalizedText = text.toLowerCase();
    const scores: Record<DetectedLanguage, number> = {
      english: 0,
      french: 0,
      pidgin: 0,
      unknown: 0,
    };

    for (const [lang, pattern] of Object.entries(this.greetingPatterns)) {
      const matches = (normalizedText.match(pattern) || []).length;
      scores[lang as DetectedLanguage] = matches;
    }

    let detectedLanguage: DetectedLanguage = 'unknown';
    let maxScore = 0;

    for (const [lang, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        detectedLanguage = lang as DetectedLanguage;
      }
    }

    if (maxScore === 0) {
      return this.detect(text);
    }

    return detectedLanguage;
  }

  /**
   * Check if text is a question
   */
  private isQuestion(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.endsWith('?')) {
      return true;
    }

    const questionPatterns = [
      /\b(what|when|where|who|why|how|which|can|could|should|would|is|are|do|does|did|will)\b/i,
    ];

    const firstWord = trimmed.split(/\s+/)[0];
    return questionPatterns.some((pattern) => pattern.test(firstWord || ''));
  }

  /**
   * Check if text is a greeting ONLY (no substantial content after greeting)
   * Returns true only for pure greetings like "hello", "hey", "hi there"
   * Updated: stricter check requiring ≤5 words conversation-wide with no legal keywords
   */
  isGreetingOnly(text: string): boolean {
    if (!this.isGreeting(text)) {
      return false;
    }

    const wordCount = text.trim().split(/\s+/).length;
    const hasLegalKeyword = this.hasLegalIntent(text);

    return wordCount <= 5 && !hasLegalKeyword;
  }

  /**
   * Check if text contains both a greeting and a legal question/intent
   * Example: "Hey, I need help with contract law"
   */
  isGreetingWithQuestion(text: string): boolean {
    if (!this.isGreeting(text)) {
      return false;
    }

    return this.hasLegalIntent(text);
  }

  /**
   * Categorize the intent type of a message
   */
  detectIntentType(
    text: string,
  ): 'greeting_only' | 'question_only' | 'greeting_with_question' | 'other' {
    if (this.isGreetingOnly(text)) {
      return 'greeting_only';
    }

    if (this.isGreeting(text) && this.hasLegalIntent(text)) {
      return 'greeting_with_question';
    }

    if (this.hasLegalIntent(text) || this.isQuestion(text)) {
      return 'question_only';
    }

    return 'other';
  }

  /**
   * Check if text contains legal intent keywords and question patterns
   * Returns true if the text seems to be asking for legal help
   */
  hasLegalIntent(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Legal domain keywords
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
    ];

    // Question/help request patterns
    const intentPatterns = [
      /\b(help|assist|advice|guide|explain|understand|question|ask|about|regarding|concern|issue|problem)\b/i,
      /\b(can\s+(i|you|we)|could|should|would|how|what|when|where|why|which)\b/i,
      /\b(need|want|require|looking for|searching for)\b/i,
    ];

    // Check if any legal keywords are present
    const hasLegalKeyword = legalKeywords.some((keyword) =>
      lowerText.includes(keyword),
    );

    // Check if any intent patterns match
    const hasIntentPattern = intentPatterns.some((pattern) =>
      pattern.test(text),
    );

    return hasLegalKeyword || hasIntentPattern;
  }

  /**
   * Detect if text is primarily legal in nature (without greeting)
   */
  isLegalQuery(text: string): boolean {
    return this.hasLegalIntent(text) && !this.isGreetingOnly(text);
  }
}
