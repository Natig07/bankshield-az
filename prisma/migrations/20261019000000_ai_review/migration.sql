-- CreateTable
CREATE TABLE "AiReviewRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "inputSummary" TEXT NOT NULL,
    "suggestionCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiReviewRun_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiReviewRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiReviewSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "requirementId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "recommendedActions" TEXT NOT NULL,
    "verificationSteps" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiReviewSuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiReviewRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiReviewSuggestion_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiReviewSuggestion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiReviewSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiReviewRun_engagementId_createdAt_idx" ON "AiReviewRun"("engagementId", "createdAt");

-- CreateIndex
CREATE INDEX "AiReviewSuggestion_runId_idx" ON "AiReviewSuggestion"("runId");

-- CreateIndex
CREATE INDEX "AiReviewSuggestion_engagementId_reviewStatus_idx" ON "AiReviewSuggestion"("engagementId", "reviewStatus");
