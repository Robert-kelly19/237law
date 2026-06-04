CREATE INDEX IF NOT EXISTS law_sections_embedding_hnsw
ON law_sections USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS law_sections_content_hash_idx
ON law_sections(content_hash);

CREATE INDEX IF NOT EXISTS law_sections_source_idx
ON law_sections(source);

CREATE INDEX IF NOT EXISTS conversation_turns_user_session_time_idx
ON conversation_turns("userId", "sessionId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS semantic_memory_user_type_importance_idx
ON semantic_memory("userId", "memoryType", importance DESC);

CREATE INDEX IF NOT EXISTS semantic_memory_user_key_idx
ON semantic_memory("userId", key);

CREATE INDEX IF NOT EXISTS agent_reasoning_conversation_step_idx
ON agent_reasoning("conversationId", step);