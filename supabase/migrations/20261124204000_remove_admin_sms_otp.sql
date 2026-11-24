-- Remove the SMS-code alternative to admin 2FA (owner decision 2026-11-24: "A, remove it").
-- The other tool applied 20261124193000_admin_sms_otp_auth.sql in production, which let a
-- valid SMS session count as admin in is_admin()/has_role(). This puts back the 2FA-only
-- versions (same as 20261124120000) and removes the SMS session function and table, so the
-- still-deployed admin-otp-auth function can't create sessions.
-- Safe to run even if the SMS SQL was never applied. Apply in the SQL editor (never db push),
-- then run supabase/tests/admin_mfa_checks.sql (no error = passed).

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
  AND (
    _role <> 'admin'
    OR _user_id IS DISTINCT FROM auth.uid()
    OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;

DROP FUNCTION IF EXISTS public.has_valid_admin_otp_session();
DROP TABLE IF EXISTS public.admin_otp_sessions;
