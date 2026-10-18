# BankShield AZ

Bilingual (Azerbaijani and English) cybersecurity compliance and audit support platform for an Azerbaijani bank's internal cybersecurity team. Single Next.js application. MVP in development.

**Important:** this is a compliance support tool. It does not guarantee legal compliance, does not replace professional auditors, and is not approved or endorsed by the Central Bank of Azerbaijan. No regulatory content is treated as authoritative until a named human reviewer marks it `VERIFIED` (see REGULATORY_SOURCES.md).

## Current state

The bilingual UI requires an active account. Login and logout use Argon2id verification and revocable SQLite-backed sessions. Administrators can manage users, the security control catalogue, and requirement mappings. The Regulatory Library supports source, version, and requirement maintenance with review history. Audit engagements support scoped access, auditor assignment, requirement selection, status history, control assessment revisions, approval, and assessment-specific references to existing evidence metadata. Evidence upload, review and authorized download, a Risk Register, and findings with remediation tracking are implemented and covered by tests on isolated databases. Reporting and AI analysis are not implemented. Nothing has been verified in a browser or end-to-end; see NEXT_STEPS.md for the manual checklist.

## Run it locally

Requirements: Node.js 22 or newer and npm.

```bash
cd bankshield-az
npm install
```

Create `.env` from the example only if it does not already exist, then apply the checked-in migrations:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npx prisma migrate deploy
```

The required environment variable is `DATABASE_URL`; `prisma.config.ts` loads it from `.env`. The default points to `data/dev.db` under the project root. `.env` and SQLite files are ignored by Git. Sessions use random opaque tokens stored only as SHA-256 hashes in the database, so there is no `SESSION_SECRET`.

## Create the first administrator

Bootstrap is a one-time local CLI operation—not a web endpoint. It refuses to run when `NODE_ENV=production`, requires a terminal with password echo disabled, and will fail if an administrator or the durable bootstrap marker already exists. Before starting the app in production, run the command against the intended database in a controlled setup environment:

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL = "admin@your-bank.example"
$env:BOOTSTRAP_ADMIN_NAME = "BankShield Administrator"
npm run auth:bootstrap
Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL
Remove-Item Env:BOOTSTRAP_ADMIN_NAME
```

The command prompts for the administrator password without echoing it; use a unique password of at least 12 characters. Do not place the password in source control, command history, `.env`, or logs. Keep the bootstrap command out of the production application startup path. After bootstrap, run:

```bash
npm run dev
```

Open http://localhost:3000. Sign in at `/az/login` or `/en/login`; an unauthenticated visit to the application redirects to the matching login page.

## Production build

```bash
npm run build
npm start
```

## Checks

```bash
npm run typecheck   # generates Next route types, then tsc
npm run lint
npm test            # unit tests (node:test via tsx)
npm run build
npm run db:inspect  # read-only: table row counts and migration state of DATABASE_URL
```

Node 22.13 or newer is required (`engines`).

## Database commands

The Prisma 7.10 CLI configuration loads `DATABASE_URL` from `.env`. For development, validate and generate the client, then apply schema changes with `migrate dev`; deployment uses `migrate deploy`:

```bash
npm run db:validate
npm run db:generate
npm run db:migrate
```

The local database is `data/dev.db`; generated client files are under `src/generated/prisma`, and additive migrations are under `prisma/migrations`. Authentication, Regulatory Library, Audit Engagement, and control/assessment integration tests use isolated temporary SQLite databases, not the development database.

## Role permissions

- **Administrator:** all application permissions, including user management.
- **Auditor:** manage engagements, assessments, findings, and reports; review evidence; read regulatory and risk records. Cannot upload evidence or accept risks.
- **Security Analyst:** manage evidence, control assessments and risks, carry out remediation actions (`findings:remediate`), and read permitted audit and finding records. Cannot review evidence, approve their own assessments, verify actions or manage findings.
- **Read-Only Reviewer:** read permitted records only.

Control catalogue and requirement-mapping management (`controls:manage`) is Administrator-only. The Auditor and Security Analyst may assess controls (`controls:assess`) only within engagements they can access. Every application page checks its permission on the server. Every mutating Server Action checks the permission again; engagement data access must also go through the membership-aware DAL. The sidebar is only a convenience, not an authorization control.

Login lockout triggers after five failed passwords for the same account and lasts 15 minutes. This reduces repeated targeted attempts; deployments exposed beyond a trusted internal network should also apply request-rate limits at their trusted reverse proxy/firewall.

To test the UI locally after creating the administrator, sign in at `/az/login` or `/en/login`; use the header's sign-out action to invalidate that session. The admin page is available to administrators at `/az/admin` and `/en/admin`.

## Regulatory Library

The Regulatory Library reads source documents, versions, requirements, and verification history from SQLite. Administrators can add or edit source metadata, append source versions, and add or edit requirement records. New versions and requirements always start `PENDING_VERIFICATION`; verification changes require a non-empty review note and are written to `VerificationEvent`. The allowed path is pending → legal review → verified, with a return to pending from legal review and superseding verified records. Requirements cannot be marked verified until their parent version is verified.

Version and requirement content becomes read-only once legal review starts; return it to pending with a review note before correcting it. Create a new version rather than overwriting verified content. The interface has no delete operation, protecting source records referenced by existing audit records. Enter only information checked against the authoritative source. Unknown dates, applicability, or clause text should be left blank. Do not treat a translation as official unless its label and provenance are recorded.

Only Administrators have `regulatory:manage`; all other roles can read the library but cannot mutate records. This policy is enforced by every Server Action, independently of whether controls are shown in the UI.

## Audit engagements

The bilingual Audit Engagements area reads real records from SQLite and supports title, audited organisation, scope, audit-period dates, assigned auditors, and a constrained status workflow. Search and status filters are server-side. Auditors can create engagements assigned to themselves; Administrators may assign or reassign an active Auditor. The creator and current assigned auditor can access the engagement; Administrators can access all engagements. Server Actions independently check `audit:manage` and engagement access. Only Administrators can change auditor assignment.

The status path is Draft → In progress → In review → Approved → Archived. In-review engagements may return to In progress; Draft or In-progress engagements may be archived. Changes and assignments append `AuditEvent` records, including status changes. Metadata edits update only engagement metadata and do not remove assessments, findings, evidence, or historical rows.

Requirements are selected from non-demo Regulatory Library records. Selecting a non-verified requirement requires explicit acknowledgement and a decision note; the selection stores who made it, when, the requirement's verification status at selection time, and the note. This is not a legal verification or applicability decision. Existing requirement-to-control mappings are copied into assessment scope items when available.

## Security controls and assessments

The Security Controls page is searchable and lists controls with their mapped requirements, source provenance, clause/topic, current verification state, and rationale. Administrators can create/update controls and add mappings with a substantive rationale. The interface does not remove mappings: the schema has no mapping history or deactivation state, and the relation cascades on deletion. A new mapping does not silently alter an existing `AuditScopeItem`; the current mappings are used when a requirement is selected for a new engagement.

On an engagement detail page, Auditor/Security Analyst users with `controls:assess` and engagement access can record a new `ControlAssessment` revision for each scope item. Older revisions remain visible. `NOT_APPLICABLE` requires a reason. Approval is a separate server-enforced operation: `NOT_TESTED` cannot be approved; reviewer justification and evidence linked to that exact assessment are required, except for `NOT_APPLICABLE`. Each revision can reference existing evidence metadata belonging to the same engagement and control. The UI does not read or serve files.

Migration `20261015191722_control_assessment_evidence` adds `ControlAssessmentEvidence` and a SQLite partial unique index that enforces at most one current assessment per scope item without preventing multiple historical revisions. It was applied additively; the existing development database had no duplicated current assessment rows, and no application records were seeded or changed.

Assessment approval requires an approver different from the assessor. Assessment evidence links identify selected evidence records; they do not verify file contents or establish a compliance conclusion. Mapping does not change regulatory verification state. The dashboard does not show a compliance percentage.

The additive migration `20261015124511_audit_engagement_workflow` adds the audited-organisation column and the unique requirement-selection record. Existing engagement rows are preserved; older rows receive an empty organisation value until an authorised user updates their metadata. Do not reset or recreate the database to apply it.

## AI Review (Gemini)

The AI Review page analyses an engagement's scope items, findings and linked risks against the regulatory requirements in scope and stores the results as **pending hypotheses** that an auditor accepts or rejects. Accepting records a decision only; it never changes findings, risks, assessments or severities.

It is disabled until a key is configured. Add these to your own `.env` (never commit it) and restart the app:

```
GEMINI_API_KEY="your-key-from-Google-AI-Studio"
GEMINI_MODEL="gemini-3.8-flash"   # optional
```

Selected records are sent to Google's Gemini API (requirement and control text, assessment status, evidence metadata only, findings, remediation plans, linked risks). Evidence file contents, user names and emails, passwords and secrets are not sent. Review your organisation's data-protection and outsourcing rules before enabling it with real bank data.

## Evidence

Analysts upload evidence to an engagement that is in Draft or In progress (PDF, Office documents, images, text or CSV; maximum 10 MB; the real file signature must match the extension). Files are stored under `EVIDENCE_STORAGE_DIR` (default `storage-local/`, gitignored) with server-generated opaque names; the original filename is display-only. Auditors review evidence, and the reviewer must differ from the uploader. Download goes through `/api/evidence/[evidenceId]`, which checks the session and engagement access and sends the file as an attachment with `nosniff`. There is no malware scanning; treat uploaded files as untrusted and back up the storage folder together with the database.

## Risk register

`/risks` lists risks with severity bands computed from likelihood × impact (1–5 scale; scores are never stored) and a note saying whether the inherent or residual score is shown. Analysts and administrators create and edit risks, assets, control links and treatment actions. Accepting a risk is administrator-only and needs a justification, residual scores and a future review date. Closing needs every treatment action finished. Each change appends a history row. Migration `20261016100000_risk_register` is additive.

## Findings and remediation

Auditors record findings in engagements that are In progress or In review, plan remediation actions, and move a finding Open → In remediation → Ready for review → Closed. Analysts carry the actions through In progress → Completed (optionally citing same-engagement evidence); an auditor verifies each action and an auditor other than the finding's creator closes it. There is no schema change for this feature. History and audit events are appended for every change.

## Project documents

- ARCHITECTURE.md: stack, layout, security model, data model, scoring rules
- PROJECT_PLAN.md: phases and acceptance criteria
- REGULATORY_SOURCES.md: source inventory and verification tasks
- PROGRESS.md and NEXT_STEPS.md: current status and the exact next step

## Rules for demo data

Demo data must be explicitly fictional and flagged. No real bank names, customer records, or invented regulatory clauses.
