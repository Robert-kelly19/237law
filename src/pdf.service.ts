import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  private readonly friendlyLawNames: Record<string, string> = {
    '2010-Ohada-General-Commercial-Law-en':
      'OHADA Uniform Act on General Commercial Law',
    AUPSRVE_English:
      'OHADA Uniform Act on Simplified Recovery Procedures and Enforcement Measures',
    Cameroon_Criminal_Procedure_Code_2005:
      'Cameroon Criminal Procedure Code',
    Cameroon_Labor_Code: 'Cameroon Labour Code',
    Civil_Code_Cameroon: 'Cameroonian Civil Code',
    'Civil Code': 'Cameroonian Civil Code',
    Code_civil: 'Cameroonian Civil Code',
    'Ohada-Uniform-Act-Cooperatives-en':
      'OHADA Uniform Act on Cooperative Societies',
    'Penal code eng original': 'Cameroonian Penal Code',
    'The_Civil_Registration_System_Law': 'Civil Registration System Law',
    The_constitution: 'Constitution of Cameroon',
    'law_relating_to_cybersecurity_and_cybercriminality-1':
      'Law Relating to Cybersecurity and Cybercriminality',
  };

  /**
   * Reads all PDF files from /pdfs and extracts text safely
   */
  async extractTextsFromPdfs(): Promise<{ source: string; text: string }[]> {
    const pdfsDir = path.join(process.cwd(), 'pdfs');

    if (!fs.existsSync(pdfsDir)) {
      this.logger.warn(
        '[PdfService] /pdfs folder not found. Skipping ingestion.',
      );
      return [];
    }

    const files = fs.readdirSync(pdfsDir).filter((f) => f.endsWith('.pdf'));
    this.logger.log(`[PdfService] Found ${files.length} PDF files to process`);

    const results: { source: string; text: string }[] = [];

    for (const file of files) {
      const filePath = path.join(pdfsDir, file);

      try {
        this.logger.log(`[PdfService] Processing: ${file}`);
        const dataBuffer = fs.readFileSync(filePath);

        const parser = new PDFParse({ data: dataBuffer });
        const data = await parser.getText();
        await parser.destroy();

        const cleanedText = this.cleanText(data.text);
        this.logger.log(
          `[PdfService] Extracted ${cleanedText.length} characters from ${file}`,
        );

        results.push({
          source: file,
          text: cleanedText,
        });
      } catch (error) {
        this.logger.error(`[PdfService] Error parsing ${file}:`, error);
      }
    }

    return results;
  }

  /**
   * Clean extracted PDF text (minimal cleaning - preserve structure)
   */
  private cleanText(text: string): string {
    return text.replace(/\r/g, '').replace(/\n\n+/g, '\n').trim();
  }

  /**
   * Smart chunking that preserves sections and articles
   * Ensures headers are always included with content chunks
   */
  chunkText(text: string, chunkSize = 500): string[] {
    // Split by sections first
    const sections = text.split(
      /(?=(?:SECTION|ARTICLE|Article|Art\.|CHAPTER|Chapter)\s+[\dA-Za-z]+)/i,
    );

    const chunks: string[] = [];

    for (const section of sections) {
      if (section.trim().length === 0) continue;

      // Extract header (first line)
      const lines = section.split('\n');
      const header = lines[0]?.trim() || '';

      const sectionWordCount = section.split(/\s+/).filter(Boolean).length;

      // If section is small in words, keep header with content as one chunk
      if (sectionWordCount <= chunkSize * 1.2) {
        chunks.push(section.trim());
        continue;
      }

      // For large sections: ensure header is prepended to each chunk
      const sentences = section.split(/(?<=[.!?])\s+/).filter(Boolean);
      let currentChunk: string[] = header ? [header] : [];
      let currentLength = header.split(/\s+/).length;

      for (const sentence of sentences) {
        const sentenceLength = sentence.split(/\s+/).length;

        if (
          currentLength + sentenceLength > chunkSize &&
          currentChunk.length > 1
        ) {
          chunks.push(currentChunk.join(' ').trim());
          // Reset with header for next chunk
          currentChunk = header ? [header] : [];
          currentLength = header.split(/\s+/).length;
        }

        currentChunk.push(sentence);
        currentLength += sentenceLength;
      }

      // Push final chunk if it has content beyond just the header
      if (currentChunk.length > 1 || (currentChunk.length === 1 && !header)) {
        chunks.push(currentChunk.join(' ').trim());
      }
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * Extract metadata from file + text
   */
  extractMetadata(
    text: string,
    source: string,
    chunkIndex: number,
  ): { lawName: string; articleNumber: string } {
    const lawName = this.getFriendlyLawName(source);

    // More aggressive section/article matching
    const articleMatch =
      text.match(/(?:SECTION|ARTICLE|Article|Art\.)\s+([\dA-Za-z]+)/i) ||
      text.match(/(?:PART|Chapter)\s+([IVXLCDM]+)/i);

    return {
      lawName,
      articleNumber: articleMatch ? articleMatch[1] : `chunk-${chunkIndex}`,
    };
  }

  private getFriendlyLawName(source: string): string {
    const baseName = path.parse(source).name;
    const normalized = baseName.toLowerCase().replace(/[-_\s]+/g, ' ').trim();

    if (
      normalized.includes('civil code') ||
      normalized.includes('code civil')
    ) {
      return 'Cameroonian Civil Code';
    }

    return this.friendlyLawNames[baseName] || baseName;
  }
}
