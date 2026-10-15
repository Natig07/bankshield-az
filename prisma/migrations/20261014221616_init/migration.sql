-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "preferredLocale" TEXT NOT NULL DEFAULT 'az',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegulatoryDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegulatoryVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "decisionNumber" TEXT,
    "decisionDate" DATETIME,
    "effectiveFrom" DATETIME,
    "effectiveTo" DATETIME,
    "sourceUrl" TEXT NOT NULL,
    "retrievedAt" DATETIME,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verificationNotes" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RegulatoryVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "RegulatoryDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegulatoryRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,
    "section" TEXT,
    "topic" TEXT,
    "textOriginal" TEXT,
    "textTranslation" TEXT,
    "translationLabel" TEXT,
    "translationSource" TEXT,
    "applicability" TEXT,
    "requirementType" TEXT NOT NULL DEFAULT 'MANDATORY_LAW',
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RegulatoryRequirement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RegulatoryVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT,
    "requirementId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RegulatoryVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VerificationEvent_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CybersecurityControl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT,
    "source" TEXT NOT NULL DEFAULT 'INTERNAL',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RequirementControlMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requirementId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "rationale" TEXT,
    "mappedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequirementControlMapping_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RequirementControlMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "CybersecurityControl" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEngagement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuditEngagement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEngagementMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEngagementMember_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditEngagementMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditScopeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditScopeItem_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditScopeItem_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditScopeItem_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "CybersecurityControl" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ControlAssessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeItemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'NOT_TESTED',
    "notApplicableReason" TEXT,
    "justification" TEXT,
    "assessedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ControlAssessment_scopeItemId_fkey" FOREIGN KEY ("scopeItemId") REFERENCES "AuditScopeItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "controlId" TEXT,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "replacesId" TEXT,
    CONSTRAINT "EvidenceDocument_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EvidenceDocument_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "CybersecurityControl" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EvidenceDocument_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "EvidenceDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceExtraction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evidenceId" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceExtraction_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "promptVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "startedById" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "AIAnalysisRun_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AIAnalysisRun_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AISuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quotation" TEXT,
    "pageNumber" INTEGER,
    "quotationVerified" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AISuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AIAnalysisRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AISuggestion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AISuggestion_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "requirementId" TEXT,
    "sourceSuggestionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "inherentLikelihood" INTEGER,
    "inherentImpact" INTEGER,
    "residualLikelihood" INTEGER,
    "residualImpact" INTEGER,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuditFinding_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditFinding_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditFinding_sourceSuggestionId_fkey" FOREIGN KEY ("sourceSuggestionId") REFERENCES "AISuggestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditFindingHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "findingId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditFindingHistory_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RemediationAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "findingId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "actionPlan" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completionEvidenceId" TEXT,
    "completedAt" DATETIME,
    "verifiedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RemediationAction_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentSha256" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "approvalNote" TEXT,
    CONSTRAINT "ReportRecord_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryDocument_code_key" ON "RegulatoryDocument"("code");

-- CreateIndex
CREATE INDEX "RegulatoryDocument_kind_idx" ON "RegulatoryDocument"("kind");

-- CreateIndex
CREATE INDEX "RegulatoryVersion_verificationStatus_idx" ON "RegulatoryVersion"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryVersion_documentId_versionLabel_key" ON "RegulatoryVersion"("documentId", "versionLabel");

-- CreateIndex
CREATE INDEX "RegulatoryRequirement_verificationStatus_idx" ON "RegulatoryRequirement"("verificationStatus");

-- CreateIndex
CREATE INDEX "RegulatoryRequirement_topic_idx" ON "RegulatoryRequirement"("topic");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryRequirement_versionId_clauseId_key" ON "RegulatoryRequirement"("versionId", "clauseId");

-- CreateIndex
CREATE INDEX "VerificationEvent_versionId_idx" ON "VerificationEvent"("versionId");

-- CreateIndex
CREATE INDEX "VerificationEvent_requirementId_idx" ON "VerificationEvent"("requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "CybersecurityControl_code_key" ON "CybersecurityControl"("code");

-- CreateIndex
CREATE INDEX "CybersecurityControl_domain_idx" ON "CybersecurityControl"("domain");

-- CreateIndex
CREATE INDEX "RequirementControlMapping_controlId_idx" ON "RequirementControlMapping"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementControlMapping_requirementId_controlId_key" ON "RequirementControlMapping"("requirementId", "controlId");

-- CreateIndex
CREATE INDEX "AuditEngagement_status_idx" ON "AuditEngagement"("status");

-- CreateIndex
CREATE INDEX "AuditEngagementMember_userId_idx" ON "AuditEngagementMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEngagementMember_engagementId_userId_key" ON "AuditEngagementMember"("engagementId", "userId");

-- CreateIndex
CREATE INDEX "AuditScopeItem_requirementId_idx" ON "AuditScopeItem"("requirementId");

-- CreateIndex
CREATE INDEX "AuditScopeItem_controlId_idx" ON "AuditScopeItem"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditScopeItem_engagementId_requirementId_controlId_key" ON "AuditScopeItem"("engagementId", "requirementId", "controlId");

-- CreateIndex
CREATE INDEX "ControlAssessment_scopeItemId_isCurrent_idx" ON "ControlAssessment"("scopeItemId", "isCurrent");

-- CreateIndex
CREATE INDEX "ControlAssessment_status_idx" ON "ControlAssessment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ControlAssessment_scopeItemId_version_key" ON "ControlAssessment"("scopeItemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceDocument_storageKey_key" ON "EvidenceDocument"("storageKey");

-- CreateIndex
CREATE INDEX "EvidenceDocument_engagementId_idx" ON "EvidenceDocument"("engagementId");

-- CreateIndex
CREATE INDEX "EvidenceDocument_controlId_idx" ON "EvidenceDocument"("controlId");

-- CreateIndex
CREATE INDEX "EvidenceDocument_sha256_idx" ON "EvidenceDocument"("sha256");

-- CreateIndex
CREATE INDEX "EvidenceExtraction_evidenceId_pageNumber_idx" ON "EvidenceExtraction"("evidenceId", "pageNumber");

-- CreateIndex
CREATE INDEX "AIAnalysisRun_engagementId_idx" ON "AIAnalysisRun"("engagementId");

-- CreateIndex
CREATE INDEX "AIAnalysisRun_evidenceId_idx" ON "AIAnalysisRun"("evidenceId");

-- CreateIndex
CREATE INDEX "AISuggestion_runId_idx" ON "AISuggestion"("runId");

-- CreateIndex
CREATE INDEX "AISuggestion_reviewStatus_idx" ON "AISuggestion"("reviewStatus");

-- CreateIndex
CREATE INDEX "AISuggestion_requirementId_idx" ON "AISuggestion"("requirementId");

-- CreateIndex
CREATE INDEX "AuditFinding_engagementId_status_idx" ON "AuditFinding"("engagementId", "status");

-- CreateIndex
CREATE INDEX "AuditFinding_severity_idx" ON "AuditFinding"("severity");

-- CreateIndex
CREATE INDEX "AuditFindingHistory_findingId_idx" ON "AuditFindingHistory"("findingId");

-- CreateIndex
CREATE INDEX "RemediationAction_findingId_idx" ON "RemediationAction"("findingId");

-- CreateIndex
CREATE INDEX "RemediationAction_status_dueDate_idx" ON "RemediationAction"("status", "dueDate");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ReportRecord_engagementId_idx" ON "ReportRecord"("engagementId");
