-- Admin SMS login hardening (owner decision 2026-11-24, option B).
-- Keeps the SMS login for viewing and everyday admin work, and makes money, sends and
-- admin-access changes need the authenticator app (aal2):
--   1. SMS login off by default; switched on per admin by another admin (admin-otp-auth
--      set_approval). Admins already switched on stay on, but their code now goes only to
--      the phone on their profile TODAY, pinned in user_roles.otp_phone (editing the
--      profile phone no longer redirects codes). Admins with no valid phone are switched off.
--   2. Code hashes are no longer readable by anyone but the function; open SMS sessions end
--      (everyone signs in again once).
--   3. public.admin_strong(): admin + authenticator app. Every live database function that
--      changes money, orders, providers, settings, accounts or admin roles, and every write
--      rule on those tables, is switched from is_admin() to admin_strong(), editing the
--      definitions as they are in the database now.
-- Safe to run twice. Apply in the SQL editor (never db push), then run
-- supabase/tests/admin_sms_login_checks.sql (no error = passed).

-- 1. Per-admin switch, pinned phone
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS otp_login_approved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.user_roles ALTER COLUMN otp_login_approved SET DEFAULT false;
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS otp_phone TEXT;

UPDATE public.user_roles ur
   SET otp_phone = CASE
         WHEN d ~ '^233[0-9]{9}$' THEN d
         WHEN d ~ '^0[0-9]{9}$' THEN '233' || substr(d, 2)
         WHEN d ~ '^[0-9]{9}$' THEN '233' || d
       END
  FROM (SELECT user_id, regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS d FROM public.profiles) p
 WHERE p.user_id = ur.user_id AND ur.role = 'admin' AND ur.otp_login_approved = true AND ur.otp_phone IS NULL;
UPDATE public.user_roles SET otp_login_approved = false
 WHERE otp_login_approved = true AND (role <> 'admin' OR otp_phone IS NULL OR otp_phone !~ '^233[0-9]{9}$');

-- 2. Sessions: function-only, and every open session ends now
DO $$
BEGIN
  IF to_regclass('public.admin_otp_sessions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins read own otp sessions" ON public.admin_otp_sessions';
    EXECUTE 'REVOKE ALL ON public.admin_otp_sessions FROM anon, authenticated';
    EXECUTE 'UPDATE public.admin_otp_sessions SET expires_at = now() WHERE expires_at > now()';
  END IF;
END $$;

-- An SMS session only counts for admins switched on with a pinned phone.
DO $$
BEGIN
  IF to_regclass('public.admin_otp_sessions') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.has_valid_admin_otp_session()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $b$
        SELECT EXISTS (
          SELECT 1 FROM public.user_roles ur
          JOIN public.admin_otp_sessions s ON s.user_id = ur.user_id
          WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
            AND ur.otp_login_approved = true AND ur.otp_phone ~ '^233[0-9]{9}$'
            AND s.session_id = coalesce(auth.jwt() ->> 'session_id', '') AND s.session_id <> ''
            AND s.verified_at IS NOT NULL AND s.expires_at > now()
        );
      $b$;
    $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.has_valid_admin_otp_session() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.has_valid_admin_otp_session() TO authenticated, service_role';
  END IF;
END $$;

-- 3. Admin + authenticator app
CREATE OR REPLACE FUNCTION public.admin_strong()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
     AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
REVOKE ALL ON FUNCTION public.admin_strong() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_strong() TO authenticated, service_role;

-- 3a. Live functions that change money/orders/providers/settings/accounts/admin roles.
CREATE OR REPLACE FUNCTION pg_temp.is_sensitive_writer(src text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT src ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(wallets|wallet_ledger|withdrawals|user_roles|orders|providers|system_settings|profiles|wallet_adjustment_requests|promo_codes|promo_claims|security_blacklist)\y'
      OR src ~* '(credit_wallet|debit_wallet|refund_failed_order|redeem_loyalty_points_to_wallet)\s*\(';
$$;

DO $$
DECLARE
  f record;
  def text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname NOT IN ('is_admin', 'has_role', 'admin_strong', 'has_valid_admin_otp_session')
       AND p.prosrc ~* '(public\.)?is_admin\(\)'
       AND pg_temp.is_sensitive_writer(p.prosrc)
  LOOP
    def := regexp_replace(pg_get_functiondef(f.oid), '(public\.)?is_admin\(\)', 'public.admin_strong()', 'gi');
    EXECUTE def;
    RAISE NOTICE 'now needs the authenticator app: %', f.proname;
  END LOOP;
END $$;

-- 3b. Write rules on those tables. A FOR ALL rule becomes authenticator-only, plus a
--     separate read rule so SMS logins can still view.
DO $$
DECLARE
  pol record;
  q text;
  c text;
BEGIN
  FOR pol IN
    SELECT * FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('wallets', 'wallet_ledger', 'withdrawals', 'user_roles', 'orders', 'providers', 'system_settings',
                         'profiles', 'wallet_adjustment_requests', 'promo_codes', 'promo_claims', 'security_blacklist')
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       AND (coalesce(qual, '') ~* 'is_admin\(\)' OR coalesce(with_check, '') ~* 'is_admin\(\)')
  LOOP
    q := regexp_replace(pol.qual, '(public\.)?is_admin\(\)', 'public.admin_strong()', 'gi');
    c := regexp_replace(pol.with_check, '(public\.)?is_admin\(\)', 'public.admin_strong()', 'gi');
    IF pol.cmd = 'ALL' AND pol.qual IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', left(pol.policyname, 50) || ' (view)', pol.tablename);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (%s)',
                     left(pol.policyname, 50) || ' (view)', pol.tablename,
                     array_to_string(ARRAY(SELECT quote_ident(r) FROM unnest(pol.roles) r), ', '), pol.qual);
    END IF;
    IF pol.cmd = 'INSERT' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', pol.policyname, pol.tablename, c);
    ELSIF c IS NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', pol.policyname, pol.tablename, q);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', pol.policyname, pol.tablename, coalesce(q, 'true'), c);
    END IF;
    RAISE NOTICE 'rule now needs the authenticator app: %.%', pol.tablename, pol.policyname;
  END LOOP;
END $$;
