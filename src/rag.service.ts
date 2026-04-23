import { Injectable, OnModuleInit } from '@nestjs/common';
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

@Injectable()
export class RagService implements OnModuleInit {
  private openai: OpenAI;

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private pdfService: PdfService,
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async onModuleInit() {
    await this.ingestPdfs();
  }

  async ingestPdfs(): Promise<void> {
    const pdfData = await this.pdfService.extractTextsFromPdfs();

    for (const { source, text } of pdfData) {
      const exists = await this.isSourceIngested(source);
      if (exists) continue;

      const rawChunks = this.pdfService.chunkText(text);

      const validChunks = rawChunks
        .map((chunk, index) => ({ chunk, index }))
        .filter(({ chunk }) =>
          this.embeddingService.getChunkValidationReason(chunk) === null,
        );

      if (!validChunks.length) continue;

      const texts = validChunks.map(c => c.chunk);
      const embeddings = await this.embeddingService.generateEmbeddings(texts);

      for (let i = 0; i < texts.length; i++) {
        const { lawName, articleNumber } =
          this.pdfService.extractMetadata(texts[i], source, validChunks[i].index);

        const vector = this.vectorToLiteral(embeddings[i]);

        await this.prisma.$executeRaw`
          INSERT INTO law_sections ("lawName","articleNumber",content,source,embedding)
          VALUES (${lawName},${articleNumber},${texts[i]},${source},${vector}::vector(1536))
        `;
      }
    }
  }

  private async isSourceIngested(source: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw`
      SELECT 1 FROM law_sections WHERE source = ${source} LIMIT 1
    `;
    return Array.isArray(rows) && rows.length > 0;
  }

  private vectorToLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  async searchRelevantSections(query: string): Promise<LawSectionResult[]> {
    const embedding = await this.embeddingService.generateQueryEmbedding(query);
    const vector = this.vectorToLiteral(embedding);

    const results = await this.prisma.$queryRaw`
      SELECT id,"lawName","articleNumber",content,source,
      embedding <=> ${vector}::vector(1536) AS distance
      FROM law_sections
      ORDER BY embedding <=> ${vector}::vector(1536)
      LIMIT 5
    `;

    return results as LawSectionResult[];
  }

  async askQuestion(query: string): Promise<string> {
    const sections = await this.searchRelevantSections(query);

    if (!sections.length) {
      return `Sorry, I couldn't find a clear legal answer for your question.

NB: This response is for informational purposes only.`;
    }

    const context = sections
      .map(s => `${s.lawName} - Article ${s.articleNumber}:\n${s.content}`)
      .join('\n\n');

    const prompt = `
You are a helpful legal assistant for Cameroon.

Explain the law in a very simple and friendly way so anyone can understand.

Rules:
- Use simple everyday English
- Keep sentences short
- Start with a direct answer (Yes/No if possible)
- Do not invent laws
- Use the provided context only
- Always cite like: "According to Section X of [Law Name]"
- Add "Penalty:" only if it exists

Format:

<Simple answer>

According to Section/Article X of [Law Name],
<simple explanation>

Penalty:
<if applicable>

End with:
NB: This response is for informational purposes only.

Context:
${context}

Question:
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

NB: This response is for informational purposes only.`;
    }

    if (answer.includes('NB: This response is for informational purposes only.')) {
      return answer;
    }

    return `${answer}

NB: This response is for informational purposes only.`;
  }
}