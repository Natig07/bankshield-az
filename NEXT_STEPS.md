# NEXT_STEPS.md

Resume point for a fresh session. The authenticated dashboard now reads live SQLite data and the authentication implementation from the prior phase remains in place. The next work is operational security review and the remaining human regulatory/source review—not restarting or scaffolding the application.

## 1. Verified database foundation (2026-10-15)

- Prisma CLI, client, and SQLite adapter are locked at 7.10.0; `better-sqlite3` is 12.11.1.
- The local ignored `.env` uses `DATABASE_URL="file:./data/dev.db"`; Prisma config loads it with `dotenv/config`. The same URL is documented in `.env.example`. Do not overwrite an existing `.env`.
- Authentication does not use `SESSION_SECRET`; it stores only hashes of random database session tokens.
- The initial migration and additive authentication migration are applied. The verified development DB is `data/dev.db`, currently with zero users; its authentication tables are `Session` and `BootstrapState`.
- Dashboard queries in `src/lib/dashboard/data.ts` read regulatory sources and verified requirements globally, plus current assessments, engagements, findings, evidence, overdue actions, and pending suggestions scoped to engagements the signed-in user may access. Dashboard query errors render an error state and are not converted to zero.
- The dashboard's existing “Preview build” text was a hardcoded placeholder; the dashboard had no Prisma data queries even though the shared Prisma client and database were configured. This is corrected. The current database query succeeded and returned empty entity counts.
- The production build was started for an HTTP smoke check: login and health returned 200, while unauthenticated `/az` correctly redirected to `/az/login`. The database has zero users, so no authenticated browser dashboard session was performed.
- Current validation results and the earlier Phase 1 initialization history are recorded in PROGRESS.md. Never run a reset command against the local database.

## 2. Authentication status and local use

- Implemented: Argon2id login, generic authentication failures, 15-minute lockout after five failed attempts, eight-hour revocable DB sessions, server-side permission guards, engagement membership scoping, logout, disabled-account handling, and bilingual administrator user management.
- To provision the first account, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_NAME` in a local PowerShell session and run `npm run auth:bootstrap`. Enter a unique password of at least 12 characters at the hidden prompt. This is a local CLI-only, one-time transaction; it refuses production execution and repeat bootstrap. Never use a seeded/default password or commit the environment values.
- Run `npm run dev`, then sign in at `/az/login` or `/en/login`. No user exists in the development DB until the operator runs bootstrap.
- Dashboard integration tests now cover empty database state, populated data, engagement scoping, and query errors. `npm test` passed 37 tests in the latest run (see PROGRESS.md).

## 3. Remaining security and product work

- No MFA, password reset/recovery, or built-in per-IP/distributed login throttle. Apply trusted proxy/firewall limits if exposed beyond the private on-prem network.
- Custom authentication code has not received an independent production security review. Verify reverse-proxy forwarding headers and production HTTPS/cookie behavior before deployment.
- `npm audit --omit=dev` reported four high advisories in Prisma's `deepmerge-ts` / `mysql2` dependency chain. A breaking Prisma downgrade was not applied; review on a safe, compatible Prisma update.
- Existing compliance pages and workflows are still placeholders, despite dashboard metrics now querying existing tables. Any future database reads/writes must use centralized server-side permissions and engagement-scoped access; hiding UI controls is not an authorization check.
- Continue the verification checklist in REGULATORY_SOURCES.md; no regulatory item is verified without a named reviewer. Have a native speaker review the Azerbaijani dictionary.

## 4. Before further changes

Run `npm run typecheck`, `npx eslint`, `npm test`, and `npm run build`. Update PROGRESS.md with actual results. Do not implement AI analysis, evidence uploads, regulatory scraping, or additional modules until explicitly scoped.
