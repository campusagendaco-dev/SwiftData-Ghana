-- Checks for 20261124210000_admin_sms_login_hardening.sql. Read-only and safe on production:
-- everything runs in a transaction that is rolled back. No error = passed.
BEGIN;

DO $$
DECLARE
  v_admin uuid;
  v_bad text;
BEGIN
  -- (a) SMS login is off unless another admin switches it on
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_roles'
                  AND column_name = 'otp_login_approved' AND column_default ILIKE '%false%') THEN
    RAISE EXCEPTION 'FAIL (a): otp_login_approved does not default to false';
  END IF;

  -- (b) everyone switched on has a pinned Ghana phone
  SELECT string_agg(user_id::text, ', ') INTO v_bad FROM public.user_roles
   WHERE otp_login_approved = true AND (otp_phone IS NULL OR otp_phone !~ '^233[0-9]{9}$');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL (b): SMS login on without a pinned phone: %', v_bad; END IF;

  -- (c) nobody signed in can read SMS sessions (code hashes)
  IF to_regclass('public.admin_otp_sessions') IS NOT NULL
     AND has_table_privilege('authenticated', 'public.admin_otp_sessions', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL (c): signed-in users can read admin_otp_sessions';
  END IF;

  -- (d) functions that change money/orders/accounts/admin roles need the authenticator app
  SELECT string_agg(p.proname, ', ') INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname NOT IN ('is_admin', 'has_role', 'admin_strong', 'has_valid_admin_otp_session')
     AND p.prosrc ~* '(public\.)?is_admin\(\)'
     AND (p.prosrc ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(wallets|wallet_ledger|withdrawals|user_roles|orders|providers|system_settings|profiles|wallet_adjustment_requests|promo_codes|promo_claims|security_blacklist)\y'
          OR p.prosrc ~* '(credit_wallet|debit_wallet|refund_failed_order|redeem_loyalty_points_to_wallet)\s*\(');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL (d): functions that still accept an SMS login: %', v_bad; END IF;

  -- (e) write rules on those tables need the authenticator app
  SELECT string_agg(tablename || '/' || policyname, ', ') INTO v_bad FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('wallets', 'wallet_ledger', 'withdrawals', 'user_roles', 'orders', 'providers', 'system_settings',
                       'profiles', 'wallet_adjustment_requests', 'promo_codes', 'promo_claims', 'security_blacklist')
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     AND (coalesce(qual, '') ~* 'is_admin\(\)' OR coalesce(with_check, '') ~* 'is_admin\(\)');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL (e): write rules that still accept an SMS login: %', v_bad; END IF;

  -- (f) an SMS session lets an admin view, but never passes admin_strong()
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' ORDER BY user_id LIMIT 1;
  IF v_admin IS NOT NULL AND to_regclass('public.admin_otp_sessions') IS NOT NULL THEN
    UPDATE public.user_roles SET otp_login_approved = true, otp_phone = '233200000000' WHERE user_id = v_admin AND role = 'admin';
    EXECUTE 'INSERT INTO public.admin_otp_sessions (user_id, session_id, phone, verified_at, expires_at) VALUES ($1, ''zz-check'', ''233200000000'', now(), now() + interval ''1 hour'')' USING v_admin;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1', 'session_id', 'zz-check')::text, true);
    IF public.admin_strong() THEN RAISE EXCEPTION 'FAIL (f): an SMS session passes admin_strong()'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    IF NOT public.admin_strong() THEN RAISE EXCEPTION 'FAIL (f): admin_strong() refuses the authenticator app'; END IF;
  END IF;
END $$;

SELECT 'admin SMS login checks passed' AS result;
ROLLBACK;
