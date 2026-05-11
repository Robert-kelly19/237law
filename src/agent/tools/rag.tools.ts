// tools/rag.tools.ts
import { createTool } from '@voltagent/core';
import { z } from 'zod';
import { RagService } from '../../rag.service';

// ─── tool factories ───────────────────────────────────────────────────────────

export function createSearchTool(ragService: RagService) {
  return createTool({
    name: 'search_sections',
    description:
      'Searches the law database for sections relevant to a query using vector similarity. Returns the top matching law articles.',
    parameters: z.object({
      query: z
        .string()
        .trim()
        .min(1, 'Query must not be empty')
        .describe('The legal question or topic to search for.'),
    }),
    outputSchema: z.array(
      z.object({
        id: z.string(),
        lawName: z.string(),
        articleNumber: z.string(),
        content: z.string(),
        source: z.string(),
        distance: z.number(),
      }),
    ),
    execute: async ({ query }) => {
      return ragService.searchRelevantSections(query);
    },
  });
}

export function createAskQuestionTool(ragService: RagService) {
  return createTool({
    name: 'ask_question',
    description:
      'Answers a legal question about Cameroonian law by searching relevant law sections and generating a structured legal response.',
    parameters: z.object({
      query: z
        .string()
        .trim()
        .min(1, 'Query must not be empty')
        .describe('The legal question from the user in plain language.'),
    }),
    outputSchema: z.string().describe('A structured legal answer.'),
    execute: async ({ query }) => {
      return ragService.askQuestion(query);
    },
  });
}
