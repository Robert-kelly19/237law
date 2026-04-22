import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';
  const appSecret = configService.get<string>('WHATSAPP_APP_SECRET');

  if (nodeEnv === 'production' && !appSecret) {
    logger.error('WHATSAPP_APP_SECRET is required in production environment');
    process.exit(1);
  }

  if (!appSecret && nodeEnv !== 'production') {
    logger.warn(
      'WhatsApp app secret not configured. Webhook signature verification will be skipped in non-production mode.',
    );
  }

  app.use(
    express.json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use((req, res, next) => {
    if (req.method !== 'POST' || !req.path.includes('whatsapp/webhook')) {
      return next();
    }

    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = req.rawBody;

    if (!appSecret) {
      return res
        .status(500)
        .json({ error: 'Server misconfiguration: app secret not set' });
    }

    if (!signature) {
      logger.warn('Missing X-Hub-Signature-256 header');
      return res.status(403).json({ error: 'Missing signature header' });
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
  const hmac = createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
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
