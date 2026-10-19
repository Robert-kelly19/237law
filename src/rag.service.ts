import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { EmbeddingService } from './embedding.service';
import { PdfService } from './pdf.service';
import OpenAI from 'openai';

type LawSectionResult = {
  id: string;
  lawName: string;
  articleNumber: string;
  content: string;
  source: string;
  distance: number;
};

type SourceHashRow = {
  content_hash: string | null;
};

type SourceLockRow = {
  source: string;
};

type SourceLockHeartbeat = {
  assertActive(): void;
  stop(): Promise<void>;
};

@Injectable()
export class RagService implements OnModuleInit {
  private openai: OpenAI;
  private readonly logger = new Logger(RagService.name);

  private readonly batchSize: number;
  private readonly batchTimeoutMs = 20000;
  private readonly batchMaxWaitMs = 10000;
  private readonly sourceLockHeartbeatMs = 60000;

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private pdfService: PdfService,
  ) {
    const configuredBatchSize = Number(
      process.env.PDF_INGESTION_BATCH_SIZE ?? 25,
    );
    if (
      !Number.isInteger(configuredBatchSize) ||
      configuredBatchSize < 1 ||
      configuredBatchSize > 100
    ) {
      throw new Error(
        'PDF_INGESTION_BATCH_SIZE must be an integer between 1 and 100',
      );
    }
    this.batchSize = configuredBatchSize;

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.shouldSkipPdfIngestion()) {
      this.logger.log('Skipping PDF ingestion during test/bootstrap mode');
      return;
    }

    try {
      const result = await this.ingestPdfs();

      if (result.failed.length > 0) {
        this.logger.warn(
          `Startup ingestion finished with ${result.failed.length} failed source(s).`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.stack || error.message : String(error);

      this.logger.error('Fatal error during PDF ingestion', message);
    }
  }

  private shouldSkipPdfIngestion(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.SKIP_PDF_INGESTION === 'true'
    );
  }

  async ingestPdfs(): Promise<{
    ingested: string[];
    skipped: string[];
    failed: string[];
  }> {
    if (this.shouldSkipPdfIngestion()) {
      this.logger.log(
        'Skipping PDF ingestion because the app is in test/skip mode',
      );

      return { ingested: [], skipped: [], failed: [] };
    }

    this.logger.log('[RagService] PDF INGESTION STARTED');

    const ingested: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    let pdfData: { source: string; text: string }[];

    try {
      pdfData = await this.pdfService.extractTextsFromPdfs();
      this.logger.log(`[RagService] Extracted ${pdfData.length} PDFs`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to extract PDF texts: ${message}`);

      return {
        ingested,
        skipped,
        failed: ['PDF_EXTRACTION_FAILED'],
      };
    }

    for (const { source, text } of pdfData) {
      this.logger.log(`[RagService] Processing source: ${source}`);

      try {
        const outcome = await this.ingestSource(source, text);
        if (outcome === 'skipped') {
          this.logger.log(
            `[RagService] Source is complete and unchanged; skipping: ${source}`,
          );
          skipped.push(source);
        } else {
          ingested.push(source);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.stack || error.message : String(error);

        this.logger.error(
          `[RagService] Failed to ingest source ${source}: ${message}`,
        );

        failed.push(source);
      }
    }

    this.logger.log(
      `[RagService] INGESTION SUMMARY: ${ingested.length} completed, ${skipped.length} skipped, ${failed.length} failed`,
    );

    if (ingested.length > 0) {
      this.logger.log(`[RagService] Ingested: ${ingested.join(', ')}`);
    }

    if (skipped.length > 0) {
      this.logger.log(`[RagService] Skipped: ${skipped.join(', ')}`);
    }

    if (failed.length > 0) {
      this.logger.error(`[RagService] Failed: ${failed.join(', ')}`);
    }

    return { ingested, skipped, failed };
  }

  private async ingestSource(
    source: string,
    text: string,
  ): Promise<'ingested' | 'skipped'> {
    const lockToken = await this.acquireSourceLock(source);
    const heartbeat = this.startSourceLockHeartbeat(source, lockToken);

    try {
      const extractedText = typeof text === 'string' ? text.trim() : '';

      this.logger.log(
        `[RagService] Extracted ${extractedText.length} characters from ${source}`,
      );

      if (extractedText.length < 100) {
        throw new Error(
          `Insufficient extracted text (${extractedText.length} characters). Inspect the PDF or determine whether OCR is required.`,
        );
      }

      const rawChunks = this.pdfService.chunkText(extractedText);
      const chunks = rawChunks.filter(
        (chunk) => chunk?.trim() && chunk.trim().split(/\s+/).length >= 3,
      );

      this.logger.log(
        `[RagService] Created ${chunks.length} valid chunks from ${source} (filtered from ${rawChunks.length})`,
      );

      if (chunks.length === 0) {
        throw new Error('No valid chunks were extracted');
      }

      const expectedHashes = chunks.map((chunk) =>
        this.computeContentHash(chunk),
      );
      const existingHashes = await this.getSourceContentHashes(source);

      if (this.sameHashMultiset(existingHashes, expectedHashes)) {
        heartbeat.assertActive();
        return 'skipped';
      }

      this.logger.log(
        `[RagService] Generating embeddings for ${chunks.length} chunks...`,
      );

      // Generate and validate all embeddings before changing existing rows.
      const embeddings = await this.embeddingService.generateEmbeddings(chunks);

      if (embeddings.length !== chunks.length) {
        throw new Error(
          `Embedding count mismatch: expected ${chunks.length}, received ${embeddings.length}`,
        );
      }

      for (let i = 0; i < embeddings.length; i++) {
        if (
          !Array.isArray(embeddings[i]) ||
          embeddings[i].length !== 1536 ||
          !embeddings[i].every(Number.isFinite)
        ) {
          throw new Error(
            `Invalid embedding at chunk ${i}: expected 1536 finite numeric values`,
          );
        }
      }

      heartbeat.assertActive();

      if (existingHashes.length > 0) {
        this.logger.warn(
          `[RagService] Replacing ${existingHashes.length} existing or partial chunks for ${source}`,
        );

        await this.prisma.$transaction(
          async (tx) => {
            await this.refreshSourceLock(tx, source, lockToken);
            await tx.$executeRaw`
              DELETE FROM law_sections
              WHERE source = ${source}
            `;
          },
          {
            maxWait: this.batchMaxWaitMs,
            timeout: this.batchTimeoutMs,
          },
        );
      }

      let inserted = 0;
      const totalBatches = Math.ceil(chunks.length / this.batchSize);

      for (
        let start = 0, batchNumber = 1;
        start < chunks.length;
        start += this.batchSize, batchNumber++
      ) {
        const end = Math.min(start + this.batchSize, chunks.length);

        await this.prisma.$transaction(
          async (tx) => {
            await this.refreshSourceLock(tx, source, lockToken);

            for (let i = start; i < end; i++) {
              const { lawName, articleNumber } =
                this.pdfService.extractMetadata(chunks[i], source, i);
              const vector = this.vectorToLiteral(embeddings[i]);

              await tx.$executeRaw`
                INSERT INTO law_sections
                  (
                    "lawName",
                    "articleNumber",
                    content,
                    source,
                    content_hash,
                    embedding
                  )
                VALUES (
                  ${lawName},
                  ${articleNumber},
                  ${chunks[i]},
                  ${source},
                  ${expectedHashes[i]},
                  ${vector}::vector(1536)
                )
              `;
            }
          },
          {
            maxWait: this.batchMaxWaitMs,
            timeout: this.batchTimeoutMs,
          },
        );

        inserted += end - start;
        this.logger.log(
          `[RagService] Saved batch ${batchNumber}/${totalBatches} (${end - start} chunks): ${inserted}/${chunks.length} chunks for ${source}`,
        );
      }

      heartbeat.assertActive();
      const savedHashes = await this.getSourceContentHashes(source);

      if (!this.sameHashMultiset(savedHashes, expectedHashes)) {
        throw new Error(
          `Post-insert verification failed for ${source}: expected ${chunks.length} chunks, found ${savedHashes.length}`,
        );
      }

      heartbeat.assertActive();
      this.logger.log(
        `[RagService] Successfully ingested and verified ${inserted} chunks from ${source}`,
      );

      return 'ingested';
    } finally {
      await heartbeat.stop();
      await this.releaseSourceLock(source, lockToken);
    }
  }

  private async acquireSourceLock(source: string): Promise<string> {
    const lockToken = randomUUID();
    const rows = await this.prisma.$queryRaw<SourceLockRow[]>`
      INSERT INTO source_ingestion_lock ("source", "owner_token", "expires_at")
      VALUES (${source}, ${lockToken}::uuid, CURRENT_TIMESTAMP + INTERVAL '5 minutes')
      ON CONFLICT ("source") DO UPDATE
      SET "owner_token" = EXCLUDED."owner_token",
          "expires_at" = EXCLUDED."expires_at"
      WHERE source_ingestion_lock."expires_at" <= CURRENT_TIMESTAMP
      RETURNING "source"
    `;

    if (rows.length !== 1) {
      throw new Error(`Ingestion is already running for source: ${source}`);
    }

    return lockToken;
  }

  private startSourceLockHeartbeat(
    source: string,
    lockToken: string,
  ): SourceLockHeartbeat {
    let lostError: Error | null = null;
    let heartbeatInFlight: Promise<void> | null = null;

    const renew = async (): Promise<void> => {
      try {
        const updated = await this.prisma.$executeRaw`
          UPDATE source_ingestion_lock
          SET "expires_at" = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
          WHERE "source" = ${source}
            AND "owner_token" = ${lockToken}::uuid
            AND "expires_at" > CURRENT_TIMESTAMP
        `;

        if (updated !== 1) {
          throw new Error(`Ingestion lock was lost for source: ${source}`);
        }
      } catch (error: unknown) {
        lostError = error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `[RagService] Failed to renew ingestion lock for ${source}: ${lostError.message}`,
        );
      }
    };

    const interval = setInterval(() => {
      if (!heartbeatInFlight && !lostError) {
        heartbeatInFlight = renew().finally(() => {
          heartbeatInFlight = null;
        });
      }
    }, this.sourceLockHeartbeatMs);
    interval.unref();

    return {
      assertActive: () => {
        if (lostError) {
          throw lostError;
        }
      },
      stop: async () => {
        clearInterval(interval);
        await heartbeatInFlight;
      },
    };
  }

  private async refreshSourceLock(
    tx: Pick<PrismaService, '$executeRaw'>,
    source: string,
    lockToken: string,
  ): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE source_ingestion_lock
      SET "expires_at" = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
      WHERE "source" = ${source}
        AND "owner_token" = ${lockToken}::uuid
        AND "expires_at" > CURRENT_TIMESTAMP
    `;

    if (updated !== 1) {
      throw new Error(`Ingestion lock was lost for source: ${source}`);
    }
  }

  private async releaseSourceLock(
    source: string,
    lockToken: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM source_ingestion_lock
      WHERE "source" = ${source}
        AND "owner_token" = ${lockToken}::uuid
    `;
  }

  private async getSourceContentHashes(
    source: string,
  ): Promise<(string | null)[]> {
    const rows = await this.prisma.$queryRaw<SourceHashRow[]>`
      SELECT content_hash
      FROM law_sections
      WHERE source = ${source}
      ORDER BY content_hash
    `;

    return rows.map((row) => row.content_hash);
  }

  private sameHashMultiset(
    actual: (string | null)[],
    expected: string[],
  ): boolean {
    if (actual.length !== expected.length) {
      return false;
    }

    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();

    return actualSorted.every(
      (hash, index) => hash !== null && hash === expectedSorted[index],
    );
  }

  async getIngestionStatus(): Promise<{
    totalChunks: number;
    lawsBySource: { source: string; chunks: number }[];
    isEmpty: boolean;
  }> {
    const count = await this.prisma.lawSection.count();

    const laws = await this.prisma.lawSection.groupBy({
      by: ['source'],
      _count: { id: true },
    });

    return {
      totalChunks: count,
      lawsBySource: laws.map((law) => ({
        source: law.source,
        chunks: law._count.id,
      })),
      isEmpty: count === 0,
    };
  }

  private vectorToLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  private computeContentHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  async searchRelevantSections(query: string): Promise<LawSectionResult[]> {
    const embedding = await this.embeddingService.generateQueryEmbedding(query);

    const vector = this.vectorToLiteral(embedding);

    const results = await this.prisma.$queryRaw<LawSectionResult[]>`
      SELECT
        id,
        "lawName",
        "articleNumber",
        content,
        source,
        embedding <=> ${vector}::vector(1536) AS distance
      FROM law_sections
      ORDER BY embedding <=> ${vector}::vector(1536)
      LIMIT 5
    `;

    return results;
  }

  async askQuestion(query: string): Promise<string> {
    const sections = await this.searchRelevantSections(query);

    if (!sections.length) {
      return `Sorry, I couldn't find a clear legal answer for your question.

NB: This response is provided for informational purposes only and does not constitute legal advice.
For proper legal assistance, please consult a qualified lawyer via the contact details in our bio.`;
    }

    const context = sections
      .map(
        (section) =>
          `${section.lawName} - Article ${section.articleNumber}:\n${section.content}`,
      )
      .join('\n\n');

    const prompt = `
You are a professional legal assistant specializing exclusively in Cameroonian law. You help ordinary citizens, entrepreneurs, students, and professionals understand their legal rights and obligations under Cameroonian legislation.

---

IDENTITY & SCOPE:
- You only advise on Cameroonian law (OHADA, Penal Code, Civil Code, Criminal Procedure Code, Labour Code, Commercial Code, and other applicable Cameroonian statutes).
- You do NOT answer questions about foreign legal systems unless comparing them to Cameroonian law at the user's explicit request.
- You are NOT a substitute for a qualified lawyer. Always remind users of this at the end.

---

CORE RULES — NEVER VIOLATE THESE:
1. NEVER invent, fabricate, or paraphrase laws. Only cite laws explicitly found in the provided context.
2. NEVER use internal identifiers such as "chunk-*", "doc-*", or any database IDs.
3. NEVER start your response with "Yes" or "No" unless the question is a direct yes/no question (e.g., "Is it legal to…?").
4. If the context contains NO relevant legal provision, respond EXACTLY with: "No clear legal provision was found in the available laws for this question. Please consult a qualified Cameroonian lawyer."
5. Do NOT speculate or fill gaps with general legal knowledge when the context is silent.

---

CITATION RULES:
- Always cite the exact article/section number and full law name (e.g., "Article 74 of the Cameroonian Penal Code").
- If multiple laws apply (e.g., Penal Code AND Criminal Procedure Code), you MUST cite ALL relevant ones and explain what each contributes.
- If the same topic is covered by both a general law and a special law (e.g., OHADA vs. national Commercial Code), note which one takes precedence and why.
- Never merge or paraphrase two different articles as if they are one.

---

RESPONSE LOGIC — FOLLOW THIS DECISION TREE:
- If the question is "what do I need" / "what are the steps" / "how do I…": → Use a numbered list of requirements or steps.
- If the question is "is it legal" / "can I…" / "am I allowed to…": → State the legal position clearly, then cite the law.
- If the question involves a penalty or crime: → State the act, the applicable law, and the penalty range.
- If the question involves a contract or civil matter: → State the relevant civil/OHADA rule and any formality requirements.
- If multiple laws conflict or overlap: → Explain the difference clearly and state which one applies in this situation.

---

LANGUAGE & TONE:
- Use simple, everyday English (or French if the user writes in French).
- Write short paragraphs — maximum 3 sentences each.
- Avoid legal jargon; define any necessary legal term in plain language.
- Be warm and reassuring.

---

REQUIRED OUTPUT FORMAT:

**Summary**
[One to two sentences giving the direct answer in plain language.]

**Legal Basis**
- Article/Section [X] of [Full Law Name]: [One sentence explaining what this article says in simple terms.]
- Article/Section [Y] of [Full Law Name] (if applicable): [One sentence explanation.]

**What This Means for You**
[Two to four sentences explaining the practical implication for the user's specific situation.]

**Key Difference** *(only if two or more laws apply)*
[Explain in one to three sentences what each law covers and how they differ.]

**Penalty or Consequence** *(only if mentioned in the context)*
[State the penalty range or legal consequence clearly.]

**Important Notice**
This response is for informational purposes only and does not constitute legal advice. For proper legal assistance tailored to your situation, please consult a qualified Cameroonian lawyer.

---

Context (verified legal sources only):
${context}

User Question:
${query}

Answer:
`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });

    const answer = response.choices?.[0]?.message?.content?.trim() || '';

    return this.formatAnswer(answer);
  }

  private formatAnswer(answer: string): string {
    if (!answer) {
      return `Sorry, I couldn't find a clear legal answer for your question.

NB: This response is provided for informational purposes only and does not constitute legal advice.
For proper legal assistance, please consult a qualified lawyer via the contact details in our bio.`;
    }

    if (
      answer.includes(
        'NB: This response is provided for informational purposes only and does not constitute legal advice.\nFor proper legal assistance, please consult a qualified lawyer via the contact details in our bio.',
      )
    ) {
      return answer;
    }

    this.logger.log(`Formatted answer: ${answer}`);
    return answer;
  }
}
