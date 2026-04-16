import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
const Port = process.env.PORT ?? 3000;
  
  await app.listen(Port, () => {
    logger.log(`Server is running on port ${Port}`);
  });
}
bootstrap();
