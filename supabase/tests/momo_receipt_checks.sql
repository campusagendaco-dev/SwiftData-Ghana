-- Checks for 20261124190000_momo_receipt_checks.sql. Read-only and safe on production:
-- it reads catalogs and tries one rolled-back pair of inserts inside a transaction.
-- Any problem stops with "FAIL: ..."; no error = passed.
BEGIN;

DO $$
DECLARE
  v_bad text;
  v_dup_blocked boolean := false;
BEGIN
  IF to_regclass('public.momo_receipt_checks') IS NULL OR to_regclass('public.momo_receiving_accounts') IS NULL THEN
    RAISE EXCEPTION 'FAIL: tables missing';
  END IF;

  -- every policy for signed-in users requires an admin with 2FA
  SELECT string_agg(tablename || '/' || policyname, ', ') INTO v_bad
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename IN ('momo_receipt_checks', 'momo_receiving_accounts')
     AND NOT (roles = ARRAY['service_role']::name[])
     AND NOT (coalesce(qual, '') ILIKE '%is_admin()%' AND (with_check IS NULL OR with_check ILIKE '%is_admin()%'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: policies without is_admin(): %', v_bad; END IF;

  -- admins can only read checks; checks are written by the function (service role)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'momo_receipt_checks'
               AND NOT (roles = ARRAY['service_role']::name[]) AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: signed-in users can write receipt checks';
  END IF;

  -- a transaction id can be accepted only once
  INSERT INTO public.momo_receipt_checks (transaction_id, verdict, risk_level, decision) VALUES ('ZZTESTCHECK0001', 'no_red_flags', 'low', 'accepted');
  BEGIN
    INSERT INTO public.momo_receipt_checks (transaction_id, verdict, risk_level, decision) VALUES ('ZZTESTCHECK0001', 'no_red_flags', 'low', 'accepted');
  EXCEPTION WHEN unique_violation THEN v_dup_blocked := true;
  END;
  IF NOT v_dup_blocked THEN RAISE EXCEPTION 'FAIL: the same transaction id could be accepted twice'; END IF;
END $$;

SELECT 'momo receipt checks passed' AS result;
ROLLBACK;
