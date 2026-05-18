/*
  Warnings:

  - You are about to drop the `source_ingestion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "source_ingestion";

-- CreateTable
CREATE TABLE "conversation_turns" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "userQuery" TEXT NOT NULL,
    "agentThought" TEXT,
    "toolsUsed" TEXT[],
    "lawSectionsRef" TEXT[],
    "response" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_memory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semantic_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_reasoning" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_reasoning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_turns_userId_idx" ON "conversation_turns"("userId");

-- CreateIndex
CREATE INDEX "conversation_turns_sessionId_idx" ON "conversation_turns"("sessionId");

-- CreateIndex
CREATE INDEX "semantic_memory_userId_idx" ON "semantic_memory"("userId");

-- CreateIndex
CREATE INDEX "semantic_memory_memoryType_idx" ON "semantic_memory"("memoryType");

-- CreateIndex
CREATE INDEX "agent_reasoning_conversationId_idx" ON "agent_reasoning"("conversationId");
