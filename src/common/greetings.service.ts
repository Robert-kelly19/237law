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
  private readonly greetingsByLanguage: Record<DetectedLanguage, GreetingSet> = {
    english: {
      greetings: [
        'Hey there! 👋 How can I help you with legal matters today?',
        'Hello! Welcome. What legal question do you have?',
        'Hi! 😊 I\'m here to assist with your legal concerns.',
        'Greetings! How can I assist you?',
        'Hey! What can I help you with?',
        'Good to see you! What legal question do you have?',
        'Hello there! Ready to help. What do you need?',
        'Hi! 👋 Let\'s help you find legal answers.',
      ],
      casual: [
        'Yo! What\'s up? How can I help?',
        'Hey buddy! What can I do for you?',
        'What\'s good? Let\'s solve this legal issue!',
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
        'Bonjour! 👋 Comment puis-je vous aider avec vos questions juridiques?',
        'Salut! Bienvenue. Quelle question juridique avez-vous?',
        'Bonsoir! 😊 Je suis là pour vous aider avec vos préoccupations juridiques.',
        'Coucou! Comment puis-je vous assister?',
        'Hé! Qu\'est-ce que je peux faire pour vous?',
        'Bonjour! Prêt à aider. De quoi avez-vous besoin?',
        'Allô! 👋 Trouvons ensemble des réponses juridiques.',
        'Ça va? Comment je peux vous aider?',
      ],
      casual: [
        'Yo! Ça va? Comment je peux t\'aider?',
        'Hey! Qu\'est-ce que tu as pour moi?',
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
        'Hello bro! 😊 I dey here to help with your legal wahala.',
        'Wey dey! How I go assist you?',
        'Hey! Wetin you need from me?',
        'Good day! Ready I dey. Wetin you want?',
        'Hello fam! 👋 Make we find legal answers together.',
        'How body? Wetin na your legal question?',
      ],
      casual: [
        'Yo bruh! Wetin dey happen? How I fit help?',
        'Hey my guy! Wetin you get for me?',
        'Alright na! Let\'s settle this legal issue quick!',
        'Wetin up! What legal matter you come with?',
      ],
      formal: [
        'Good morning sir/madam. How can I assist you with legal matters?',
        'Greetings. I am prepared to help with your legal questions.',
        'Good afternoon. What legal assistance do you require?',
      ],
    },
    spanish: {
      greetings: [
        '¡Hola! 👋 ¿Cómo puedo ayudarte con tus preguntas legales?',
        '¡Buenos días! Bienvenido. ¿Cuál es tu pregunta legal?',
        '¡Holi! 😊 Estoy aquí para ayudarte con tus preocupaciones legales.',
        '¡Hey! ¿Cómo te puedo asistir?',
        '¿Qué tal? ¿Qué necesitas de mí?',
        '¡Buenos días! Listo para ayudar. ¿Qué necesitas?',
        '¡Hola! 👋 Encontremos respuestas legales juntos.',
        '¿Cómo estás? ¿Cuál es tu pregunta legal?',
      ],
      casual: [
        '¡Ey! ¿Qué pasa? ¿Cómo te ayudo?',
        '¡Oye! ¿Qué tienes para mí?',
        '¡Dale! ¡Resolvamos este asunto legal!',
        '¡Qué onda! ¿Cuál pregunta legal tienes?',
      ],
      formal: [
        'Buenos días. ¿Cómo puedo asistirle con sus preguntas legales?',
        'Cordial saludo. Estoy a su servicio para asuntos legales.',
        'Buenas tardes. ¿Qué asistencia legal necesita?',
      ],
    },
    portuguese: {
      greetings: [
        'Oi! 👋 Como posso ajudá-lo com suas dúvidas legais?',
        'Olá! Bem-vindo. Qual é sua pergunta legal?',
        'Opa! 😊 Estou aqui para ajudar com suas preocupações legais.',
        'Ei! Como posso assisti-lo?',
        'Tudo bem? O que você precisa de mim?',
        'Bom dia! Pronto para ajudar. O que você precisa?',
        'Olá! 👋 Vamos encontrar respostas legais juntas.',
        'Como vai? Qual é sua pergunta legal?',
      ],
      casual: [
        'Ê! E aí? Como te ajudo?',
        'Oye! O que você tem pra mim?',
        'Vamo lá! Vamos resolver esse assunto legal!',
        'E aí! Qual pergunta legal você tem?',
      ],
      formal: [
        'Bom dia. Como posso assisti-lo com suas dúvidas legais?',
        'Cumprimentos. Estou ao seu serviço para assuntos legais.',
        'Boa tarde. Que assistência legal você necessita?',
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
  private userGreetingHistory: Map<string, Set<number>> = new Map();

  /**
   * Get a random greeting for the detected language
   * Ensures variety by avoiding recently used greetings
   */
  getGreeting(language: DetectedLanguage, userId?: string): string {
    const greetingSet = this.greetingsByLanguage[language] || this.greetingsByLanguage.english;
    const greetings = greetingSet.greetings;

    if (!greetings || greetings.length === 0) {
      return 'Hello! How can I help you?';
    }

    let selectedIndex: number;

    if (userId) {
      // Track history per user to avoid repetition
      const history = this.userGreetingHistory.get(userId) || new Set();
      const availableIndices = Array.from({ length: greetings.length }, (_, i) => i).filter(
        (i) => !history.has(i),
      );

      if (availableIndices.length === 0) {
        // Reset history when all greetings have been used
        history.clear();
        this.userGreetingHistory.set(userId, history);
      }

      // Pick from available indices
      const validIndices = availableIndices.length > 0 ? availableIndices : Array.from({ length: greetings.length }, (_, i) => i);
      selectedIndex = validIndices[Math.floor(Math.random() * validIndices.length)];

      // Update history
      history.add(selectedIndex);
      if (history.size > Math.ceil(greetings.length / 2)) {
        // Keep only recent half of history to allow some repetition after variety
        const historyArray = Array.from(history);
        history.clear();
        historyArray.slice(-Math.ceil(greetings.length / 2)).forEach((i) => history.add(i));
      }
      this.userGreetingHistory.set(userId, history);
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
