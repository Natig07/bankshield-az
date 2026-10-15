# NEXT_STEPS.md

Resume point for a fresh session. Authentication, the Regulatory Library, Audit Engagements, the searchable Security Controls catalogue, requirement mappings, and revisioned control assessments are implemented. The local SQLite schema is up to date. The authenticated UI still needs operator verification in a browser.

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
- `npm audit --omit=dev` reported four high advisories in Prisma's `deepmerge-ts` / `mysql2` dependency chain. A breaking Prisma downgrade was not applied; review on a safe, compatible Prisma update.
- The current assessment rules do not require an independent approver; an authorized assessor can approve their own assessment. Decide whether maker-checker separation is required before operational use.
- Evidence uploads/private storage/authorized download and evidence review, findings/remediation, reporting, and AI workflows remain incomplete. Assessment links reference database metadata only; they do not open, serve, or verify evidence files. Operator verification of the Regulatory Library, Audit Engagements, control catalogue, and assessment workflow through authenticated sessions is still outstanding.
- Continue the verification checklist in REGULATORY_SOURCES.md; no regulatory item is verified without a named reviewer. Have a native speaker review the Azerbaijani dictionary.

## 5. Before further changes

Run `npm run typecheck`, `npx eslint`, `npm test`, and `npm run build`. Update PROGRESS.md with actual results. Do not implement AI analysis, evidence uploads, regulatory scraping, or additional modules until explicitly scoped.
