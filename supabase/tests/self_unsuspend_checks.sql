-- Checks for 20261124200000_self_unsuspend_requests.sql. Read-only and safe on production
-- (reads catalogs only, inside a rolled-back transaction). No error = passed.
BEGIN;

DO $$
DECLARE v_bad text;
BEGIN
  IF to_regclass('public.account_unsuspend_requests') IS NULL THEN RAISE EXCEPTION 'FAIL: table missing'; END IF;

  -- users can never read the code's digest or attempt count
  IF has_column_privilege('authenticated', 'public.account_unsuspend_requests', 'otp_digest', 'SELECT')
     OR has_column_privilege('anon', 'public.account_unsuspend_requests', 'otp_digest', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: signed-in users can read otp_digest';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.account_unsuspend_requests', 'status', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: users cannot see their request status';
  END IF;

  -- nobody but the function (service role) writes requests
  IF has_table_privilege('authenticated', 'public.account_unsuspend_requests', 'INSERT')
     OR has_table_privilege('authenticated', 'public.account_unsuspend_requests', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.account_unsuspend_requests', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL: signed-in users can write unsuspend requests';
  END IF;

  -- not in realtime (it would send whole rows, including the digest)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public' AND tablename = 'account_unsuspend_requests') THEN
    RAISE EXCEPTION 'FAIL: account_unsuspend_requests is in realtime';
  END IF;

  -- the read policy is own rows, or an admin with 2FA
  SELECT string_agg(policyname, ', ') INTO v_bad FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'account_unsuspend_requests'
     AND NOT (roles = ARRAY['service_role']::name[])
     AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT ILIKE '%is_admin()%');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: unexpected policies: %', v_bad; END IF;
END $$;

SELECT 'self-unsuspend checks passed' AS result;
ROLLBACK;
