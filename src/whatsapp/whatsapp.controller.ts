import {
  Controller,
  Post,
  Body,
  Query,
  Res,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { RagService } from '../rag.service';
import { LegalAgentService } from '../agents/legal.agent';
import { ConversationService } from '../memory/conversation.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private whatsappService: WhatsappService,
    private ragService: RagService,
    private legalAgent: LegalAgentService,
    private conversationService: ConversationService,
  ) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      this.logger.log('Webhook verified successfully');
      res.status(HttpStatus.OK).send(challenge);
    } else {
      this.logger.warn('Webhook verification failed');
      res.sendStatus(HttpStatus.FORBIDDEN);
    }
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveMessage(@Body() body: any) {
    this.logger.log(`Incoming webhook`);

    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value;

        if (!value?.messages) continue;

        for (const message of value.messages) {
          const userId = message.from; // WhatsApp phone number as user ID
          const text = message.text?.body;

          if (!text) continue;

          try {
            // Get or create session for this user
            const sessionId = await this.conversationService.getOrCreateSession(
              userId,
            );

            this.logger.debug(
              `Processing message from ${userId} in session ${sessionId}`,
            );

            // Use the intelligent agent for processing
            const response = await this.legalAgent.processQuery({
              userId,
              sessionId,
              query: text,
            });

            // Format the response for WhatsApp
            const formattedResponse = this.formatAgentResponse(response);

            this.logger.log(
              `Generated response for ${userId}: ${formattedResponse.substring(0, 100)}...`,
            );
            await this.whatsappService.send(userId, formattedResponse);
          } catch (err:any) {
            this.logger.error(
              `Error processing message: ${err.message}`,
              err.stack,
            );
            await this.whatsappService.send(
              userId,
              'Sorry, I encountered an error processing your question. Please try again later.',
            );
          }
        }
      }
    }

    return { status: 'EVENT_RECEIVED' };
  }

  /**
   * Format the agent response for WhatsApp (with character limit consideration)
   */
  private formatAgentResponse(response: any): string {
    const maxLength = 4096; // WhatsApp message limit

    let formattedResponse = response.answer;

    // Add citations if available
    if (response.citations && response.citations.length > 0) {
      formattedResponse += '\n\n*References:*\n';
      response.citations.forEach((citation: string, index: number) => {
        formattedResponse += `${index + 1}. ${citation}\n`;
      });
    }

    // Add related articles if available
    if (response.relatedArticles && response.relatedArticles.length > 0) {
      formattedResponse += '\n*Related provisions:*\n';
      response.relatedArticles.slice(0, 3).forEach((article: any) => {
        formattedResponse += `- ${article.lawName}, Article ${article.articleNumber}\n`;
      });
    }

    // Add confidence indicator
    if (response.reasoning) {
      const confidence = Math.round(response.reasoning.confidence * 100);
      formattedResponse += `\n_Confidence: ${confidence}%_`;
    }

    // Truncate if too long
    if (formattedResponse.length > maxLength) {
      formattedResponse = formattedResponse.substring(0, maxLength - 3) + '...';
    }

    return formattedResponse;
  }
}