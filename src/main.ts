import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import { createHash, timingSafeEqual } from 'crypto';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Disable default body parser to capture raw body
  });

  // Get config service for app secret
  const configService = app.get(ConfigService);
  const appSecret = configService.get<string>('WHATSAPP_APP_SECRET');

  // Custom JSON parser that captures raw body buffer for signature verification
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );

  // WhatsApp signature verification middleware
  app.use((req, res, next) => {
    // Only verify POST webhook calls
    if (req.method !== 'POST' || !req.path.includes('whatsapp/webhook')) {
      return next();
    }

    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = req.rawBody;

    if (!signature) {
      logger.warn('Missing X-Hub-Signature-256 header');
      return res.status(403).json({ error: 'Missing signature header' });
    }

    if (!appSecret) {
      logger.warn(
        'WhatsApp app secret not configured, skipping signature verification',
      );
      return next();
    }

    if (!rawBody) {
      logger.warn('No raw body captured for signature verification');
      return res
        .status(400)
        .json({ error: 'Cannot verify signature: missing body' });
    }

    const expectedSignature = generateSignature(appSecret, rawBody);

    if (!verifySignature(signature, expectedSignature)) {
      logger.warn('Invalid webhook signature');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    logger.debug('Webhook signature verified');
    next();
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const Port = process.env.PORT ?? 3000;

  await app.listen(Port, () => {
    logger.log(`Server is running on port ${Port}`);
  });
}
bootstrap();

function generateSignature(secret: string, body: string): string {
  const hash = createHash('sha256')
    .update(secret + body, 'utf8')
    .digest('hex');
  return `sha256=${hash}`;
}

function verifySignature(
  signature: string,
  expectedSignature: string,
): boolean {
  if (typeof signature !== 'string' || typeof expectedSignature !== 'string') {
    return false;
  }

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');

  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(sigBuf, expectedBuf);
}
