import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as http from 'http';
import { PerformanceTrackerService } from '../performance/performance-tracker.service';

// Reuse HTTP agent for connection pooling
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private configService: ConfigService,
    private performanceTracker: PerformanceTrackerService,
  ) {}

  async send(to: string, message: string): Promise<void> {
    return this.performanceTracker.track(
      `whatsapp_send[${to.substring(0, 10)}...]`,
      async () => {
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
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            // @ts-ignore - node-fetch uses agents for connection pooling
            agent: httpsAgent,
            timeout: 5000, // 5 second timeout
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Failed to send WhatsApp message (HTTP ${response.status}): ${errorText}`,
            );
          }

          const data = await response.json();
          this.logger.log(`Message sent: ${JSON.stringify(data)}`);
        } catch (error) {
          this.logger.error('Error sending WhatsApp message', error);
          throw error;
        }
      },
    );
  }
}
