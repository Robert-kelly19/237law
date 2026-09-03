-- CreateTable
CREATE TABLE "platform_users" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_users_externalId_idx" ON "platform_users"("externalId");

-- CreateIndex
CREATE INDEX "platform_users_channel_idx" ON "platform_users"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_externalId_channel_key" ON "platform_users"("externalId", "channel");
