import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class PdfService {
  /**
   * Reads all PDF files from /pdfs and extracts text safely
   */
  async extractTextsFromPdfs(): Promise<{ source: string; text: string }[]> {
    const pdfsDir = path.join(process.cwd(), 'pdfs');

    // Prevent crash if folder doesn't exist
    if (!fs.existsSync(pdfsDir)) {
      console.warn('[PdfService] /pdfs folder not found. Skipping ingestion.');
      return [];
    }

    const files = fs.readdirSync(pdfsDir).filter(f => f.endsWith('.pdf'));

    const results: { source: string; text: string }[] = [];

    for (const file of files) {
      const filePath = path.join(pdfsDir, file);

      try {
        const dataBuffer = fs.readFileSync(filePath);

        const parser = new PDFParse({ data: dataBuffer });
        const data = await parser.getText();
        await parser.destroy();

        const cleanedText = this.cleanText(data.text);

        results.push({
          source: file,
          text: cleanedText,
        });
      } catch (error) {
        console.error(`[PdfService] Error parsing ${file}:`, error);
      }
    }

    return results;
  }

  /**
   * Clean extracted PDF text
   */
  private cleanText(text: string): string {
    return text
      .replace(/\r/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Improved chunking (sentence-aware, RAG-friendly)
   */
  chunkText(text: string, chunkSize = 400, overlap = 50): string[] {
    const sentences = this.splitIntoSentences(text);

    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const sentence of sentences) {
      const sentenceLength = sentence.split(' ').length;

      if (currentLength + sentenceLength > chunkSize) {
        chunks.push(currentChunk.join(' '));

        // overlap: keep last few sentences
        currentChunk = currentChunk.slice(-Math.floor(overlap / 10));
        currentLength = currentChunk.join(' ').split(' ').length;
      }

      currentChunk.push(sentence);
      currentLength += sentenceLength;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  /**
   * Sentence splitter (simple but effective)
   */
  private splitIntoSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);
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

    const articleMatch =
      text.match(/Article\s+(\d+|[IVXLCDM]+)/i) ||
      text.match(/Section\s+(\d+)/i);

    return {
      lawName,
      articleNumber: articleMatch ? articleMatch[1] : `chunk-${chunkIndex}`,
    };
  }
}