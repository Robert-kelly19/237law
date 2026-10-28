CREATE TABLE "source_ingestion" (
    "source" TEXT NOT NULL,
    "file_hash" TEXT,
    "chunk_count" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_ingestion_pkey" PRIMARY KEY ("source")
);
