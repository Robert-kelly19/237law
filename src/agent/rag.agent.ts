// agents/rag.agent.ts
import { Agent, Memory } from '@voltagent/core';
import { openai } from '@ai-sdk/openai';
import { LibSQLMemoryAdapter } from '@voltagent/libsql';
import { RagService } from '../rag.service';
import {
  createIngestTool,
  createSearchTool,
  createAskQuestionTool,
} from './tools/rag.tools';

export function createRagAgent(ragService: RagService) {
  const memory = new Memory({
    storage: new LibSQLMemoryAdapter({
      url: process.env.MEMORY_DATABASE_URL || 'file:memory.db',
    }),
  });

  return new Agent({
    name: 'rag-agent',
    instructions: `
      You are a Cameroonian legal assistant sub-agent.
      You have three tools available:
      - ingest_pdfs: call this once at startup to load all law PDFs into the database.
      - search_sections: use this to find relevant law articles for a topic.
      - ask_question: use this to answer a user's legal question end-to-end.
      Always use ask_question for user-facing legal queries.
    `,
    model: openai('gpt-4o-mini'),
    memory,
    tools: [
      createIngestTool(ragService),
      createSearchTool(ragService),
      createAskQuestionTool(ragService),
    ],
  });
}
