-- Restore the 2FA requirement on the database's admin checks.
--
-- 20260618124000 made public.is_admin() require a completed 2FA login (aal2).
-- 20260801020000 rewrote it for faster order queries and dropped that check, so any
-- admin account signed in with only a password passed every RLS policy that uses it.
-- public.has_role(auth.uid(), 'admin') (100 policy and function uses) never had the check.
--
-- After this migration:
-- * is_admin() is true only for an admin whose session completed 2FA.
-- * has_role(x, 'admin') asks for 2FA only when x is the signed-in caller, i.e. when the
--   caller claims admin rights for themselves. Asking whether some other user is an
--   admin works as before; that covers backend functions using the service key, scheduled
--   jobs and the SQL editor, which have no signed-in user. Other roles are unchanged.
--
-- The admin pages already force every admin to set up 2FA and enter the code, so admins
-- who use the site normally are not affected.
-- Apply by pasting this file into the Supabase SQL editor (never `supabase db push`).
-- Checks: supabase/tests/admin_mfa_checks.sql (read-only, safe on production).

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
