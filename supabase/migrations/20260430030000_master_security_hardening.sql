-- MASTER SECURITY HARDENING
-- This migration revokes public access from all administrative and financial RPCs 
-- to prevent potential logic bypasses or data exposure.

-- 1. Revoke from PUBLIC (authenticated/anon)
REVOKE EXECUTE ON FUNCTION public.purge_test_accounts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_suspend_users(UUID[], BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_velocity_accounts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_wallet(UUID, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debit_wallet(UUID, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_wallet(UUID, DECIMAL) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debit_wallet(UUID, DECIMAL) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_withdrawal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_user_suspension(UUID, BOOLEAN) FROM PUBLIC;

-- 2. Ensure service_role has access (Edge Functions use this)
GRANT EXECUTE ON FUNCTION public.purge_test_accounts() TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_suspend_users(UUID[], BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_velocity_accounts() TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, DECIMAL) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(UUID, DECIMAL) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_withdrawal(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.toggle_user_suspension(UUID, BOOLEAN) TO service_role;

-- 3. Audit RLS on admin_action_log
ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read access for admins on admin_action_log" ON public.admin_action_log;
CREATE POLICY "Enable read access for admins on admin_action_log"
ON public.admin_action_log FOR SELECT
TO authenticated
USING ( public.has_role(auth.uid(), 'admin') );

-- 4. Audit RLS on security_blacklist
ALTER TABLE public.security_blacklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read access for admins on security_blacklist" ON public.security_blacklist;
CREATE POLICY "Enable read access for admins on security_blacklist"
ON public.security_blacklist FOR SELECT
TO authenticated
USING ( public.has_role(auth.uid(), 'admin') );

-- 5. Harden system_settings (Ensure secrets are never exposed)
-- The public_system_settings view already handles this, but let's double check RLS.
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can do everything on system_settings" ON public.system_settings;
CREATE POLICY "Admins can do everything on system_settings"
ON public.system_settings FOR ALL
TO authenticated
USING ( public.has_role(auth.uid(), 'admin') )
WITH CHECK ( public.has_role(auth.uid(), 'admin') );
