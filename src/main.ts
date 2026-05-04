import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { Logger, ValidationPipe } from '@nestjs/common';
import { validateRequiredEnvVars } from './config/env.validation';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // Validate required environment variables
  validateRequiredEnvVars(['WHATSAPP_VERIFY_TOKEN', 'OPENAI_API_KEY', 'DATABASE_URL']);
  
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const Port = process.env.PORT ?? 3000;

  await app.listen(Port, () => {
    logger.log(`Server is running on port ${Port}`);
  });
}
bootstrap();
