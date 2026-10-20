CREATE TABLE "source_ingestion_lock" (
    "source" TEXT NOT NULL,
    "owner_token" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "source_ingestion_lock_pkey" PRIMARY KEY ("source")
);
