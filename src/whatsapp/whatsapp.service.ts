import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceTrackerService } from '../performance/performance-tracker.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private configService: ConfigService,
    private performanceTracker: PerformanceTrackerService,
  ) {}

  async send(to: string, message: string): Promise<void> {
    return this.performanceTracker.track('whatsapp_send', async () => {
      const token = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
      const phoneNumberId = this.configService.get<string>(
        'WHATSAPP_PHONE_NUMBER_ID',
      );
      const apiVersion =
        this.configService.get<string>('WHATSAPP_API_VERSION') || 'v19.0';

      if (!token || !phoneNumberId) {
        throw new Error('Missing WhatsApp configuration');
      }

      const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

      const payload = {
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
}
