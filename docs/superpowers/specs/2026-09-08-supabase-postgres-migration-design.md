# Clyn Clean Supabase PostgreSQL Migration Design

## Goal
Move Clyn Clean production persistence from local SQLite to Supabase PostgreSQL so the Next.js app can run on Vercel without ephemeral-disk data loss, while preserving the existing reservation/pricing/state-machine behavior and regression coverage.

## Architecture
- Production uses Supabase PostgreSQL through a server-only `DATABASE_URL` and the `postgres` Node driver.
- Test/local compatibility is preserved through the existing SQLite database when `DATABASE_PATH` is set. Both backends expose the same asynchronous repository contracts.
- Business logic and API routes become `async`/`await` end-to-end. No browser code receives database credentials.
- Schema creation is a tracked Supabase migration. Runtime startup does not mutate the production schema.
- Seed data for settings, price rules, and option prices is idempotent and applied as part of the database migration/data initialization path.

## Data Model
Preserve all current tables and columns: `admins`, `settings`, `calendar_days`, `reservations`, `payments`, `confirmation_logs`, `price_rules`, `option_prices`, `reviews`, and `posts`. Integer boolean flags remain integers (`0/1`) to minimize application-level behavior changes. SQLite `datetime('now')` expressions translate to PostgreSQL `CURRENT_TIMESTAMP` and interval comparisons.

## Deployment
- Supabase project: `clyn-clean` (`dayrqharivegljceiydb`) in `ap-northeast-2`.
- Vercel secrets: `DATABASE_URL`, `SITE_URL`, `JWT_SECRET`, and bootstrap admin variables already supported by the app.
- Supabase schema is private to server-side SQL access; Data API exposure is not required for application operation.

## Testing
- Existing regression suite is converted to await asynchronous business functions while continuing to use temporary SQLite.
- Add adapter-selection tests proving `DATABASE_PATH` selects SQLite and production without it requires `DATABASE_URL`.
- Run regression tests, lint, and production build when dependencies are available.
- After Vercel deployment, run one browser E2E reservation flow against the Supabase-backed deployment.

## Non-goals
- No migration of development/test rows from the uploaded SQLite database.
- No Supabase Auth migration; existing administrator JWT authentication remains unchanged.
- No client-side Supabase SDK or public database access.
