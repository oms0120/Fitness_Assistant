-- CreateTable
CREATE TABLE "LlmUsageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "blockedCount" INTEGER NOT NULL DEFAULT 1,
    "dayKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LlmUsageRecord_userId_createdAt_idx" ON "LlmUsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmUsageRecord_createdAt_idx" ON "LlmUsageRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LlmUsageRecord_userId_dayKey_key" ON "LlmUsageRecord"("userId", "dayKey");
