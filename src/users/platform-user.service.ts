import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { PlatformUser } from '@prisma/client';

@Injectable()
export class PlatformUserService {
  private readonly logger = new Logger(PlatformUserService.name);

  constructor(private prisma: PrismaService) {}

  async upsertWhatsAppUser(phoneNumber: string): Promise<PlatformUser> {
    return this.prisma.platformUser.upsert({
      where: {
        externalId_channel: {
          externalId: phoneNumber,
          channel: 'whatsapp',
        },
      },
      update: {
        lastSeenAt: new Date(),
        phoneNumber: phoneNumber,
      },
      create: {
        externalId: phoneNumber,
        phoneNumber: phoneNumber,
        channel: 'whatsapp',
      },
    });
  }
}
