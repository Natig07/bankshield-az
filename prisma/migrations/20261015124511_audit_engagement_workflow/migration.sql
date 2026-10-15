-- CreateTable
CREATE TABLE "AuditRequirementSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "selectedById" TEXT NOT NULL,
    "selectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatusAtSelection" TEXT NOT NULL,
    "unverifiedAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "decisionNote" TEXT,
    CONSTRAINT "AuditRequirementSelection_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditRequirementSelection_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditRequirementSelection_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuditEngagement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "auditedOrganization" TEXT NOT NULL DEFAULT '',
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
INSERT INTO "new_AuditEngagement" ("approvedAt", "approvedById", "createdAt", "createdById", "id", "periodEnd", "periodStart", "scope", "status", "title", "updatedAt") SELECT "approvedAt", "approvedById", "createdAt", "createdById", "id", "periodEnd", "periodStart", "scope", "status", "title", "updatedAt" FROM "AuditEngagement";
DROP TABLE "AuditEngagement";
ALTER TABLE "new_AuditEngagement" RENAME TO "AuditEngagement";
CREATE INDEX "AuditEngagement_status_idx" ON "AuditEngagement"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuditRequirementSelection_requirementId_idx" ON "AuditRequirementSelection"("requirementId");

-- CreateIndex
CREATE INDEX "AuditRequirementSelection_selectedById_idx" ON "AuditRequirementSelection"("selectedById");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRequirementSelection_engagementId_requirementId_key" ON "AuditRequirementSelection"("engagementId", "requirementId");
