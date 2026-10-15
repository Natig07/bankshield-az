# PROJECT_PLAN.md

Plan for the BankShield AZ MVP as a single Next.js application. Each phase ends with real checks run, PROGRESS.md and NEXT_STEPS.md updated, and a stop. Status below reflects 2026-10-15.

## Phase 0: Inspect and decide (done)
- Environment inspected, regulatory sources inventoried (REGULATORY_SOURCES.md), architecture decided: one Next.js app, no separate backend, no Docker.
- The earlier .NET + Angular + Docker plan is superseded. See ARCHITECTURE.md.

## Phase 1: Shell, database, authentication (partly done)
Done:
- Next.js 16 app with the UI shell: navy sidebar, top bar with notice, EN/AZ switcher, eight navigation pages, dashboard that shows only honest, unavailable-or-verified figures.
- Locale routing, dictionaries, domain rules (enums, risk, assessment) with tests, source registry, health endpoint, security headers.

Remaining:
- Run `prisma validate`, `generate`, `migrate dev` where Prisma's engine download works; review the schema items listed in ARCHITECTURE.md.
- Choose and implement authentication (secure session cookie, password hashing, CSRF protection, lockout, audit events). Seed users from environment variables, never hardcoded.
- Server-side role checks on every handler, cross-engagement access tests, admin page for users.
- **Done when:** a user of each role can log in, role and object-level checks are tested, migrations apply cleanly, and the app starts from the README.

## Phase 2: Regulatory library and control mappings
- Library list, search, filters; requirement detail with original and translation shown separately and labeled; verification status workflow with `VerificationEvent` history; controls; requirement-to-control mapping; admin JSON/CSV import.
- Imported content defaults to `PENDING_VERIFICATION`. Demo content is fictional and flagged `isDemo`. No invented clauses.
- **Done when:** import validation, mapping and verification-history tests pass.

## Phase 3: Engagements, assessments, findings
- Engagements with members and scope, assessments with versioned history, findings with risk scoring, remediation tracking.
- **Done when:** transition, risk and access-restriction tests pass.

## Phase 4: Evidence upload, extraction, hashing
- Private storage behind an interface, real file-type validation, SHA-256, local PDF/DOCX extraction with failure handling, review/reject/replace with history.
- **Done when:** validation, hash and extraction tests pass using fictional sample files.

## Phase 5: Mock AI review with human approval
- Analyzer interface, labeled mock, Zod validation, exact-quotation check, `INSUFFICIENT_EVIDENCE`, accept/reject workflow.
- **Done when:** schema, quotation and human-review-enforcement tests pass.

## Phase 6: Dashboards, bilingual completion, PDF reports
- Recharts dashboard from real data with denominators and coverage; full AZ/EN coverage; PDF export distinguishing AI drafts from human-approved conclusions.
- **Done when:** report and bilingual tests pass.

## Phase 7: Tests, hardening, local deployment docs
- CSP, rate limiting, dependency audit follow-up, backup and restore notes, retention and secure deletion notes, README run instructions, acceptance checklist verified item by item.

## Cross-cutting rules
- No real bank names, customer data or invented regulatory text in fixtures.
- Never report a check as passed unless it ran.
- Never claim Central Bank approval or guaranteed compliance.
- Stop after each requested phase.
