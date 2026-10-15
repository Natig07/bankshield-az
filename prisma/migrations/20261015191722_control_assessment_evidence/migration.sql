-- CreateTable
CREATE TABLE "ControlAssessmentEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ControlAssessmentEvidence_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ControlAssessment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ControlAssessmentEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ControlAssessmentEvidence_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ControlAssessmentEvidence_evidenceId_idx" ON "ControlAssessmentEvidence"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlAssessmentEvidence_assessmentId_evidenceId_key" ON "ControlAssessmentEvidence"("assessmentId", "evidenceId");

-- SQLite's partial unique index enforces at most one current assessment while
-- allowing any number of historical rows with isCurrent = false.
CREATE UNIQUE INDEX "ControlAssessment_one_current_per_scope"
ON "ControlAssessment"("scopeItemId")
WHERE "isCurrent" = 1;
