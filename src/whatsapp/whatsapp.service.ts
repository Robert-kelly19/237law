import {Injectable} from '@nestjs/common';
import ky from 'ky';
import { RagService } from 'src/rag.service';

@Injectable()
export class WhatsappService {

    constructor(private ragService: RagService) {}

    async sendMessage(phoneNumber: string, message: string): Promise<void> {
        const url = `https://graph.facebook.com/${process.env.WHATSAPP_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const data = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'text',
            text: {
                body: message,
            },
        };

        try {
            await ky.post(url, {
                json: data,
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                },
            });
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            throw new Error('Failed to send WhatsApp message');
        }   
    }

    async handleIncomingMessage(phoneNumber: string, message: string): Promise<void> {
        // Process the incoming message using RAG service
        const response = await this.ragService.askQuestion(message);
        // Send the response back to the user
        await this.sendMessage(phoneNumber, response);
    }
}
  