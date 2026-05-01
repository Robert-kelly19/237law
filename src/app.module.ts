import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { PdfService } from './pdf.service';
import { EmbeddingService } from './embedding.service';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WhatsappService } from './whatsapp/whatsapp.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        WHATSAPP_TOKEN: Joi.string().required(),
        WHATSAPP_PHONE_NUMBER_ID: Joi.string().required(),
        WHATSAPP_VERIFY_TOKEN: Joi.string().required(),
        META_API_VERSION: Joi.string().optional(),
      }),
      validationOptions: {
        abortEarly: true,
      },
    }),
  ],
  controllers: [AppController, RagController, WhatsappController],
  providers: [
    AppService,
    PrismaService,
    PdfService,
    EmbeddingService,
    RagService,
    WhatsappService,
  ],
})
export class AppModule {}