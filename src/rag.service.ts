import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from './prisma.service';
import { EmbeddingService } from './embedding.service';
import { PdfService } from './pdf.service';
import OpenAI from 'openai';
import { Logger } from '@nestjs/common';

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
  private readonly logger = new Logger(RagService.name);

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
          INSERT INTO law_sections ("lawName","articleNumber",content,source,content_hash,embedding)
          VALUES (${lawName},${articleNumber},${texts[i]},${source},${contentHash},${vector}::vector(1536))
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

  private computeContentHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
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

NB: This response is provided for informational purposes only and does not constitute legal advice.
For proper legal assistance, please consult a qualified lawyer via the contact details in our bio.`;
    }

    const context = sections
      .map((s) => `${s.lawName} - Article ${s.articleNumber}:\n${s.content}`)
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
- Avoid legal jargon. If a legal term must be used, define it immediately in plain language.
- Be warm and reassuring — many users may be stressed or intimidated.

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
For proper legal assistance, please consult a qualified lawyer via the contact details in our bio..`;
    }

    if (
      answer.includes(
        'NB: This response is provided for informational purposes only and does not constitute legal advice.For proper legal assistance, please consult a qualified lawyer via the contact details in our bio..`;',
      )
    ) {
      return answer;
    }
    this.logger.log(`Formatted answer: ${answer}`);
    return `${answer}`;
  }
}
