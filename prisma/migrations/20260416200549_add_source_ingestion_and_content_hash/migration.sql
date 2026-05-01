-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "law_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lawName" TEXT NOT NULL,
    "articleNumber" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,

    CONSTRAINT "law_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_ingestion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_ingestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "law_sections_source_contentHash_key" ON "law_sections"("source", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "source_ingestion_source_key" ON "source_ingestion"("source");

-- CreateIndex
CREATE INDEX "idx_law_sections_embedding" ON "law_sections" USING hnsw (embedding vector_cosine_ops);
