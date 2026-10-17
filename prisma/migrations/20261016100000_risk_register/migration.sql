-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "criticality" TEXT NOT NULL DEFAULT 'MEDIUM',
    "ownerName" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "assetId" TEXT,
    "ownerName" TEXT NOT NULL,
    "inherentLikelihood" INTEGER NOT NULL,
    "inherentImpact" INTEGER NOT NULL,
    "residualLikelihood" INTEGER,
    "residualImpact" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "treatment" TEXT,
    "acceptanceJustification" TEXT,
    "acceptedById" TEXT,
    "acceptedAt" DATETIME,
    "reviewDate" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Risk_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskControl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riskId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskControl_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RiskControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "CybersecurityControl" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskTreatmentAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerName" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RiskTreatmentAction_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riskId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskHistory_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE INDEX "Asset_assetType_idx" ON "Asset"("assetType");

-- CreateIndex
CREATE INDEX "Asset_isActive_idx" ON "Asset"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Risk_code_key" ON "Risk"("code");

-- CreateIndex
CREATE INDEX "Risk_status_idx" ON "Risk"("status");

-- CreateIndex
CREATE INDEX "Risk_category_idx" ON "Risk"("category");

-- CreateIndex
CREATE INDEX "Risk_assetId_idx" ON "Risk"("assetId");

-- CreateIndex
CREATE INDEX "RiskControl_controlId_idx" ON "RiskControl"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskControl_riskId_controlId_key" ON "RiskControl"("riskId", "controlId");

-- CreateIndex
CREATE INDEX "RiskTreatmentAction_riskId_idx" ON "RiskTreatmentAction"("riskId");

-- CreateIndex
CREATE INDEX "RiskTreatmentAction_status_dueDate_idx" ON "RiskTreatmentAction"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RiskHistory_riskId_revision_key" ON "RiskHistory"("riskId", "revision");
