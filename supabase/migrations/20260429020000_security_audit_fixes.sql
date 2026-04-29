-- CYBER SECURITY REINFORCEMENT V3 (FIXED V2)
-- Comprehensive audit and hardening using Triggers and RLS.

-- ════════════════════════════════════════════════════════════
-- 1. HARDEN: Profiles Table (Trigger-based Protection)
-- ════════════════════════════════════════════════════════════

-- Create a function to block unauthorized changes to privileged fields
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- If the user is an admin, let them change anything
    IF public.has_role(auth.uid(), 'admin') THEN
        RETURN NEW;
    END IF;

    -- If NOT an admin, check for tampering
    IF (
        NEW.is_agent IS DISTINCT FROM OLD.is_agent OR
        NEW.agent_approved IS DISTINCT FROM OLD.agent_approved OR
        NEW.is_sub_agent IS DISTINCT FROM OLD.is_sub_agent OR
        NEW.sub_agent_approved IS DISTINCT FROM OLD.sub_agent_approved OR
        NEW.agent_prices IS DISTINCT FROM OLD.agent_prices OR
        NEW.markups IS DISTINCT FROM OLD.markups OR
        NEW.is_api_user IS DISTINCT FROM OLD.is_api_user OR
        NEW.api_status IS DISTINCT FROM OLD.api_status
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You cannot change privileged profile fields.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply the trigger
DROP TRIGGER IF EXISTS tr_protect_profile_fields ON public.profiles;
CREATE TRIGGER tr_protect_profile_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- Restore a simple RLS policy for profiles
DROP POLICY IF EXISTS "Users update own profile strictly" ON public.profiles;
DROP POLICY IF EXISTS "Users update own safe fields" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════
-- 2. HARDEN: System Settings (Prevent Secret Leakage)
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage settings" ON public.system_settings;
DROP POLICY IF EXISTS "Anyone reads settings" ON public.system_settings;

-- Only admins can read the raw settings table
CREATE POLICY "Admins manage settings" ON public.system_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Revoke direct SELECT to prevent leakage via direct API calls
REVOKE SELECT ON public.system_settings FROM authenticated;
GRANT SELECT ON public.public_system_settings TO authenticated, anon;

-- ════════════════════════════════════════════════════════════
-- 3. HARDEN: Withdrawals (Strict RPC Enforcement)
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Admins manage withdrawals" ON public.withdrawals;

CREATE POLICY "Users view own withdrawals" ON public.withdrawals
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid());

CREATE POLICY "Admins manage withdrawals" ON public.withdrawals
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Strictly block direct INSERT except for service_role/admin
DROP POLICY IF EXISTS "No direct withdrawal insert" ON public.withdrawals;
DROP POLICY IF EXISTS "Admins direct insert" ON public.withdrawals;
CREATE POLICY "Admins direct insert" ON public.withdrawals
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ════════════════════════════════════════════════════════════
-- 4. HARDEN: Wallets (Strict Access)
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own wallet" ON public.wallets;
CREATE POLICY "Users view own wallet" ON public.wallets
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ════════════════════════════════════════════════════════════
-- 5. HARDEN: Audit Logs (Consistency)
-- ════════════════════════════════════════════════════════════
-- Ensure admin_id matches the authenticated user
DROP POLICY IF EXISTS "Authenticated users create audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Users create own audit logs" ON audit_logs;
CREATE POLICY "Admins create audit logs" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = admin_id 
    AND public.has_role(auth.uid(), 'admin')
  );
