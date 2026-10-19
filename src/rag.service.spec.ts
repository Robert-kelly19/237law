import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { EmbeddingService } from './embedding.service';
import { PdfService } from './pdf.service';
import { PrismaService } from './prisma.service';
import { RagService } from './rag.service';

type MockTx = {
  $executeRaw: jest.Mock<Promise<number>, [TemplateStringsArray, ...unknown[]]>;
};

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function makeEmbedding(): number[] {
  return Array.from({ length: 1536 }, () => 0.1);
}

function makeChunks(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `SECTION ${index + 1} This is a sufficiently long legal chunk for testing content hashing and vector persistence.`,
  );
}

function createHarness(options?: {
  chunks?: string[];
  text?: string;
  files?: { source: string; text: string }[];
  initialHashes?: string[];
}) {
  const source = 'test-law.pdf';
  const chunks = options?.chunks ?? makeChunks(2);
  const initialHashes = options?.initialHashes ?? [];
  const sourceRows = new Map<string, string[]>([[source, [...initialHashes]]]);
  const sourceLocks = new Map<string, string>();
  let insertCalls = 0;
  let failInsertAt: number | null = null;

  const executeSql = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      const sql = strings.join(' ');

      if (sql.includes('UPDATE source_ingestion_lock')) {
        return Promise.resolve(1);
      }

      if (sql.includes('DELETE FROM source_ingestion_lock')) {
        const lockSource = String(values[0]);
        const token = String(values[1]);
        if (sourceLocks.get(lockSource) === token) {
          sourceLocks.delete(lockSource);
        }
        return Promise.resolve(1);
      }

      if (sql.includes('DELETE FROM law_sections')) {
        sourceRows.set(String(values[0]), []);
        return Promise.resolve(sourceRows.get(String(values[0]))!.length);
      }

      if (sql.includes('INSERT INTO law_sections')) {
        insertCalls++;
        if (failInsertAt === insertCalls) {
          throw new Error('simulated batch insert failure');
        }
        const rowSource = String(values[3]);
        const contentHash = String(values[4]);
        sourceRows.set(rowSource, [
          ...(sourceRows.get(rowSource) ?? []),
          contentHash,
        ]);
        return Promise.resolve(1);
      }

      throw new Error(`Unexpected execute SQL: ${sql}`);
    },
  );

  const prisma = {
    $queryRaw: jest.fn(
      (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<unknown[]> => {
        const sql = strings.join(' ');

        if (sql.includes('INSERT INTO source_ingestion_lock')) {
          const lockSource = String(values[0]);
          const token = String(values[1]);
          if (sourceLocks.has(lockSource)) {
            return Promise.resolve([]);
          }
          sourceLocks.set(lockSource, token);
          return Promise.resolve([{ source: lockSource }]);
        }

        if (sql.includes('SELECT content_hash')) {
          const querySource = String(values[0]);
          return Promise.resolve(
            (sourceRows.get(querySource) ?? []).map((content_hash) => ({
              content_hash,
            })),
          );
        }

        throw new Error(`Unexpected query SQL: ${sql}`);
      },
    ),
    $executeRaw: executeSql,
    $transaction: jest.fn(
      async (
        callback: (tx: MockTx) => Promise<unknown>,
        options: { maxWait: number; timeout: number },
      ) => {
        void options;
        const stagedRows = new Map(
          [...sourceRows].map(([key, values]) => [key, [...values]]),
        );

        const txExecute = jest.fn(
          (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ): Promise<number> => {
            const sql = strings.join(' ');

            if (sql.includes('UPDATE source_ingestion_lock')) {
              return Promise.resolve(1);
            }

            if (sql.includes('DELETE FROM law_sections')) {
              stagedRows.set(String(values[0]), []);
              return Promise.resolve(1);
            }

            if (sql.includes('INSERT INTO law_sections')) {
              insertCalls++;
              if (failInsertAt === insertCalls) {
                throw new Error('simulated batch insert failure');
              }
              const rowSource = String(values[3]);
              const contentHash = String(values[4]);
              stagedRows.set(rowSource, [
                ...(stagedRows.get(rowSource) ?? []),
                contentHash,
              ]);
              return Promise.resolve(1);
            }

            throw new Error(`Unexpected transaction SQL: ${sql}`);
          },
        );

        const result = await callback({ $executeRaw: txExecute });
        sourceRows.clear();
        for (const [key, values] of stagedRows) {
          sourceRows.set(key, values);
        }
        return result;
      },
    ),
  };

  const pdfService = {
    extractTextsFromPdfs: jest.fn().mockResolvedValue(
      options?.files ?? [
        {
          source,
          text:
            options?.text ??
            'This extracted law text is long enough to pass the suspiciously short extraction check and to provide reliable input for chunk generation during this isolated service test.',
        },
      ],
    ),
    chunkText: jest.fn().mockReturnValue(chunks),
    extractMetadata: jest.fn().mockReturnValue({
      lawName: 'test-law',
      articleNumber: '1',
    }),
  };

  const embeddingService = {
    generateEmbeddings: jest
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => makeEmbedding())),
      ),
  };

  return {
    service: new RagService(
      prisma as unknown as PrismaService,
      embeddingService as unknown as EmbeddingService,
      pdfService as unknown as PdfService,
    ),
    prisma,
    pdfService,
    embeddingService,
    sourceRows,
    sourceLocks,
    setFailInsertAt: (insertNumber: number | null) => {
      failInsertAt = insertNumber;
    },
    getInsertCalls: () => insertCalls,
    source,
    chunks,
  };
}

describe('RagService PDF ingestion', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSkipIngestion = process.env.SKIP_PDF_INGESTION;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalBatchSize = process.env.PDF_INGESTION_BATCH_SIZE;

  beforeAll(() => {
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.SKIP_PDF_INGESTION;
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSkipIngestion === undefined) {
      delete process.env.SKIP_PDF_INGESTION;
    } else {
      process.env.SKIP_PDF_INGESTION = originalSkipIngestion;
    }
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalBatchSize === undefined) {
      delete process.env.PDF_INGESTION_BATCH_SIZE;
    } else {
      process.env.PDF_INGESTION_BATCH_SIZE = originalBatchSize;
    }
  });

  beforeEach(() => {
    delete process.env.PDF_INGESTION_BATCH_SIZE;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ingests a source with no saved chunks', async () => {
    const harness = createHarness();

    const result = await harness.service.ingestPdfs();

    expect(result).toEqual({
      ingested: [harness.source],
      skipped: [],
      failed: [],
    });
    expect(harness.embeddingService.generateEmbeddings).toHaveBeenCalledWith(
      harness.chunks,
    );
    expect(harness.sourceRows.get(harness.source)).toEqual(
      harness.chunks.map(hash),
    );
  });

  it('skips a fully ingested unchanged source', async () => {
    const chunks = makeChunks(2);
    const harness = createHarness({ chunks, initialHashes: chunks.map(hash) });

    const result = await harness.service.ingestPdfs();

    expect(result.skipped).toEqual([harness.source]);
    expect(result.ingested).toEqual([]);
    expect(harness.embeddingService.generateEmbeddings).not.toHaveBeenCalled();
  });

  it('replaces a partially ingested source', async () => {
    const chunks = makeChunks(3);
    const harness = createHarness({
      chunks,
      initialHashes: [hash(chunks[0])],
    });

    const result = await harness.service.ingestPdfs();

    expect(result.ingested).toEqual([harness.source]);
    expect(harness.sourceRows.get(harness.source)).toEqual(chunks.map(hash));
  });

  it('replaces a source whose extracted content changed', async () => {
    const chunks = makeChunks(2);
    const harness = createHarness({
      chunks,
      initialHashes: ['stale-content-hash'],
    });

    const result = await harness.service.ingestPdfs();

    expect(result.ingested).toEqual([harness.source]);
    expect(harness.sourceRows.get(harness.source)).toEqual(chunks.map(hash));
  });

  it('preserves existing rows when embedding generation fails', async () => {
    const harness = createHarness({
      initialHashes: ['existing-content-hash'],
    });
    harness.embeddingService.generateEmbeddings.mockRejectedValue(
      new Error('OpenAI unavailable'),
    );

    const result = await harness.service.ingestPdfs();

    expect(result.failed).toEqual([harness.source]);
    expect(harness.sourceRows.get(harness.source)).toEqual([
      'existing-content-hash',
    ]);
  });

  it('preserves existing rows when embedding count does not match chunks', async () => {
    const harness = createHarness({
      initialHashes: ['existing-content-hash'],
    });
    harness.embeddingService.generateEmbeddings.mockResolvedValue([]);

    const result = await harness.service.ingestPdfs();

    expect(result.failed).toEqual([harness.source]);
    expect(harness.sourceRows.get(harness.source)).toEqual([
      'existing-content-hash',
    ]);
  });

  it('preserves existing rows when an embedding has the wrong dimensions', async () => {
    const harness = createHarness({
      initialHashes: ['existing-content-hash'],
    });
    harness.embeddingService.generateEmbeddings.mockResolvedValue([
      Array.from({ length: 1535 }, () => 0.1),
      makeEmbedding(),
    ]);

    const result = await harness.service.ingestPdfs();

    expect(result.failed).toEqual([harness.source]);
    expect(harness.sourceRows.get(harness.source)).toEqual([
      'existing-content-hash',
    ]);
  });

  it('records a failed batch and retries successfully after partial insertion', async () => {
    process.env.PDF_INGESTION_BATCH_SIZE = '25';
    const chunks = makeChunks(26);
    const harness = createHarness({ chunks });
    harness.setFailInsertAt(26);

    const firstResult = await harness.service.ingestPdfs();

    expect(firstResult.failed).toEqual([harness.source]);
    expect(harness.sourceRows.get(harness.source)).toHaveLength(25);

    harness.setFailInsertAt(null);
    const retryResult = await harness.service.ingestPdfs();

    expect(retryResult.ingested).toEqual([harness.source]);
    expect(harness.sourceRows.get(harness.source)).toEqual(chunks.map(hash));
  });

  it('reports empty and suspiciously short PDF extraction as failures', async () => {
    const harness = createHarness({
      files: [
        { source: 'empty.pdf', text: '' },
        { source: 'short.pdf', text: 'Only 25 characters of extracted text.' },
      ],
    });

    const result = await harness.service.ingestPdfs();

    expect(result.failed).toEqual(['empty.pdf', 'short.pdf']);
    expect(harness.embeddingService.generateEmbeddings).not.toHaveBeenCalled();
  });

  it('compares duplicate chunk hashes by count, not just unique values', async () => {
    const duplicateChunk =
      'SECTION 1 This is a sufficiently long duplicate legal chunk for the ingestion hash test.';
    const chunks = [duplicateChunk, duplicateChunk];
    const harness = createHarness({
      chunks,
      initialHashes: [hash(duplicateChunk)],
    });

    const result = await harness.service.ingestPdfs();

    expect(result.ingested).toEqual([harness.source]);
    expect(harness.sourceRows.get(harness.source)).toEqual([
      hash(duplicateChunk),
      hash(duplicateChunk),
    ]);
    expect(harness.embeddingService.generateEmbeddings).toHaveBeenCalledTimes(
      1,
    );
  });

  it('does not generate embeddings again after a source is verified unchanged', async () => {
    const harness = createHarness();

    await expect(harness.service.ingestPdfs()).resolves.toMatchObject({
      ingested: [harness.source],
    });
    await expect(harness.service.ingestPdfs()).resolves.toMatchObject({
      skipped: [harness.source],
    });

    expect(harness.embeddingService.generateEmbeddings).toHaveBeenCalledTimes(
      1,
    );
  });

  it('uses the configured batch size for bounded transactions', async () => {
    process.env.PDF_INGESTION_BATCH_SIZE = '10';
    const harness = createHarness({ chunks: makeChunks(21) });

    const result = await harness.service.ingestPdfs();

    expect(result.ingested).toEqual([harness.source]);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(3);
    for (const [, options] of harness.prisma.$transaction.mock.calls) {
      expect(options).toEqual({ maxWait: 10000, timeout: 20000 });
    }
  });

  it('fails rather than replacing a source when another process owns its lock', async () => {
    const harness = createHarness();
    harness.sourceLocks.set(harness.source, 'another-process');

    const result = await harness.service.ingestPdfs();

    expect(result.failed).toEqual([harness.source]);
    expect(harness.embeddingService.generateEmbeddings).not.toHaveBeenCalled();
    expect(harness.sourceRows.get(harness.source)).toEqual([]);
  });
});
