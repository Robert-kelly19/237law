import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from './prisma.service';
import { EmbeddingService } from './embedding.service';
import { PdfService } from './pdf.service';
import OpenAI from 'openai';

const LEGAL_DISCLAIMER = `NB: This response is provided for informational purposes only and does not constitute legal advice.
For proper legal assistance, please consult a qualified lawyer via the contact details in our bio.`;

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
        .filter(
          ({ chunk }) =>
            this.embeddingService.getChunkValidationReason(chunk) === null,
        );

      if (!validChunks.length) continue;

      const texts = validChunks.map((c) => c.chunk);
      const embeddings = await this.embeddingService.generateEmbeddings(texts);

      for (let i = 0; i < texts.length; i++) {
        const { lawName, articleNumber } = this.pdfService.extractMetadata(
          texts[i],
          source,
          validChunks[i].index,
        );

        const contentHash = this.computeContentHash(texts[i]);
        const vector = this.vectorToLiteral(embeddings[i]);

        await this.prisma.$executeRaw`
          INSERT INTO "law_sections" ("lawName","articleNumber","content","source","contentHash","embedding")
          VALUES (${lawName},${articleNumber},${texts[i]},${source},${contentHash},${vector}::vector(1536))
        `;
      }

      await this.prisma.sourceIngestion.create({
        data: {
          source,
          ingestedAt: new Date(),
        },
      });
    }
  }

  private async isSourceIngested(source: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw`
      SELECT 1 FROM source_ingestion WHERE source = ${source} LIMIT 1
    `;
    return Array.isArray(rows) && rows.length > 0;
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

    const results = await this.prisma.$queryRaw`
      SELECT id,"lawName","articleNumber",content,source,
      embedding <=> ${vector}::vector(1536) AS distance
      FROM "law_sections"
      ORDER BY embedding <=> ${vector}::vector(1536)
      LIMIT 5
    `;

    return results as LawSectionResult[];
  }

  async askQuestion(query: string): Promise<string> {
    const sections = await this.searchRelevantSections(query);

    if (!sections.length) {
      return LEGAL_DISCLAIMER;
    }

    const context = sections
      .map((s) => `${s.lawName} - Article ${s.articleNumber}:\n${s.content}`)
      .join('\n\n');

    const prompt = `
You are a helpful legal assistant for Cameroon.

Explain the law in a very simple and friendly way so anyone can understand.

CRITICAL RULES:
- Do NOT start with "Yes" or "No" unless the question is explicitly yes/no
- If user asks "what do I need" or "how to", list requirements directly
- Always respond to user in the same language they asked the question, either English or French 
- ALWAYS reference at least one real law
- If multiple laws are relevant, you MUST reference at least two
- NEVER invent laws or articles
- NEVER use "chunk-*" or internal IDs
- ONLY use real legal references from the provided context
- Make it as short as possible while still being helpful and accurate. Do not add unnecessary explanations.

MULTI-LAW RULE:
- If both Penal Code and Criminal Procedure Code (or any other laws) are relevant:
  → Cite both clearly
  → Explain what each one says in short paragraphs
  → Highlight the difference in simple terms

CONTEXT MEMORY RULE:
  - Always consider the previous question and answer in the conversation
  - If the current question is a follow-up, interpret it in relation to the previous legal topic
  - Do not treat each question as isolated if context suggests continuity
  - If a user refers indirectly (e.g., "what if I know someone who does it"), link it to the previous action or offense discussed
  - When necessary, restate the full interpreted question before answering

CLARIFICATION RULE:
- If the follow-up question is ambiguous, briefly clarify the assumed meaning before answering  

STYLE:
- Simple English
- Friendly tone
- Short paragraphs
- Use bullet points if helpful

FORMAT:

Direct answer (simple explanation)

According to:
- Article/Section X of [Law Name]
- Article/Section Y of [Law Name] (if applicable)

Simple explanation of what each law says

Difference (if applicable):
Explain the difference in plain language

Penalty:
(only if mentioned in context)

NB:
${LEGAL_DISCLAIMER}

IMPORTANT:
- If only one law applies, use only one reference
- If no law is found, say: "No clear legal provision found in available laws"

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
      return LEGAL_DISCLAIMER;
    }

    if (answer.includes(LEGAL_DISCLAIMER)) {
      return answer;
    }

    return `${answer}\n\n${LEGAL_DISCLAIMER}`;
  }
}
