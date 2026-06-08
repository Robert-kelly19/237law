import { Injectable, Logger } from '@nestjs/common';
import { DetectedLanguage } from './language-detection.service';

interface GreetingSet {
  greetings: string[];
  casual?: string[];
  formal?: string[];
}

@Injectable()
export class GreetingsService {
  private readonly logger = new Logger(GreetingsService.name);

  /**
   * Dynamic greetings that rotate and vary
   */
  private readonly greetingsByLanguage: Record<DetectedLanguage, GreetingSet> =
    {
      english: {
        greetings: [
          'Hey there!  How can I help you with legal matters today?',
          'Hello! Welcome. What legal question do you have?',
          "Hi! I'm here to assist with your legal concerns.",
          'Greetings! How can I assist you?',
          'Hey! What can I help you with?',
          'Good to see you! What legal question do you have?',
          'Hello there! Ready to help. What do you need?',
          "Hi!  Let's help you find legal answers.",
        ],
        casual: [
          "Yo! What's up? How can I help?",
          'Hey buddy! What can I do for you?',
          "What's good? Let's solve this legal issue!",
          'Sup! What legal question do you have for me?',
        ],
        formal: [
          'Good day. How may I assist you with your legal inquiry?',
          'Greetings. I am at your service for legal matters.',
          'Good afternoon. What legal assistance do you require?',
        ],
      },
      french: {
        greetings: [
          'Bonjour!  Comment puis-je vous aider avec vos questions juridiques?',
          'Salut! Bienvenue. Quelle question juridique avez-vous?',
          'Bonsoir!  Je suis là pour vous aider avec vos préoccupations juridiques.',
          'Coucou! Comment puis-je vous assister?',
          "Hé! Qu'est-ce que je peux faire pour vous?",
          'Bonjour! Prêt à aider. De quoi avez-vous besoin?',
          'Allô! Trouvons ensemble des réponses juridiques.',
          'Ça va? Comment je peux vous aider?',
        ],
        casual: [
          "Yo! Ça va? Comment je peux t'aider?",
          "Hey! Qu'est-ce que tu as pour moi?",
          'Quoi de neuf? Résolvons ce problème juridique!',
          'Sup! Quelle question juridique tu as?',
        ],
        formal: [
          'Bonne journée. Comment puis-je vous assister sur vos questions juridiques?',
          'Bonjour monsieur/madame. Je suis à votre service pour les questions juridiques.',
          'Bon après-midi. Quelle assistance juridique nécessitez-vous?',
        ],
      },
      pidgin: {
        greetings: [
          'Howdy! 👋 Wetin be your legal palaver today?',
          'Alright na! Welcome abeg. Which legal question you get?',
          'asehh brother!  I dey here fo helep with your legal palava.',
          'Wey dey! How I go assist you?',
          'Hey! Wetin you need from me?',
          'Good day! Ready I dey. Wetin you want?',
          'Hello fam! Make we find legal answers together.',
          'How body? Wetin be your legal question?',
        ],
        casual: [
          'Yo bruh! Wetin di happen? How I fit helep?',
          'Hey my guy! Wetin you get for me?',
          "Alright nor! Let's settle this legal issue quick!",
          'Wetin dae up! What legal matter you cam with?',
        ],
        formal: [
          'Good morning sir/madam. How can I assist you with legal matters?',
          'Greetings. I am prepared to help with your legal questions.',
          'Good afternoon. What legal assistance do you require?',
        ],
      },
      unknown: {
        greetings: [
          'Hello! How can I help you?',
          'Hi there! What can I do for you?',
          'Greetings! How may I assist?',
        ],
      },
    };

  /**
   * Track greeting usage per user to ensure variety
   */
  private readonly HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

  private userGreetingHistory: Map<
    string,
    { history: Set<number>; lastUsed: number }
  > = new Map();

  constructor() {
    this.startCleanupTask();
  }

  private startCleanupTask(): void {
    setInterval(
      () => {
        this.cleanupStaleHistory();
      },
      60 * 60 * 1000,
    );
  }

  private cleanupStaleHistory(): void {
    const now = Date.now();
    for (const [userId, entry] of this.userGreetingHistory.entries()) {
      if (now - entry.lastUsed > this.HISTORY_TTL_MS) {
        this.userGreetingHistory.delete(userId);
      }
    }
  }

  /**
   * Get a random greeting for the detected language
   * Ensures variety by avoiding recently used greetings
   */
  getGreeting(language: DetectedLanguage, userId?: string): string {
    const greetingSet =
      this.greetingsByLanguage[language] || this.greetingsByLanguage.english;
    const greetings = greetingSet.greetings;

    if (!greetings || greetings.length === 0) {
      return 'Hello! How can I help you?';
    }

    let selectedIndex: number;

    if (userId) {
      // Track history per user to avoid repetition
      const entry = this.userGreetingHistory.get(userId) || {
        history: new Set<number>(),
        lastUsed: 0,
      };
      const history = entry.history;
      const availableIndices = Array.from(
        { length: greetings.length },
        (_, i) => i,
      ).filter((i) => !history.has(i));

      if (availableIndices.length === 0) {
        history.clear();
      }

      const validIndices =
        availableIndices.length > 0
          ? availableIndices
          : Array.from({ length: greetings.length }, (_, i) => i);
      selectedIndex =
        validIndices[Math.floor(Math.random() * validIndices.length)];

      history.add(selectedIndex);
      if (history.size > Math.ceil(greetings.length / 2)) {
        const historyArray = Array.from(history);
        history.clear();
        historyArray
          .slice(-Math.ceil(greetings.length / 2))
          .forEach((i) => history.add(i));
      }

      this.userGreetingHistory.set(userId, { history, lastUsed: Date.now() });
    } else {
      // Random selection without tracking
      selectedIndex = Math.floor(Math.random() * greetings.length);
    }

    const greeting = greetings[selectedIndex];
    this.logger.debug(
      `Selected greeting for ${language}${userId ? ` (user: ${userId})` : ''}: index ${selectedIndex}`,
    );

    return greeting;
  }

  /**
   * Get a casual greeting for the detected language
   */
  getCasualGreeting(language: DetectedLanguage, userId?: string): string {
    const greetingSet = this.greetingsByLanguage[language];
    const casual = greetingSet?.casual;

    if (!casual || casual.length === 0) {
      return this.getGreeting(language, userId);
    }

    const selectedIndex = Math.floor(Math.random() * casual.length);
    return casual[selectedIndex];
  }

  /**
   * Get a formal greeting for the detected language
   */
  getFormalGreeting(language: DetectedLanguage, userId?: string): string {
    const greetingSet = this.greetingsByLanguage[language];
    const formal = greetingSet?.formal;

    if (!formal || formal.length === 0) {
      return this.getGreeting(language, userId);
    }

    const selectedIndex = Math.floor(Math.random() * formal.length);
    return formal[selectedIndex];
  }

  /**
   * Clear greeting history for a user (useful for testing or manual reset)
   */
  clearUserHistory(userId: string): void {
    this.userGreetingHistory.delete(userId);
  }
}
