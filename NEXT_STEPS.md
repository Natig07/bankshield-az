# NEXT_STEPS.md

Resume point for a fresh session. Implemented: authentication, Regulatory Library, Audit Engagements (with status locks and participants), Security Controls and revisioned, independently approved assessments, evidence upload/review/download, Risk Register, and Findings and Remediation. All of it is tested only against isolated SQLite databases; **nothing has been verified in a browser or end-to-end**.

## First, on the operator's machine

1. Back up `data/dev.db` (copy the file).
2. `npm install` (or `npm ci`), `npx prisma generate`, `npx prisma validate`.
3. `npm run db:inspect` (read-only: table counts and migration state) and `npx prisma migrate status`. The Risk Register migration `20261016100000_risk_register` is expected to be pending.
4. `npx prisma migrate deploy` applies it (additive; creates five new tables and indexes only). Never run `migrate reset`/`db push --force-reset`, and do not rerun `npm run auth:bootstrap`.
5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
6. Update Node to the latest 22.x (>= 22.13.0) to remove the `eslint-visitor-keys` `EBADENGINE` warning. `npm audit fix` (without `--force`) may update the lockfile for the Prisma-chain advisories; review the diff and re-run step 5.

## Manual browser verification still required

- Sign in as Administrator; add a Security Analyst as engagement participant; in IN_PROGRESS, upload a small PDF as the analyst, review it as a different auditor (reviewer must differ from uploader), download it, and try as an out-of-scope user (must be denied).
- Record an assessment as the analyst and confirm the same user cannot approve it; approve as the auditor.
- Risk Register: create an asset and a risk, link a control, add a treatment action, move OPEN → IN_TREATMENT → CLOSED, and try ACCEPTED as Administrator (needs justification, residual scores, future review date).
- Findings: as an auditor create a finding in an IN_PROGRESS engagement, add an action, move to remediation, complete the action as the analyst, move to ready for review, verify as an auditor and confirm the creator is refused when closing while a second auditor can close.
- Check pages at phone width, keyboard-only navigation (skip link, forms), and both `/az` and `/en`.

## Remaining work and known limitations

- No malware scanning of uploaded evidence; storage is local disk (`storage-local/`, gitignored). Back it up together with the database.
- No MFA, password reset, or per-IP login throttle (account lockout only). CSP has no `script-src`/`style-src` yet: adding them needs per-request nonces in `proxy.ts` and browser testing.
- Findings can be linked to a requirement only when editing (the create form does not list scope requirements). `ownerUserId` on remediation actions has no UI, so the "owner cannot verify" rule applies only when it is set by other means.
- `...ById` columns (for example risk `createdById`) are soft references without foreign keys.
- Azerbaijani case-insensitive search is limited by SQLite; the Azerbaijani dictionary needs native review.
- Reporting and AI-assisted review remain unimplemented. Do not start them until scoped. The Reports and AI Review pages are placeholders.
- Continue the verification checklist in REGULATORY_SOURCES.md; no regulatory item is verified without a named reviewer.

## Historical notes (still accurate)

## Current milestone: Security Controls and Assessment Workflow

- Administrators can manage controls and add rationale-bearing requirement mappings. Mapping changes do not change regulatory verification states, delete mappings, or rewrite existing engagement scope.
- Auditor/Security Analyst users with `controls:assess` must also have engagement access to create a versioned assessment or approve it. `NOT_APPLICABLE` requires a reason; `NOT_TESTED` cannot be approved; approval requires reviewer justification and assessment-linked evidence except for `NOT_APPLICABLE`.
- Applied additive migration `20261015191722_control_assessment_evidence` adds `ControlAssessmentEvidence` and a SQLite partial unique current-revision index. `data/dev.db` was up to date after migration, and current counts for controls, scope items, assessments, and evidence links were all zero. No application rows were seeded or changed.
- Latest checks: **56 tests passed**, typecheck, lint, Prisma validation, migration status, client generation, and production build passed. No authenticated browser workflow was performed.
- Manual browser verification: sign in as Administrator (do not rerun bootstrap), create a control and map a pending requirement; confirm its verification status remains unchanged. In a new engagement, select that requirement and confirm the mapped scope item appears. As an assigned Auditor/Analyst, record a revision, select same-engagement evidence metadata if available, verify `NOT_APPLICABLE` reason validation and approval rejection for `NOT_TESTED`/missing evidence or justification, then approve and create a later revision to confirm prior history remains. As Read-Only Reviewer and as an out-of-scope user, confirm all assessment mutations are denied and engagement records remain inaccessible.

## Completed milestone: Audit Engagements

- The engagement list/detail uses SQLite data with search, status filters, loading/error states and creator/member-scoped access. Administrators/Auditors with `audit:manage` create/edit allowed fields; auditor assignment and status transitions are permission-checked and audited.
- Requirement selection stores actor, selection time, verification status snapshot, and acknowledgement/note for non-verified requirements. Existing mappings seed scope items at selection time; later mapping changes do not rewrite them.
- Applied additive migration `20261015124511_audit_engagement_workflow`; historical data was retained. Prior milestone checks reported 47 passing tests plus typecheck, lint, Prisma validation/status and build. Browser testing as a signed-in user remains pending.

## Completed milestone: Regulatory Library

- `src/app/[lang]/(app)/regulatory/page.tsx` reads actual source/version/requirement records. Administrators can maintain provenance, add/edit requirements, and record verification transitions with notes. Mutations require `regulatory:manage`.
- New source versions and requirements start pending verification. Requirement verification requires a verified parent version. Verification history is appended to `VerificationEvent`; there is no delete interface/action.
- Prior milestone checks reported 39 tests, typecheck, lint, Prisma validation, and production build passed. Authenticated browser verification remains pending.

## 2. Verified database foundation (2026-10-15)

- Prisma CLI, client, and SQLite adapter are locked at 7.10.0; `better-sqlite3` is 12.11.1.
- The local ignored `.env` uses `DATABASE_URL="file:./data/dev.db"`; Prisma config loads it with `dotenv/config`. The same URL is documented in `.env.example`. Do not overwrite an existing `.env`.
- Authentication does not use `SESSION_SECRET`; it stores only hashes of random database session tokens.
- The initial migration and additive authentication migration are applied. The verified development DB is `data/dev.db`; a read-only check found 2 users, 1 active administrator, and 1 bootstrap marker. There are no unexpired sessions for the administrator. Do not rerun bootstrap; it must refuse because the admin already exists. If the browser appears signed in as that administrator, verify it is configured for this same database, restart the server, and sign in again with the existing credentials.
- Dashboard queries in `src/lib/dashboard/data.ts` read regulatory sources and verified requirements globally, plus current assessments, engagements, findings, evidence, overdue actions, and pending suggestions scoped to engagements the signed-in user may access. Dashboard query errors render an error state and are not converted to zero.
- The dashboard's existing “Preview build” text was a hardcoded placeholder; the dashboard had no Prisma data queries even though the shared Prisma client and database were configured. This is corrected. The current database query succeeded and returned empty entity counts.
- The production build was started for an HTTP smoke check: login and health returned 200, while unauthenticated `/az` correctly redirected to `/az/login`. No authenticated browser dashboard session was performed; the database has no unexpired session for its administrator.
- Current validation results and the earlier Phase 1 initialization history are recorded in PROGRESS.md. Never run a reset command against the local database.

## 3. Authentication status and local use

- Implemented: Argon2id login, generic authentication failures, 15-minute lockout after five failed attempts, eight-hour revocable DB sessions, server-side permission guards, engagement membership scoping, logout, disabled-account handling, and bilingual administrator user management.
- The initial administrator already exists in the configured database. Do not run `npm run auth:bootstrap` again. If provisioning a different fresh database, use the documented CLI-only setup with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_NAME`; never add public registration or hardcoded credentials.
- Confirm the server uses `DATABASE_URL=file:./data/dev.db`, restart it if necessary, then sign in at `/az/login` or `/en/login` with the existing administrator credentials. Do not reset the database or edit user/session rows by hand.
- Dashboard and regulatory integration tests use isolated SQLite databases; see PROGRESS.md for the latest test counts.

## 4. Remaining security and product work

- No MFA, password reset/recovery, or built-in per-IP/distributed login throttle. Apply trusted proxy/firewall limits if exposed beyond the private on-prem network.
- Custom authentication code has not received an independent production security review. Verify reverse-proxy forwarding headers and production HTTPS/cookie behavior before deployment.
- `npm audit` advisories are analysed in PROGRESS.md; none is reachable from the running app and no breaking downgrade was applied.
- Assessment approval now requires an approver different from the assessor.
- Reporting and AI workflows remain incomplete. Operator verification of the Regulatory Library, Audit Engagements, control catalogue, and assessment workflow through authenticated sessions is still outstanding.
- Continue the verification checklist in REGULATORY_SOURCES.md; no regulatory item is verified without a named reviewer. Have a native speaker review the Azerbaijani dictionary.

## 5. Before further changes

Run `npm run typecheck`, `npx eslint`, `npm test`, and `npm run build`. Update PROGRESS.md with actual results. Do not implement AI analysis, evidence uploads, regulatory scraping, or additional modules until explicitly scoped.
