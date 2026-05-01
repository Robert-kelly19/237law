/*
  Warnings:

  - You are about to drop the column `contentHash` on the `law_sections` table. All the data in the column will be lost.
  - You are about to drop the `source_ingestion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "idx_law_sections_embedding";

-- DropIndex
DROP INDEX "law_sections_source_contentHash_key";

-- AlterTable
ALTER TABLE "law_sections"
RENAME COLUMN "contentHash" TO "content_hash";
