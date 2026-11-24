# Database Space Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nightly retention cleanup of the six log and history tables, plus an admin page that shows sizes and runs the cleanup on demand.

**Architecture:** One SQL migration holds the run log, the internal cleanup function, two admin RPCs and the pg_cron job. One React admin page calls the RPCs. Pure helpers live in `src/lib/dbSpace.ts`.

**Tech Stack:** Postgres and pg_cron (Supabase), React 18, TypeScript, Vitest, PGlite for local SQL checks.

**Spec:** `docs/superpowers/specs/2026-11-23-database-space-cleanup-design.md`

## Global Constraints
- Only these six tables are cleaned, with these exact rules: `cron.job_run_details` 7d by `start_time`; `public.system_logs` 30d by `ts`; `public.push_notification_logs` 30d by `created_at`; `public.sms_logs` 90d by `created_at`; `public.security_logs` 90d by `created_at`; `public.user_notifications` `read = true` and 60d by `created_at`.
- Admin RPCs need `is_admin()`, plus `auth.jwt()->>'aal' = 'aal2'` unless the role is `service_role`. Otherwise they raise `not_authorized`.
- The manual run's time budget is 5000 ms, with a batch size of 2000 rows.
- No dynamic SQL.
- The migration is applied via the SQL editor, never `db push`.

## Review Focus
- When a cleanup stops at its time budget, the page keeps calling until `more_remaining` is false, with a cap of 200 calls.
- An RPC error mid-loop shows a toast, keeps the deleted totals counted so far, and refreshes the sizes.
- An unread notification of any age is never deleted.
- A non-admin, or an admin without 2FA, calling either RPC gets `not_authorized`.
- Running the migration a second time doesn't create a second cron job.

---

### Task 1: Migration and SQL checks

**Files:**
- Create: `supabase/migrations/20261123150000_db_space_cleanup.sql`
- Create: `supabase/tests/db_space_cleanup_checks.sql`, which runs only locally on PGlite with stub tables (it deletes rows)

**Interfaces (produces):**
- `public.db_cleanup_runs(id uuid, started_at timestamptz, finished_at timestamptz, source text ('nightly'|'manual'), triggered_by uuid, deleted jsonb, more_remaining boolean)`
- `public.run_db_retention(p_source text, p_budget_ms int, p_triggered_by uuid) returns jsonb` → `{"deleted": {"<target>": n, ...}, "more_remaining": bool}`. Internal only, with EXECUTE revoked from public, anon and authenticated.
- `public.admin_db_cleanup_now() returns jsonb`, the same shape. Runs `run_db_retention('manual', 5000, auth.uid())`.
- `public.admin_db_space() returns jsonb` → `{"database_bytes": n, "tables": [{"target","label","keep_days","rule","total_bytes","approx_rows"}], "last_run": {...} | null}`
- A cron job named `db-retention-nightly` on schedule `20 3 * * *`.

- [ ] **Step 1:** Write the checks covering:
  - old rows are deleted and recent rows kept, for all six tables
  - unread old notifications are kept
  - a run row is recorded
  - a non-admin and an aal1 admin get `not_authorized` from both RPCs
  - `admin_db_space` lists the 6 targets
  - `authenticated` can't execute `run_db_retention`
- [ ] **Step 2:** Run them on PGlite without the migration. Expected: FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run the checks again. Expected: `ALL DB SPACE CHECKS PASSED`. Also run the migration twice and confirm there's one cron job.
- [ ] **Step 5:** Commit: `feat(db-space): nightly retention cleanup and admin RPCs`.

### Task 2: Admin Database Space page

**Files:**
- Create: `src/lib/dbSpace.ts` with `formatBytes(n: number): string`, `addDeleted(a: Record<string, number>, b: Record<string, number>): Record<string, number>` and `COMPACT_SQL: string`, which lists `VACUUM FULL <target>;` for the 6 targets.
- Create: `src/pages/AdminDatabaseSpace.tsx`
- Modify: `src/App.tsx` (lazy route `database-space`), and `src/components/AdminLayout.tsx` (a System entry "Database Space", icon `Database`, permKey `system`, plus the route-permission map).
- Test: `src/test/db-space.test.tsx`

- [ ] **Step 1:** Write the tests:
  - `formatBytes(1018 * 1024 * 1024)` is `"1018 MB"`, `formatBytes(2615 * 1024 * 1024)` is `"2.55 GB"`, and `formatBytes(8088 * 1024)` is `"7.9 MB"`
  - `addDeleted` sums keys
  - the page renders total size and the table rows from a mocked `admin_db_space`
  - Clean now calls `admin_db_cleanup_now` until `more_remaining` is false, shows `Deleted 7,000 old rows`, and reloads the sizes
  - an RPC error shows a toast and still reloads
  - the page never calls `from("orders")`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the page, the helpers, the route and the nav entry.
- [ ] **Step 4:** Run `npx vitest run --no-file-parallelism`. Expected: the whole suite passes. Then run `tsc` and expect it clean.
- [ ] **Step 5:** Commit: `feat(db-space): admin Database Space page`.
