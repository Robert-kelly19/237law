import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import { PerformanceTrackerService } from '../performance/performance-tracker.service';

interface WhatsappRequestConfig {
  token: string;
  url: string;
  baseUrl: string;
  phoneNumberId: string;
}

interface WhatsappMediaUrlResponse {
  url: string;
}

interface WhatsappMediaResponse {
  id: string;
}

interface WhatsappTextMessagePayload {
  messaging_product: 'whatsapp';
  to: string;
  type: 'text';
  text: {
    body: string;
  };
}

interface WhatsappTypingIndicatorPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'action';
  action: {
    name: 'typing_indicator';
    parameters: {
      typing_indicator: 'on';
    };
  };
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly performanceTracker: PerformanceTrackerService,
    private readonly httpService: HttpService,
  ) {}

  async send(to: string, message: string): Promise<void> {
    return this.performanceTracker.track('whatsapp_send', async () => {
      const { token, url } = this.getWhatsappRequestConfig();

      const payload: WhatsappTextMessagePayload = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      };

      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 5000);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to send WhatsApp message (HTTP ${response.status}): ${errorText}`,
          );
        }

        this.logger.log(`Message sent successfully`);
      } catch (error) {
        this.logger.error('Error sending WhatsApp message', error);
        throw error;
      }
    });
  }

  async sendTypingIndicator(to: string): Promise<void> {
    return this.performanceTracker.track(
      'whatsapp_typing_indicator',
      async () => {
        const { token, url } = this.getWhatsappRequestConfig();

        const payload: WhatsappTypingIndicatorPayload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'action',
          action: {
            name: 'typing_indicator',
            parameters: {
              typing_indicator: 'on',
            },
          },
        };

        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 5000);

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            signal: abortController.signal,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Failed to send WhatsApp typing indicator (HTTP ${response.status}): ${errorText}`,
            );
          }

          this.logger.log(`Typing indicator sent successfully`);
        } catch (error) {
          this.logger.error('Error sending WhatsApp typing indicator', error);
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
    );
  }

  async downloadMedia(mediaId: string): Promise<Buffer> {
    try {
      const { token, baseUrl } = this.getWhatsappRequestConfig();
      const metadata =
        await this.httpService.axiosRef.get<WhatsappMediaUrlResponse>(
          `${baseUrl}/${encodeURIComponent(mediaId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15000,
          },
        );
      const response = await this.httpService.axiosRef.get<ArrayBuffer>(
        metadata.data.url,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'arraybuffer',
          timeout: 30000,
        },
      );

      return Buffer.from(response.data);
    } catch (error) {
      this.logExternalFailure('download WhatsApp media', error);
      throw error;
    }
  }

  async uploadAudio(audio: Buffer): Promise<string> {
    try {
      const { token, baseUrl, phoneNumberId } = this.getWhatsappRequestConfig();
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'audio/ogg');
      form.append('file', audio, {
        filename: 'reply.ogg',
        contentType: 'audio/ogg',
      });

      const response =
        await this.httpService.axiosRef.post<WhatsappMediaResponse>(
          `${baseUrl}/${phoneNumberId}/media`,
          form,
          {
            headers: {
              ...form.getHeaders(),
              Authorization: `Bearer ${token}`,
            },
            timeout: 30000,
          },
        );

      return response.data.id;
    } catch (error) {
      this.logExternalFailure('upload WhatsApp audio', error);
      throw error;
    }
  }

  async sendAudio(to: string, mediaId: string): Promise<void> {
    try {
      const { token, url } = this.getWhatsappRequestConfig();
      await this.httpService.axiosRef.post(
        url,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'audio',
          audio: { id: mediaId, voice: true },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );
    } catch (error) {
      this.logExternalFailure('send WhatsApp voice note', error);
      throw error;
    }
  }

  private getWhatsappRequestConfig(): WhatsappRequestConfig {
    const token =
      this.configService.get<string>('WHATSAPP_TOKEN') ||
      this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>(
      'WHATSAPP_PHONE_NUMBER_ID',
    );
    const apiVersion =
      this.configService.get<string>('WHATSAPP_API_VERSION') || 'v21.0';

    if (!token || !phoneNumberId) {
      throw new Error('Missing WhatsApp configuration');
    }

    const baseUrl = `https://graph.facebook.com/${apiVersion}`;
    return {
      token,
      url: `${baseUrl}/${phoneNumberId}/messages`,
      baseUrl,
      phoneNumberId,
    };
  }

  private logExternalFailure(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Failed to ${action}: ${message}`);
  }
}
