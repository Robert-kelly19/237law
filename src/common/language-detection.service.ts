import { Injectable, Logger } from '@nestjs/common';

export type DetectedLanguage = 
  | 'english'
  | 'french'
  | 'pidgin'
  | 'unknown';

@Injectable()
export class LanguageDetectionService {
  private readonly logger = new Logger(LanguageDetectionService.name);

  /**
   * Common greeting patterns for different languages
   */
  private readonly greetingPatterns: Record<DetectedLanguage, RegExp> = {
    english: /\b(hi|hello|hey|greetings|good\s+(morning|afternoon|evening|night)|what\'s\s+up|sup|howdy)\b/i,
    french: /\b(bonjour|bonsoir|salut|ça\s+va|allô|coucou|hé)\b/i,
    pidgin: /\b(howdy|wey\s+dey|hello|hey|alright|how\s+body|washer|how\s+na|wha\s+\w+|abi|innit)\b/i,
    unknown: /(?!)/,
  };

  /**
   * Language-specific word patterns
   */
  private readonly languageIndicators: Record<DetectedLanguage, RegExp> = {
    english: /\b(the|is|are|have|has|do|does|what|how|where|when|why|can|will|would|should|could|please|thanks|thank|you|me|i)\b/i,
    french: /\b(le|la|les|un|une|des|et|est|sont|je|tu|il|elle|nous|vous|ils|elles|qui|que|quoi|où|quand|pourquoi|comment|s\'il\s+vous\s+plaît|merci|oui|non)\b/i,
    pidgin: /\b(dey|wey|no\s+be|abi|eh|innit|masa|sef|o|o\s+lord|aunty|bro|fam|bruv|mandem|wallahi|alhamdulillah|walloh)\b/i,
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
    const scores: Record<DetectedLanguage, number> = { english: 0, french: 0, pidgin: 0, unknown: 0 };

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
}
