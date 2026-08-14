-- SECURITY FIX: 20260430030000_master_security_hardening.sql added an
-- admin-only SELECT policy on admin_action_log but never dropped the original
-- wide-open "admin_log_select"/"admin_log_insert" policies from
-- 20260428140000_security_features.sql. Postgres RLS policies are OR'd
-- together, so the original USING(true)/WITH CHECK(true) policies have been
-- silently granting every authenticated user full read access to the admin
-- audit log (admin emails, target emails, actions, metadata) AND the ability
-- to insert forged audit entries, the entire time since that "hardening"
-- migration ran. This closes that gap for real.

DROP POLICY IF EXISTS "admin_log_select" ON public.admin_action_log;
DROP POLICY IF EXISTS "admin_log_insert" ON public.admin_action_log;

DROP POLICY IF EXISTS "Enable insert access for admins on admin_action_log" ON public.admin_action_log;
CREATE POLICY "Enable insert access for admins on admin_action_log"
ON public.admin_action_log FOR INSERT
TO authenticated
WITH CHECK ( public.has_role(auth.uid(), 'admin') );
