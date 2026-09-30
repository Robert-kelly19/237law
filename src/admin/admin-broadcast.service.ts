import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class AdminBroadcastService {
  private readonly logger = new Logger(AdminBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async sendBroadcast(message: string): Promise<{
    totalRecipients: number;
    sent: number;
    failed: number;
  }> {
    const recipients = await this.prisma.platformUser.findMany({
      where: { channel: 'whatsapp' },
      select: { externalId: true },
    });

    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        await this.whatsappService.send(recipient.externalId, message);
        sent += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Broadcast delivery failed for WhatsApp user ${recipient.externalId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return {
      totalRecipients: recipients.length,
      sent,
      failed,
    };
  }
}
