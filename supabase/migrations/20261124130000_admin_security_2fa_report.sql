-- Read-only 2FA health report for the admin Security page ("Database 2FA check" card).
--
-- Answers:
--   * do public.is_admin() and public.has_role() require a completed 2FA login?
--   * which live RLS policies check user_roles for admin on their own, without
--     is_admin()/has_role() — those don't get the 2FA requirement from the functions.
--
-- Only a signed-in admin whose session completed 2FA may run it. The aal2 check is done
-- here as well, so it holds even before 20261124120000 is applied.
-- Changes nothing. Apply by pasting this file into the Supabase SQL editor (never db push).

CREATE OR REPLACE FUNCTION public.admin_security_2fa_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policies jsonb;
BEGIN
  IF NOT public.is_admin() OR coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object('table', p.schemaname || '.' || p.tablename, 'policy', p.policyname, 'command', p.cmd)
             ORDER BY p.schemaname, p.tablename, p.policyname),
           '[]'::jsonb)
    INTO v_policies
    FROM pg_catalog.pg_policies p
   CROSS JOIN LATERAL (SELECT coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') AS expr) e
   WHERE e.expr ILIKE '%user_roles%'
     AND e.expr ILIKE '%admin%'
     AND e.expr NOT ILIKE '%is_admin()%'
     AND e.expr NOT ILIKE '%has_role(%';

  RETURN jsonb_build_object(
    'is_admin_requires_2fa', pg_get_functiondef('public.is_admin()'::regprocedure) ILIKE '%aal%',
    'has_role_requires_2fa', pg_get_functiondef('public.has_role(uuid, public.app_role)'::regprocedure) ILIKE '%aal%',
    'policies', v_policies
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_security_2fa_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_security_2fa_report() TO authenticated;
