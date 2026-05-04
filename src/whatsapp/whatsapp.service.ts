import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private configService: ConfigService) {}

  async send(to: string, message: string): Promise<void> {
    const token = this.configService.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.configService.get<string>(
      'WHATSAPP_PHONE_NUMBER_ID',
    );
    const apiVersion =
      this.configService.get<string>('META_API_VERSION') || 'v19.0';

    // if (!token || !phoneNumberId) {
    //   throw new Error('Missing WhatsApp configuration');
    // }

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
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Failed to send message: ${errorText}`);
        return;
      }

      const data = await response.json();
      this.logger.log(`Message sent: ${JSON.stringify(data)}`);
    } catch (error) {
      this.logger.error('Error sending WhatsApp message', error);
    }
  }
}
