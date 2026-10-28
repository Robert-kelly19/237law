import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RagService } from './rag.service';

async function ingest(): Promise<void> {
  delete process.env.INGEST_ON_STARTUP;

  const logger = new Logger('Ingest');
  let app: INestApplicationContext | undefined;

  try {
    app = await NestFactory.createApplicationContext(AppModule);
    const result = await app.get(RagService).ingestPdfs();

    if (result.failed.length > 0) {
      throw new Error(
        `Failed to ingest PDF sources: ${result.failed.join(', ')}`,
      );
    }

    logger.log(
      `PDF ingestion complete: ${result.ingested.length} ingested, ${result.skipped.length} skipped`,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.stack || error.message : String(error);
    logger.error('PDF ingestion failed', message);
    process.exitCode = 1;
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.stack || error.message : String(error);
        logger.error('Failed to close ingestion application context', message);
        process.exitCode = 1;
      }
    }
  }
}

void ingest();
