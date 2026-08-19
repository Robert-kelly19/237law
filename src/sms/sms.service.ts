import {
  Injectable,
  Logger,
  BadGatewayException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import {
  LegalAgentService,
  AgentQuery,
  AgentResponse,
} from '../agents/legal.agent';

import { ConversationService } from '../memory/conversation.service';
import { LanguageDetectionService } from '../common/language-detection.service';

interface MtnTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface MtnOutboundSmsResponse {
  statusCode: string;
  statusMessage: string;
  transactionId: string;
  data: {
    status: string;
  };
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  private cachedToken: {
    access_token: string;
    expiry: number;
  } | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly legalAgent: LegalAgentService,
    private readonly conversationService: ConversationService,
    private readonly languageDetection: LanguageDetectionService,
  ) {}

  /**
   * Receives an incoming SMS,
   * sends it through the legal AI agent,
   * then sends the AI response back through MTN.
   */
  async processIncomingSms(
    phoneNumber: string,
    messageText: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `Processing SMS from ${phoneNumber}: "${messageText.substring(
          0,
          50,
        )}${messageText.length > 50 ? '...' : ''}"`,
      );

      
      const sessionId =
        await this.conversationService.getOrCreateSession(phoneNumber);

      // Create the same query structure used by WhatsApp
      const agentQuery: AgentQuery = {
        userId: phoneNumber,
        sessionId,
        query: messageText,
      };

      // Send message to legal AI agent
      const agentResponse: AgentResponse =
        await this.legalAgent.processQuery(agentQuery);

      this.logger.log(
        `Generated response for ${phoneNumber}: "${agentResponse.answer.substring(
          0,
          100,
        )}${agentResponse.answer.length > 100 ? '...' : ''}"`,
      );

      // Send AI response back through MTN
      await this.sendMtnSms(
        phoneNumber,
        agentResponse.answer,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process SMS from ${phoneNumber}`,
        error,
      );

      // Try to notify the user if something goes wrong
      try {
        await this.sendMtnSms(
          phoneNumber,
          'Sorry, an error occurred while processing your message. Please try again later.',
        );
      } catch (sendError) {
        this.logger.error(
          `Failed to send error SMS to ${phoneNumber}`,
          sendError,
        );
      }
    }
  }

  /**
   * Sends an SMS using the MTN SMS v3 API.
   */
  private async sendMtnSms(
    phoneNumber: string,
    message: string,
  ): Promise<void> {
    try {
      const accessToken = await this.getMtnAccessToken();

      const serviceCode =
        this.configService.get<string>('MTN_SERVICE_CODE');

      const senderAddress =
        this.configService.get<string>('MTN_SENDER_ADDRESS');

      if (!serviceCode) {
        throw new Error(
          'MTN_SERVICE_CODE is not configured',
        );
      }

      
      const smsPayload = {
        ...(senderAddress && {
          senderAddress,
        }),

        receiverAddress: [
          this.formatPhoneNumber(phoneNumber),
        ],

        message,

        clientCorrelatorId: this.generateClientCorrelatorId(),

        serviceCode,

        requestDeliveryReceipt: false,
      };

      this.logger.debug(
        `Sending SMS payload: ${JSON.stringify(smsPayload)}`,
      );

      const { data } =
        await this.httpService.axiosRef.post<MtnOutboundSmsResponse>(
          '/messages/sms/outbound',
          smsPayload,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 10000,
          },
        );

      this.logger.log(
        `MTN SMS accepted. Transaction ID: ${data.transactionId}, Status: ${data.data?.status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send MTN SMS to ${phoneNumber}`,
        error,
      );

      throw new BadGatewayException(
        'MTN SMS service unavailable',
      );
    }
  }

  /**
   * Gets an OAuth2 access token from MTN.
   *
   * The endpoint comes directly from the YAML:
   *
   * https://api.mtn.com/v1/oauth/access_token/accesstoken?grant_type=client_credentials
   */
  private async getMtnAccessToken(): Promise<string> {
    /**
     * Reuse the cached token if it has not expired.
     *
     * We keep a 60 second safety buffer.
     */
    if (
      this.cachedToken &&
      Date.now() < this.cachedToken.expiry - 60_000
    ) {
      return this.cachedToken.access_token;
    }

    this.logger.log(
      'Fetching new MTN OAuth2 access token...',
    );

    const clientId =
      this.configService.get<string>('MTN_CLIENT_ID');

    const clientSecret =
      this.configService.get<string>('MTN_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error(
        'MTN_CLIENT_ID or MTN_CLIENT_SECRET is not configured',
      );
    }

    try {
      
      const tokenPayload = new URLSearchParams();

      tokenPayload.append(
        'grant_type',
        'client_credentials',
      );

      tokenPayload.append(
        'client_id',
        clientId,
      );

      tokenPayload.append(
        'client_secret',
        clientSecret,
      );

      const { data } =
        await this.httpService.axiosRef.post<MtnTokenResponse>(
          'https://api.mtn.com/v1/oauth/access_token/accesstoken?grant_type=client_credentials',
          tokenPayload.toString(),
          {
            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            timeout: 10000,
          },
        );

      if (!data.access_token) {
        throw new Error(
          'MTN did not return an access token',
        );
      }

      
      this.cachedToken = {
        access_token: data.access_token,
        expiry:
          Date.now() + data.expires_in * 1000,
      };

      this.logger.log(
        `MTN token received. Expires in ${data.expires_in} seconds.`,
      );

      return data.access_token;
    } catch (error) {
      this.logger.error(
        'Failed to fetch MTN OAuth2 access token',
        error,
      );

      throw new BadGatewayException(
        'MTN authentication service unavailable',
      );
    }
  }

  
  private generateClientCorrelatorId(): string {
    return `sms-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 10)}`;
  }

  private formatPhoneNumber(
    phoneNumber: string,
  ): string {
    return phoneNumber.trim();
  }
}