-- DropIndex
DROP INDEX "idx_law_sections_embedding";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_law_sections_embedding" ON "law_sections" USING hnsw (embedding vector_cosine_ops);
