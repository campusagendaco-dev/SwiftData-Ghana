-- ══════════════════════════════════════════════════════════════
-- EMERGENCY SECURITY PATCH: Revoke Anonymous Orders Data Leak
-- Date: 2026-06-18
-- Fixes: "Got access to admin dashboard without credentials" vulnerability
-- ══════════════════════════════════════════════════════════════

-- The previous policy "Anon can view orders by id" used `USING (id IS NOT NULL)`
-- which inadvertently allowed ANY anonymous user to fetch ALL orders.
-- We are dropping this policy entirely. 
-- If unauthenticated order tracking is required, it must be handled
-- via a secure edge function using the service_role key, not via public RLS.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'orders' 
      AND policyname = 'Anon can view orders by id'
  ) THEN
    DROP POLICY "Anon can view orders by id" ON public.orders;
  END IF;
END $$;

-- Explicitly create a deny-all policy for anon to prevent future leaks.
-- (Note: in Postgres RLS, permissive policies are combined with OR, so dropping the 
-- permissive policy above is the real fix. This policy acts as a safe default).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'orders' 
      AND policyname = 'Deny anon access to orders'
  ) THEN
    CREATE POLICY "Deny anon access to orders" ON public.orders
      FOR SELECT TO anon
      USING (false);
  END IF;
END $$;
