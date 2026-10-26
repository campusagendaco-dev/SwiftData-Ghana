-- ============================================================================================
-- FIX STATEMENT TIMEOUT (HTTP 500) ON system_logs
-- 
-- Root Cause:
-- The RLS policy "admins_read_system_logs" called is_admin() directly:
--   USING (is_admin())
-- With 540,000+ rows in public.system_logs, PostgreSQL executes is_admin() as a correlated
-- subquery for EVERY row examined, hitting the statement timeout (57014) and throwing HTTP 500.
--
-- Fix:
-- 1. Wrap the check in (SELECT public.is_admin()) to turn it into an InitPlan (evaluated ONCE).
-- 2. Revoke public/anon read so unauthenticated callers receive instant 401 instead of timing out.
-- ============================================================================================

DROP POLICY IF EXISTS "admins_read_system_logs" ON public.system_logs;
CREATE POLICY "admins_read_system_logs" ON public.system_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "admins_update_system_logs" ON public.system_logs;
CREATE POLICY "admins_update_system_logs" ON public.system_logs
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()));

-- Revoke anon access from system_logs completely
REVOKE ALL ON public.system_logs FROM anon;
