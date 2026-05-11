import { Agent, Memory } from '@voltagent/core';
import { openai } from '@ai-sdk/openai';
import { LibSQLMemoryAdapter } from '@voltagent/libsql';
import { RagService } from '../rag.service';
import { createAskQuestionTool, createSearchTool } from './tools/rag.tools';

export function createRagAgent(ragService: RagService) {
  const memoryDbUrl = process.env.MEMORY_DATABASE_URL;
  if (!memoryDbUrl) {
    throw new Error(
      'MEMORY_DATABASE_URL environment variable is required but not set',
    );
  }
  const memory = new Memory({
    storage: new LibSQLMemoryAdapter({ url: memoryDbUrl }),
  });

  return new Agent({
    name: 'rag-agent',
    instructions: `
      You are a Cameroonian legal assistant sub-agent.
      You have two tools available:
      - search_sections: use this to find relevant law articles for a topic.
      - ask_question: use this to answer a user's legal question end-to-end.
      Always use ask_question for user-facing legal queries.
    `,
    model: openai('gpt-4o-mini'),
    memory,
    tools: [createAskQuestionTool(ragService), createSearchTool(ragService)],
  });
}
