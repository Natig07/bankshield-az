# BankShield AZ

Bilingual (Azerbaijani and English) cybersecurity compliance and audit support platform for an Azerbaijani bank's internal cybersecurity team. Single Next.js application. MVP in development.

**Important:** this is a compliance support tool. It does not guarantee legal compliance, does not replace professional auditors, and is not approved or endorsed by the Central Bank of Azerbaijan. No regulatory content is treated as authoritative until a named human reviewer marks it `VERIFIED` (see REGULATORY_SOURCES.md).

## Current state

The bilingual UI now requires an active account to access the application. Login and logout use Argon2id password verification and revocable SQLite-backed sessions. Administrators can create users, assign roles, and disable accounts. The Regulatory Library supports source, version, and requirement maintenance with review history. Audit engagements are database-backed, with scoped access, auditor assignment, requirement selection, status history, and progress summaries. Control assessment entry, evidence uploads, reporting, and AI analysis are not implemented.

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
```

## Database commands

The Prisma 7.10 CLI configuration loads `DATABASE_URL` from `.env`. For development, validate and generate the client, then apply schema changes with `migrate dev`; deployment uses `migrate deploy`:

```bash
npm run db:validate
npm run db:generate
npm run db:migrate
```

The local database is `data/dev.db`; generated client files are under `src/generated/prisma`, and additive migrations are under `prisma/migrations`. Authentication tests use isolated temporary SQLite databases, not the development database.

## Role permissions

- **Administrator:** all application permissions, including user management.
- **Auditor:** manage engagements, assessments, findings, and reports; read regulatory and evidence records.
- **Security Analyst:** manage evidence and control assessments, and read permitted audit and finding records.
- **Read-Only Reviewer:** read permitted records only.

Every application page checks its permission on the server. Every current mutating Server Action checks the permission again; engagement data access must also go through the membership-aware DAL. The sidebar is only a convenience, not an authorization control.

Login lockout triggers after five failed passwords for the same account and lasts 15 minutes. This reduces repeated targeted attempts; deployments exposed beyond a trusted internal network should also apply request-rate limits at their trusted reverse proxy/firewall.

To test the UI locally after creating the administrator, sign in at `/az/login` or `/en/login`; use the header's sign-out action to invalidate that session. The admin page is available to administrators at `/az/admin` and `/en/admin`.

## Regulatory Library

The Regulatory Library reads source documents, versions, requirements, and verification history from SQLite. Administrators can add or edit source metadata, append source versions, and add or edit requirement records. New versions and requirements always start `PENDING_VERIFICATION`; verification changes require a non-empty review note and are written to `VerificationEvent`. The allowed path is pending → legal review → verified, with a return to pending from legal review and superseding verified records. Requirements cannot be marked verified until their parent version is verified.

Version and requirement content becomes read-only once legal review starts; return it to pending with a review note before correcting it. Create a new version rather than overwriting verified content. The interface has no delete operation, protecting source records referenced by existing audit records. Enter only information checked against the authoritative source. Unknown dates, applicability, or clause text should be left blank. Do not treat a translation as official unless its label and provenance are recorded.

Only Administrators have `regulatory:manage`; all other roles can read the library but cannot mutate records. This policy is enforced by every Server Action, independently of whether controls are shown in the UI.

## Audit engagements

The bilingual Audit Engagements area reads real records from SQLite and supports title, audited organisation, scope, audit-period dates, assigned auditors, and a constrained status workflow. Search and status filters are server-side. Auditors can create engagements assigned to themselves; Administrators may assign or reassign an active Auditor. The creator and current assigned auditor can access the engagement; Administrators can access all engagements. Server Actions independently check `audit:manage` and engagement access. Only Administrators can change auditor assignment.

The status path is Draft → In progress → In review → Approved → Archived. In-review engagements may return to In progress; Draft or In-progress engagements may be archived. Changes and assignments append `AuditEvent` records, including status changes. Metadata edits update only engagement metadata and do not remove assessments, findings, evidence, or historical rows.

Requirements are selected from non-demo Regulatory Library records. Selecting a non-verified requirement requires explicit acknowledgement and a decision note; the selection stores who made it, when, the requirement's verification status at selection time, and the note. This is not a legal verification or applicability decision. Existing requirement-to-control mappings are copied into assessment scope items when available. The details page summarizes current assessment status, findings, evidence, and engagement activity; assessment entry itself is not implemented.

The additive migration `20261015124511_audit_engagement_workflow` adds the audited-organisation column and the unique requirement-selection record. Existing engagement rows are preserved; older rows receive an empty organisation value until an authorised user updates their metadata. Do not reset or recreate the database to apply it.

## Project documents

- ARCHITECTURE.md: stack, layout, security model, data model, scoring rules
- PROJECT_PLAN.md: phases and acceptance criteria
- REGULATORY_SOURCES.md: source inventory and verification tasks
- PROGRESS.md and NEXT_STEPS.md: current status and the exact next step

## Rules for demo data

Demo data must be explicitly fictional and flagged. No real bank names, customer records, or invented regulatory clauses.
