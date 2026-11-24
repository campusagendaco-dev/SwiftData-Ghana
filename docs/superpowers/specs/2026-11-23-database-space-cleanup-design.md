# Database space cleanup: design

**Status:** approved by the owner on 2026-11-23 ("yes build both with those periods").

**Change (2026-11-24, owner ruling):** customer notifications are left to the existing `cleanup-old-notifications` job (03:30 UTC: read after 14 days, broadcasts and automated after 7, everything after 30). That job already deletes sooner than the "read and older than 60 days" rule below, which is therefore dropped. The page shows the job's real rules.

## Why
Supabase warned that the database is too large (2,615 MB), and the admin area feels slow. About 2 GB of that is logs and job history that nothing cleans up. Orders are only 202 MB.

## Goals
1. **Automatic nightly cleanup** removes old rows using these retention periods:
   - `cron.job_run_details`: 7 days (by `start_time`)
   - `public.system_logs`: 30 days (by `ts`)
   - `public.push_notification_logs`: 30 days (by `created_at`)
   - `public.sms_logs`: 90 days (by `created_at`)
   - `public.security_logs`: 90 days (by `created_at`)
   - `public.user_notifications`: only rows with `read = true` older than 60 days (by `created_at`)
2. **An admin "Database Space" page** under System shows:
   - the total database size, and the size, approximate row count and retention period of each cleaned table
   - the last cleanup run: when it ran, whether it was nightly or manual, and the rows deleted per table
   - a **Clean now** button
   - the one-time "compact" SQL that hands freed space back to disk, ready to copy

## Non-goals and anti-goals
- Never touch orders, payments, wallets, profiles or any table outside the list above. A cleanup that can reach money records has failed.
- Retention periods are fixed in SQL. There is no editor on the page.
- No automatic `VACUUM FULL`. Postgres can't run it inside a function, and it locks tables. It stays a one-time manual paste.

## Constraints
- `supabase db push` is never used. The migration is applied by pasting a single file into the SQL editor.
- Admin calls run under PostgREST's roughly 8 second statement timeout. The manual cleanup works in batches with a time budget of about 5 seconds and reports whether more rows remain. The page keeps calling until nothing is left. The nightly run has no time budget.
- The admin functions require a full admin, and a user session must be 2FA-verified (`aal2`). The production `is_admin()` no longer checks that.
- Deletes use fixed SQL per table. There is no dynamic SQL built from input.

## Approach
- **Chosen:** a migration adds `db_cleanup_runs` (a run log readable by admins), an internal `run_db_retention(source, budget_ms, triggered_by)`, admin RPCs `admin_db_space()` and `admin_db_cleanup_now()`, and a nightly pg_cron job at 03:20 UTC. The page uses the two RPCs.
- **Rejected:** an Edge Function. It would be one more deploy, and the work is purely database work.
- **Rejected:** manual buttons only. The warning would come back whenever someone forgot.
