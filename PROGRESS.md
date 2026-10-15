# PROGRESS.md

## Dashboard: live SQLite data (2026-10-15) — IMPLEMENTED AND VERIFIED

### Diagnosis and changes
- Root cause: the dashboard page used the static `REGULATORY_SOURCES` registry and hardcoded a “Preview build” notice; it never queried Prisma. All audit, assessment, findings, evidence, remediation, and AI counts were literal unavailable placeholders. Therefore the banner did not reflect the actual database connection state.
- The server-side shared Prisma client was already configured in `src/lib/db.ts` with Prisma 7.10.0 and `PrismaBetterSqlite3`; `prisma.config.ts` already loads `.env` with `dotenv/config`. The expected ignored `.env` and `data/dev.db` both existed. No dependency, Prisma config, schema, migration, or database-path change was needed.
- Added `src/lib/dashboard/data.ts` to query real regulatory sources/latest version statuses, verified non-demo requirements, visible engagements, current assessment statuses, open findings by severity, evidence, overdue remediation, and pending AI suggestions. Non-administrator audit metrics are restricted to engagements they created or are assigned to.
- Replaced the static preview banner and placeholder metrics in the authenticated dashboard with live values and explicit empty-source/no-record states. On database/query failure the page shows a localized safe error state, shows no counts, and logs only a non-sensitive error name/code (never message, stack, URL, or credential).
- Added Azerbaijani and English translations for the connected-data note, error state, empty states, and status/severity summaries. No compliance percentage is calculated or displayed.
- Added isolated SQLite integration tests for empty database behavior, real aggregated records and engagement scoping, and safe database-error handling. The test command now runs Node with the `react-server` condition so the dashboard data module's `server-only` guard remains enabled in tests.

### Verification actually run
- A read-only call through the app's `getPrisma()` and `getDashboardData()` queried `data/dev.db` successfully. The actual query result was empty for sources, requirements, engagements, assessments, findings, evidence, overdue actions, and pending suggestions; this agrees with the existing empty database. No records were inserted.
- `npx prisma migrate status` — passed; both existing migrations remain applied and up to date. No migration or reset was run for this dashboard change.
- `npm test` — passed, 37 tests / 6 suites, 0 failures, including three new dashboard integration tests.
- `npm run typecheck`, `npm run lint`, and `npm run build` — passed.
- Built production server started and responded: `/az/login` 200, `/api/health` 200, and raw `/az` response 307 to `/az/login` (expected because the real database has no administrator/user yet). The server was stopped after the smoke test.
- A browser dashboard session with a real authenticated account was not performed: `User` count is zero. Dashboard query behavior was exercised in tests and directly against `data/dev.db`; no administrator was created as part of this task.

### Remaining
- Existing application modules are still placeholders; live counts do not imply the assessment, evidence, reporting, or AI workflows are implemented.
- Authentication code already exists in this repository from the prior phase. This task made no authentication changes. The local database still has zero users, so the documented one-time bootstrap is required before an operator can sign in and view the protected dashboard.

## Phase 2: Secure authentication and authorization (2026-10-15) — IMPLEMENTED AND VERIFIED

### Implementation
- Selected Argon2id password hashing (`@node-rs/argon2`) and opaque, random database-backed sessions. Session tokens are stored as SHA-256 hashes, expire after eight hours, and can be revoked on logout, role change, or account disable. HttpOnly/SameSite cookies use `Secure` in production.
- Added `Session` and `BootstrapState` models and the additive migration `prisma/migrations/20261015014139_authentication/migration.sql`. Existing `User` and compliance models were preserved. No reset was run.
- Added a centralized role/permission map and server-side guards for protected pages and actions, with creator/member scoping for engagement data. The Administrator, Auditor, Security Analyst, and Read-Only Reviewer roles are documented in ARCHITECTURE.md.
- Added bilingual login, logout, access-denied, and administrator user-management UI. Existing compliance sections remain placeholders; authentication work did not implement assessments, uploads, or other new modules.
- The initial administrator is created only by `npm run auth:bootstrap`, a local CLI operation that prompts for an un-echoed password. It refuses production execution, validates the inputs, and transactionally blocks repeated or concurrent bootstrap. No admin or other user was seeded into the development database.
- Login responses do not reveal whether an account exists. Five failed attempts lock a known account for 15 minutes; unknown accounts receive a dummy Argon2 verification. A distributed/per-IP limiter is not built in; deployments reachable beyond a trusted private network need trusted proxy/firewall throttling.

### Verification actually run
- `npx prisma validate` — passed.
- `npx prisma generate` — passed; generated Prisma Client 7.10.0.
- `npx prisma migrate dev --name authentication` — passed earlier in this phase and applied the additive migration to the existing database.
- `npx prisma migrate status` — passed; both migrations are applied and the schema is up to date.
- Read-only `better-sqlite3` inspection — passed; verified `data/dev.db`, 23 tables including `User`, `Session`, `BootstrapState`, and `_prisma_migrations`; user count is 0. No real administrator or test account was added.
- `npm test` — passed, 34 tests / 6 suites, 0 failures. Tests include password hashing, login, generic failures, lockout, session expiry/revocation, role denials, engagement scoping, and bootstrap restrictions/concurrency. Tests use isolated temporary databases.
- `npm run typecheck` — passed.
- `npx eslint` — passed (exit code 0).
- `npm run build` — passed on Next.js 16.4.0.
- HTTP/browser smoke checks on an isolated database — previously passed for unauthenticated redirects, login, identity/role display, administrator user creation, role change, account disable, and public health endpoint. The role-selector refresh adjustment made afterward has passed typecheck/build, but was not repeated in the browser.
- `npm audit --omit=dev` — previously reported four high advisories in the Prisma dependency chain (`deepmerge-ts`, `mysql2`). No forced Prisma downgrade or provider change was made; review this chain when Prisma releases a compatible fix.
- Removed the known disposable authentication smoke-test script/database after the smoke test. The real development database was inspected read-only.

### Configuration and operator actions
- `DATABASE_URL` is required and loaded by the existing Prisma 7 `dotenv/config` setup from local `.env`; `.env.example` documents `file:./data/dev.db`. Opaque DB sessions require no `SESSION_SECRET`.
- To set up a new local checkout, copy `.env.example` to `.env` only if `.env` does not exist, run `npx prisma migrate deploy`, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_NAME` in the shell, then run `npm run auth:bootstrap`. Provide a unique password of at least 12 characters at the hidden prompt. Never put a password in source control or logs.
- Before production use: perform controlled administrator bootstrap against the intended database, apply trusted network rate limiting, review production cookie/TLS/proxy settings, and obtain a dedicated security review. MFA and password reset are not implemented.

## Step 4: Prisma environment and database setup (2026-10-15) — COMPLETE (Phase 1 close)

At the close of Phase 1, Prisma loaded the local environment, the schema validated, the client was generated, and the initial SQLite migration was applied. Authentication was out of scope at that time; it was implemented later in Phase 2 as documented above.

### Configuration changes
- `.env` was absent. Created a local ignored file with a project-root SQLite URL and private evidence-storage path. `.env.example` documents the same URL; database-backed opaque sessions do not need a `SESSION_SECRET`.
- Kept Prisma 7.10.0, the SQLite provider, existing schema, generator, adapter, and migration strategy. `prisma.config.ts` already imported `dotenv/config`; that import plus `env("DATABASE_URL")` was the correct Prisma 7 mechanism. The initial failure was caused by the absent `.env`.
- Removed the configured seed path and `db:seed` script because `prisma/seed.ts` did not exist and no seed/admin bootstrap is needed for database initialization.
- `.gitignore` already ignores `.env`, `*.db`, and `src/generated/`; no security-related ignore entries were removed.

### Prisma and database verification
- `npx prisma validate` — passed; schema reported valid.
- `npx prisma generate` — passed; Prisma Client 7.10.0 generated at `src/generated/prisma`.
- `npx prisma migrate dev --name init` — passed at the corrected URL; initial migration `prisma/migrations/20261014221616_init/migration.sql` applied.
- `npx prisma migrate status` — passed; database schema is up to date.
- Verified database path: `C:\Users\Natig Alizada\Downloads\bankshield-az\bankshield-az\data\dev.db`.
- Read-only SQLite inspection found 21 tables: the 20 schema models plus `_prisma_migrations`.
- Runtime verification using the generated client with `PrismaBetterSqlite3` 7.10.0 succeeded; `user.count()` returned 0.
- The first migration attempt used `file:../data/dev.db` and created a schema-only database one directory above the project. Corrected to `file:./data/dev.db`, verified the in-project database, and removed the stray file after user approval.
- `npm ci` was skipped: dependencies were already installed and Prisma/adapter versions matched `package-lock.json`; `npm ci` would replace `node_modules`.

### Project checks
- `npm run typecheck` — passed.
- `npx eslint` — passed.
- `npm test` — 19/19 passed (6 suites).
- `npm run build` — passed.

### Phase 1 close notes (superseded by Phase 2 above)
- At the end of Phase 1, authentication, role-based authorization, login tests, and administrator bootstrap were not implemented. Those items were addressed in Phase 2 as recorded at the top of this document. Compliance application persistence and production database hardening remain future work.
- `SESSION_SECRET` is not needed by the implemented database-backed session design.
- The workspace does not contain `.git` metadata, so Git status and ignore verification could not run. `.env` contains no secret and matches the `.gitignore` rule; database and generated files match existing ignore patterns.
- The earlier cloud sandbox's Prisma-engine 403 remains a historical environment limitation; it did not prevent the local validation and migration in this setup.

## Historical Step 3: Prisma investigation (2026-10-15)

The earlier cloud workspace could not download Prisma's native engine because `binaries.prisma.sh` returned HTTP 403. It performed an offline schema parse only; it did not validate, generate, or migrate. Those commands were later run successfully in the local Windows environment as recorded above.

---

## Step 2: Convert to a single Next.js app, UI shell (2026-10-15)

### What was found at the start
- The repository already contained a Next.js 16.4 + Prisma 7 + Tailwind 4 scaffold that was not created in this session step: `package.json`, `node_modules`, `.env` (gitignored), `.env.example`, `.gitignore`, `AGENTS.md`, `next.config.ts` (security headers), `eslint.config.mjs`, `tsconfig.json`, `prisma.config.ts`, a 466-line `prisma/schema.prisma`, and the default create-next-app `src/app`.
- `docker-compose.yml`, `backend/` and `frontend/` from the earlier .NET/Angular scaffold were already gone. Nothing needed deleting. All planning documents were preserved.
- All of the existing work was kept. Nothing was overwritten except the default create-next-app page, layout and stylesheet, which were replaced.

### Changes made
- Tailwind: installed `@tailwindcss/postcss` and added `postcss.config.mjs` as the Next 16 docs describe; removed `@tailwindcss/turbopack`, which was installed but not configured anywhere.
- Replaced default layout/page with `src/app/[lang]/` routing (az, en), `src/proxy.ts` for locale redirects, and dictionaries in `src/i18n/` (UI text only).
- UI shell: navy sidebar, top bar with the "not approved, nothing verified" notice, language switcher, dashboard, and placeholder pages for the other seven sections. System font stack (no network fetch at build, covers Azerbaijani letters).
- Dashboard shows only what is true now: 3 of 3 regulatory sources not yet verified, and "—" (unavailable) for everything that needs data. No compliance percentage anywhere.
- Domain code referenced by the schema: `src/lib/domain/enums.ts`, `risk.ts`, `assessment.ts`; source registry `src/lib/regulatory/sources.ts` (metadata only, no clause text).
- `GET /api/health` liveness endpoint.
- `package.json` scripts: `typecheck` now runs `next typegen` first; `test` runs `tsx --test`.
- Docs rewritten for the Next.js-only decision: ARCHITECTURE.md, PROJECT_PLAN.md, README.md, NEXT_STEPS.md. REGULATORY_SOURCES.md kept; status names aligned to the four required statuses.

### Checks actually run (final code)
- `npm run typecheck`: passed.
- `npx eslint`: passed, 0 warnings.
- `npm test`: 19 tests in 6 suites, 19 passed, 0 failed (risk calculation, assessment rules, dictionary key parity, Azerbaijani character handling, locale selection).
- `npm run build`: passed; all pages are server-rendered on demand; proxy registered.
- Production server (`next start`, port 3100) with curl: `/api/health` 200 with security headers; `/` redirects 307 to `/az`, or `/en` with `Accept-Language: en`; `/regulatory` redirects to `/az/regulatory`; all eight sections return 200 in `/az` and the checked `/en` pages return 200; `<html lang>` correct; Azerbaijani text (`İdarə paneli`, `Sİ təhlili`) present; `/xx/regulatory` ends in 404; compiled CSS contains the theme classes.
- Screenshots with headless Chromium at desktop (az) and phone width (en) were inspected visually. Layout, contrast and Azerbaijani letters looked correct.

### Not run / not verified
- `prisma validate`, `generate` and `migrate`: **blocked.** The sandbox returns 403 for `binaries.prisma.sh`, so Prisma's engine could not be downloaded. The schema has not been validated by tooling and no database exists. I did not bypass the block.
- `npm run dev` was not run (the production build was).
- No authentication, database access or file upload exists yet, so nothing in those areas is tested.

### Known issues
- `npm audit --omit=dev`: 4 high advisories in Prisma's CLI dependency chain (`deepmerge-ts`, `mysql2`). The suggested fix is a breaking downgrade to Prisma 6, so it was not applied. This app uses SQLite, not MySQL; whether the advisories are reachable at runtime has not been analysed. Re-check when Prisma updates.
- Azerbaijani UI strings are a first draft and need a native-speaker review.
- On phone width the sidebar takes a lot of vertical space; make it collapsible later.
- Regulatory source titles and issuer names on the dashboard are shown in English (they are source data, not UI strings).
- Schema review items are listed in ARCHITECTURE.md (soft `...ById` references, single role per user, `AISuggestion.requirementId` required).
- Regulatory verification questions from REGULATORY_SOURCES.md are still open (decision number conflict, effective dates, 2021 vs 2024 overlap, personal data law status).
- Nothing has been committed to git.

### Exact next step
See NEXT_STEPS.md: validate and migrate the Prisma schema on a machine where the engine download works, then implement authentication (Phase 1, remaining).

---

## Step 1: Planning and first scaffold (2026-10-14)
- Inspected the empty environment, retrieved the three regulatory sources through an automated summarizer, wrote the original planning files for a .NET/Angular design. That design is superseded by the Next.js-only decision above. The regulatory findings carry over unchanged.
