import { Injectable, Logger } from '@nestjs/common';

export interface Citation {
  lawName: string;
  articleNumber: string;
  text: string;
  format: string;
}

export interface ToolResult {
  success: boolean;
  data: any;
  reasoning: string;
}

@Injectable()
export class CitationTool {
  private readonly logger = new Logger(CitationTool.name);

  /**
   * Format a single law section citation
   */
  formatCitation(lawSection: any): ToolResult {
    try {
      this.logger.debug(
        `Formatting citation for ${lawSection.lawName} Article ${lawSection.articleNumber}`,
      );

      const citation: Citation = {
        lawName: lawSection.lawName,
        articleNumber: lawSection.articleNumber,
        text: lawSection.content,
        format: this.generateCitationFormat(lawSection),
      };

      return {
        success: true,
        data: citation,
        reasoning: `Successfully formatted citation for ${lawSection.lawName} Article ${lawSection.articleNumber}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to format citation: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: null,
        reasoning: `Failed to format citation: ${error.message}`,
      };
    }
  }

  /**
   * Generate a list of citations from multiple law sections
   */
  generateCitationList(lawSections: any[]): ToolResult {
    try {
      this.logger.debug(`Generating citation list for ${lawSections.length} sections`);

      const citations: Citation[] = lawSections.map((section) => ({
        lawName: section.lawName,
        articleNumber: section.articleNumber,
        text: section.content,
        format: this.generateCitationFormat(section),
      }));

      // Generate formatted bibliography
      const bibliography = this.generateBibliography(citations);

      return {
        success: true,
        data: {
          citations,
          bibliography,
        },
        reasoning: `Generated ${citations.length} citations with formatted bibliography`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate citation list: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: null,
        reasoning: `Failed to generate citation list: ${error.message}`,
      };
    }
  }

  /**
   * Validate a citation format
   */
  validateCitation(lawName: string, articleNumber: string): ToolResult {
    try {
      this.logger.debug(
        `Validating citation: ${lawName} Article ${articleNumber}`,
      );

      // Basic validation
      if (!lawName || lawName.trim().length === 0) {
        return {
          success: false,
          data: {
            valid: false,
            error: 'Law name cannot be empty',
          },
          reasoning: 'Citation validation failed: empty law name',
        };
      }

      if (!articleNumber || articleNumber.trim().length === 0) {
        return {
          success: false,
          data: {
            valid: false,
            error: 'Article number cannot be empty',
          },
          reasoning: 'Citation validation failed: empty article number',
        };
      }

      // Check for valid format (e.g., "Article 174" or "174")
      const isValidFormat =
        /^(Article\s+)?[\d\w\-\.\/]+(\s*(bis|ter|quater))?$/i.test(
          articleNumber,
        );

      return {
        success: true,
        data: {
          valid: isValidFormat,
          lawName,
          articleNumber,
          format: `${lawName}, Article ${this.cleanArticleNumber(articleNumber)}`,
        },
        reasoning: isValidFormat
          ? `Citation is valid: ${lawName}, Article ${this.cleanArticleNumber(articleNumber)}`
          : `Citation format may be unusual: ${lawName}, Article ${articleNumber}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to validate citation: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: null,
        reasoning: `Failed to validate citation: ${error.message}`,
      };
    }
  }

  /**
   * Generate inline citation (for use in text)
   */
  generateInlineCitation(lawSection: any): string {
    return `${lawSection.lawName}, Article ${this.cleanArticleNumber(lawSection.articleNumber)}`;
  }

  /**
   * Generate full citation (for bibliography)
   */
  generateFullCitation(lawSection: any): string {
    return `${lawSection.lawName}, Article ${this.cleanArticleNumber(lawSection.articleNumber)} (${lawSection.source})`;
  }

  /**
   * Clean article number format
   */
  private cleanArticleNumber(articleNumber: string): string {
    return articleNumber
      .replace(/^Article\s+/i, '')
      .trim();
  }

  /**
   * Generate citation format
   */
  private generateCitationFormat(lawSection: any): string {
    const lawName = lawSection.lawName;
    const articleNum = this.cleanArticleNumber(lawSection.articleNumber);
    const source = lawSection.source || 'Cameroon';

    return `${lawName}, Article ${articleNum} (${source})`;
  }

  /**
   * Generate formatted bibliography
   */
  private generateBibliography(citations: Citation[]): string {
    // Remove duplicates and sort
    const uniqueCitations = Array.from(
      new Map(
        citations.map((c) => [
          `${c.lawName}-${c.articleNumber}`,
          c,
        ]),
      ).values(),
    );

    return uniqueCitations
      .map((c, idx) => `[${idx + 1}] ${c.format}`)
      .join('\n');
  }

  /**
   * Extract citations from text
   */
  extractCitationsFromText(text: string): ToolResult {
    try {
      // Pattern to match citations like "Penal Code, Article 174" or "Article 296"
      const citationPattern =
        /([A-Za-z\s]+),?\s+(?:Articles?|Art\.)\s+([\d\w\-\.\/\s]+(?:bis|ter)?)/gi;

      const citations: any[] = [];
      let match;

      while ((match = citationPattern.exec(text)) !== null) {
        citations.push({
          lawName: match[1].trim(),
          articleNumber: match[2].trim(),
          format: `${match[1].trim()}, Article ${match[2].trim()}`,
        });
      }

      return {
        success: true,
        data: citations,
        reasoning: `Extracted ${citations.length} citations from text`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to extract citations: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: [],
        reasoning: `Failed to extract citations: ${error.message}`,
      };
    }
  }
}
