# Supabase PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Clyn Clean on Vercel with Supabase PostgreSQL persistence while preserving current behavior and SQLite-backed regression tests.

**Architecture:** Add an async database adapter that selects SQLite for tests/local fixtures and PostgreSQL for production. Convert repositories, business libraries, route handlers, and server components to await repository calls. Apply the canonical schema and seed data to Supabase as a tracked migration.

**Tech Stack:** Next.js 16, TypeScript, Node.js 22+, `postgres` driver, Supabase PostgreSQL 17, SQLite test adapter.

**Spec:** `docs/superpowers/specs/2026-09-08-supabase-postgres-migration-design.md`

## Global Constraints
- Preserve existing pricing, capacity, reservation-state, payment-state, snapshot, SEO, and terms behavior.
- Production database credentials must remain server-only.
- Uploaded SQLite data is test/development data and is not copied to Supabase.
- Supabase project is `dayrqharivegljceiydb` in `ap-northeast-2`.

---

### Task 1: Async database adapter
**Files:**
- Modify: `package.json`
- Modify: `src/database/connection.ts`
- Create: `src/database/postgres.ts`
- Modify: `src/database/schema.ts`
- Test: `tests/regression.test.mjs`

**Interfaces:**
- Produces `queryRows<T>(sql, params)`, `queryRow<T>(sql, params)`, `execute(sql, params)`, and `transaction(fn)` returning Promises.
- SQLite is selected when `DATABASE_PATH` is present; PostgreSQL otherwise requires `DATABASE_URL`.

- [ ] Add a failing adapter-selection regression test.
- [ ] Run the targeted test and verify RED.
- [ ] Add the `postgres` dependency and async adapter.
- [ ] Update schema initialization so SQLite tests still initialize lazily while production relies on Supabase migrations.
- [ ] Run the targeted test and verify GREEN.

### Task 2: Repository conversion
**Files:**
- Modify: `src/database/repositories/*.ts`
- Modify: `src/database/seed-admin.ts`

**Interfaces:**
- Every repository read/write returns `Promise<...>`.
- Preserve existing row shapes and integer boolean flags.

- [ ] Convert repository tests/callers to await one repository family at a time.
- [ ] Translate SQLite placeholders/time functions/upserts to adapter-compatible SQL.
- [ ] Verify each repository family against SQLite regression fixtures.

### Task 3: Business service conversion
**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/pricing.ts`
- Modify: `src/lib/calendar.ts`
- Modify: `src/lib/reservations.ts`
- Modify: `src/lib/reviews.ts`
- Modify: `src/lib/posts.ts`

**Interfaces:**
- Existing exported function names are preserved but data-backed functions become Promise-returning.

- [ ] Update regression tests to await public business functions.
- [ ] Convert each business library to async propagation.
- [ ] Run regression tests until existing business behavior is GREEN.

### Task 4: Next.js call-site conversion
**Files:**
- Modify: DB-backed `src/app/api/**/route.ts`
- Modify: DB-backed server pages/components under `src/app/**` and `src/components/**`
- Modify: `src/instrumentation.ts` if bootstrap behavior requires it.

**Interfaces:**
- Route response contracts and rendered UI remain unchanged.

- [ ] Convert route handlers to await business functions.
- [ ] Convert server components/pages to async components where needed.
- [ ] Run TypeScript/build checks and fix missed Promise call sites.

### Task 5: Supabase schema and seed
**Files:**
- Create: `supabase/migrations/20260908090000_initial_clyn_clean.sql`

**Interfaces:**
- Creates all 10 application tables, indexes, constraints, and idempotent seed rows.

- [ ] Generate PostgreSQL DDL matching the SQLite schema including incremental columns.
- [ ] Apply migration to Supabase project `dayrqharivegljceiydb`.
- [ ] Query table/seed counts and verify expected rows.
- [ ] Run Supabase security/performance advisors and record actionable findings.

### Task 6: Deployment configuration and final verification
**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `tests/regression.test.mjs`

**Interfaces:**
- Production requires `DATABASE_URL`; SQLite test use requires `DATABASE_PATH`.

- [ ] Document Supabase pooled `DATABASE_URL` for Vercel and required secrets.
- [ ] Run `npm run test:regression` and require 0 failures.
- [ ] Run `npm run lint` and require exit 0.
- [ ] Run `npm run build` with production-safe environment and require exit 0.
- [ ] Package the verified source for GitHub/Vercel deployment.
