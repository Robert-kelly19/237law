import {Controller, Get, Post, Body, Query, Header} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
    constructor(private whatsappService: WhatsappService) {}
    @Get('webhook')
    verifyWebhook(
        @Query('hub.mode') mode: string,
        @Query('hub.verify_token') token: string,
        @Query('hub.challenge') challenge: string,
    ): string {
        if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
            console.log('Webhook verified');
            return challenge;
        } else {
            console.error('Webhook verification failed');
            return 'Verification failed';
        }
    }

    @Post('webhook')
    @Header('Content-Type', 'application/json')
    async receiveMessage(@Body() body: any): Promise<void> {
        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.value.messages) {
                        const message = change.value.messages[0];
                        const phoneNumber = message.from;
                        const text = message.text.body;
                        await this.whatsappService.handleIncomingMessage(phoneNumber, text);
                    }
                }
            }
        }
    }
}