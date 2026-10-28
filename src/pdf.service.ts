import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /**
   * Reads all PDF files from /pdfs and extracts text safely
   */
  async extractTextsFromPdfs(): Promise<{ source: string; text: string }[]> {
    const files = this.listPdfFiles();
    const results: { source: string; text: string }[] = [];

    for (const source of files) {
      try {
        const buffer = this.readPdfFile(source);
        const text = await this.extractTextFromPdfBuffer(buffer, source);
        results.push({ source, text });
      } catch (error) {
        this.logger.error(
          `[PdfService] Error reading ${source}; extracted 0 characters`,
          error,
        );
        results.push({ source, text: '' });
      }
    }

    return results;
  }

  listPdfFiles(): string[] {
    const pdfsDir = path.join(process.cwd(), 'pdfs');

    if (!fs.existsSync(pdfsDir)) {
      this.logger.warn(
        '[PdfService] /pdfs folder not found. Skipping ingestion.',
      );
      return [];
    }

    const files = fs.readdirSync(pdfsDir).filter((f) => f.endsWith('.pdf'));
    this.logger.log(`[PdfService] Found ${files.length} PDF files to process`);
    return files;
  }

  readPdfFile(source: string): Buffer {
    return fs.readFileSync(path.join(process.cwd(), 'pdfs', source));
  }

  async extractTextFromPdfBuffer(
    buffer: Buffer,
    source: string,
  ): Promise<string> {
    let extractedText = '';
    let parser: PDFParse | undefined;

    try {
      this.logger.log(`[PdfService] Processing: ${source}`);

      parser = new PDFParse({ data: buffer });
      const data = await parser.getText();
      extractedText = this.cleanText(data.text);
    } catch (error) {
      this.logger.error(
        `[PdfService] Error parsing ${source}; extracted 0 characters`,
        error,
      );
    } finally {
      if (parser) {
        try {
          await parser.destroy();
        } catch (error) {
          this.logger.error(
            `[PdfService] Error closing parser for ${source}`,
            error,
          );
          extractedText = '';
        }
      }
    }

    this.logger.log(
      `[PdfService] Extracted ${extractedText.length} characters from ${source}`,
    );
    return extractedText;
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
    const sections = text.split(/(?=(?:SECTION|ARTICLE|CHAPTER)\s+\d+)/i);

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
    const lawName = path.parse(source).name;

    // More aggressive section/article matching
    const articleMatch =
      text.match(/(?:SECTION|Article)\s+(\d+)/i) ||
      text.match(/(?:PART|Chapter)\s+([IVXLCDM]+)/i) ||
      text.match(/(?:SECTION|Article)\s+([A-Z])/i);

    return {
      lawName,
      articleNumber: articleMatch ? articleMatch[1] : `chunk-${chunkIndex}`,
    };
  }
}
