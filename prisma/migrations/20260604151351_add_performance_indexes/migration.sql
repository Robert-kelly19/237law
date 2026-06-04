-- prisma-execute-without-transaction
-- Add HNSW vector index for fast approximate nearest neighbor search
CREATE INDEX CONCURRENTLY law_sections_embedding_hnsw 
ON law_sections USING hnsw (embedding vector_cosine_ops);

-- Add index on content_hash for deduplication lookups
CREATE INDEX CONCURRENTLY law_sections_content_hash_idx 
ON law_sections(content_hash);

-- Add index on source for ingestion tracking
CREATE INDEX CONCURRENTLY law_sections_source_idx 
ON law_sections(source);

-- Add composite index for conversation history queries (userId, sessionId, createdAt)
CREATE INDEX CONCURRENTLY conversation_turns_user_session_time_idx 
ON conversation_turns(userId, sessionId, "createdAt" DESC);

-- Add index for semantic memory lookups (userId, memoryType, importance)
CREATE INDEX CONCURRENTLY semantic_memory_user_type_importance_idx 
ON semantic_memory(userId, memoryType, importance DESC);

-- Add index for semantic memory key lookups
CREATE INDEX CONCURRENTLY semantic_memory_user_key_idx 
ON semantic_memory(userId, key);

-- Add index for agent reasoning queries
CREATE INDEX CONCURRENTLY agent_reasoning_conversation_step_idx 
ON agent_reasoning(conversationId, step);
