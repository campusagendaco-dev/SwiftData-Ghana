-- ══════════════════════════════════════════════════════════════
-- EMERGENCY SECURITY PATCH: Database-Level MFA Enforcement
-- Date: 2026-06-18
-- Fixes: "Got access to admin dashboard bypassing authenticator"
-- ══════════════════════════════════════════════════════════════

-- Overwrite the core is_admin() function to strictly enforce MFA (AAL2)
-- This function is used by almost every critical RLS policy in the system.
-- Any user who connects with an aal1 (password only) session will be blocked.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() 
      AND role = 'admin'
      -- Require AAL2 (MFA Verified) for any JWT coming from a user session
      AND (
        (auth.jwt() ->> 'aal') = 'aal2'
        OR 
        -- Bypass AAL check only for backend Edge Functions using service_role keys
        (auth.jwt() ->> 'role') = 'service_role'
      )
  );
$$;
