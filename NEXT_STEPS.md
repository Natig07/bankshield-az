# NEXT_STEPS.md

Resume point for a fresh session. The authenticated dashboard reads live SQLite data, the Regulatory Library supports source/version/requirement maintenance, and the Audit Engagements workflow is database-backed. Authentication remains implemented.

## Current milestone: Audit Engagements

- The engagement list/detail uses actual SQLite data with search, status filters, server error states, and framework loading states. Visibility is restricted to Administrators or the engagement creator/current assigned auditor.
- Administrators and Auditors with `audit:manage` can create and edit permitted engagement metadata and change supported statuses. The creator is immutable; only Administrators can reassign the active Auditor. Mutations require permission and engagement access in every Server Action.
- Requirement selection stores actor, selection time, the requirement verification state at selection, and the required explicit acknowledgement/note for non-verified content. Existing requirement-to-control mappings create assessment scope items where available. The page summarizes current assessment statuses, findings, evidence, and audit events; it does not implement assessment entry.
- Additive migration `20261015124511_audit_engagement_workflow` has been applied and Prisma client regenerated. Existing engagement data is retained; the new organisation field defaults empty for prior rows. No reset or fabricated data was used.
- A read-only Prisma query using the application's `.env` configuration verified the new tables; the development database currently has 0 engagements, 0 requirement selections, and 0 engagement audit events.
- `npm test` (47 passed), `npm run typecheck`, `npm run lint`, `npx prisma validate`, `npx prisma migrate status`, and `npm run build` all passed. An HTTP smoke check got health 200 and the expected unauthenticated audit-page redirect (307 to login); no authenticated browser workflow was tested.
- Manual browser verification: sign in as Administrator (do not rerun bootstrap); ensure an active Auditor account exists; create an engagement with valid dates and assign that Auditor; edit its metadata and progress status through the allowed transitions; reassign it as Administrator; select a verified requirement and a pending one with the acknowledgement and note; confirm the source/status snapshot, mapped scope progress, event history, and evidence/finding summaries. Sign in as the assigned Auditor to confirm access, then as a read-only user outside the engagement to confirm the detail route is unavailable and mutation attempts are denied.

## 1. Regulatory Library workflow

- `src/app/[lang]/(app)/regulatory/page.tsx` reads actual source/version/requirement records. Administrators can create/edit source metadata, append source versions, add/edit requirements, and record status transitions with review notes. Server Actions independently require `regulatory:manage`, which is Administrator-only.
- New source versions and requirements start pending verification. Required legal data is not fabricated; leave unconfirmed dates, applicability, and clause text blank. Requirement verification requires a verified parent version. Verification history is appended to `VerificationEvent`.
- Version/requirement content becomes locked after review starts; return to pending with a review note to correct it. Verified source content should be updated with a new version. There is no deletion interface/action.
- 39 tests, typecheck, lint, Prisma validation, and production build passed. UI testing as an authenticated admin is still pending because this local DB currently has no unexpired admin session.

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
- Control assessment entry/approval, evidence uploads, reporting, and AI workflows are still placeholders. Any future data operation must use centralized server-side permissions and engagement-scoped access; hiding UI controls is not an authorization check. Operator verification of the Regulatory Library and Audit Engagements through an administrator session is still outstanding.
- Continue the verification checklist in REGULATORY_SOURCES.md; no regulatory item is verified without a named reviewer. Have a native speaker review the Azerbaijani dictionary.

## 5. Before further changes

Run `npm run typecheck`, `npx eslint`, `npm test`, and `npm run build`. Update PROGRESS.md with actual results. Do not implement AI analysis, evidence uploads, regulatory scraping, or additional modules until explicitly scoped.
