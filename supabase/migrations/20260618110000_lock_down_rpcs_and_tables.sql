-- ══════════════════════════════════════════════════════════════
-- FINAL SECURITY HARDENING: Lock Down RPCs & Add Missing Guards
-- Date: 2026-06-18
-- Fixes HIGH & MEDIUM severity DB-level vulnerabilities
-- ══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- 1. Lock down world cup match settling RPC to service_role only
--    Prevents users from calling it directly to award themselves points
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'system_settle_world_cup_match_v2'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.system_settle_world_cup_match_v2 FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.system_settle_world_cup_match_v2 FROM anon;
    REVOKE EXECUTE ON FUNCTION public.system_settle_world_cup_match_v2 FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.system_settle_world_cup_match_v2 TO service_role;
  END IF;
END $$;

-- Also lock older version if exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'system_settle_world_cup_match'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.system_settle_world_cup_match FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.system_settle_world_cup_match FROM anon;
    REVOKE EXECUTE ON FUNCTION public.system_settle_world_cup_match FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.system_settle_world_cup_match TO service_role;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2. Protect world_cup_predictions table
--    Users should only be able to INSERT/SELECT their own predictions
--    Cannot update/delete predictions after submission (prevents gaming)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'world_cup_predictions'
  ) THEN
    ALTER TABLE public.world_cup_predictions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "users_manage_own_predictions" ON public.world_cup_predictions;
    DROP POLICY IF EXISTS "users_insert_predictions" ON public.world_cup_predictions;
    DROP POLICY IF EXISTS "users_read_own_predictions" ON public.world_cup_predictions;

    -- Users can only insert their own predictions
    CREATE POLICY "users_insert_predictions" ON public.world_cup_predictions
      FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());

    -- Users can read their own predictions
    CREATE POLICY "users_read_own_predictions" ON public.world_cup_predictions
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());

    -- NO UPDATE/DELETE policy = predictions are immutable after submission
    -- Service role bypasses RLS for administrative operations
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. Add world_cup_matches RLS (public read, admin/service write)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'world_cup_matches'
  ) THEN
    ALTER TABLE public.world_cup_matches ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "public_read_matches" ON public.world_cup_matches;
    CREATE POLICY "public_read_matches" ON public.world_cup_matches
      FOR SELECT TO anon, authenticated
      USING (true); -- Matches are public info

    -- No INSERT/UPDATE/DELETE policies for users — only service_role can modify
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 4. Protect promo_codes from direct client access
--    Validation happens server-side through edge function
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'promo_codes'
  ) THEN
    ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

    -- Remove any existing permissive policies
    DROP POLICY IF EXISTS "public_read_promo_codes" ON public.promo_codes;
    DROP POLICY IF EXISTS "anon_read_promo_codes" ON public.promo_codes;

    -- Only service_role (edge functions) can read/write promo_codes
    -- This forces all validation through the rate-limited edge function
    -- No policies = total deny for anon/authenticated
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 5. Harden promo_claims table
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'promo_claims'
  ) THEN
    ALTER TABLE public.promo_claims ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "users_read_own_claims" ON public.promo_claims;
    CREATE POLICY "users_read_own_claims" ON public.promo_claims
      FOR SELECT TO authenticated
      USING (
        claimed_by_phone IN (
          SELECT phone FROM public.profiles WHERE user_id = auth.uid()
        )
      );

    -- No client INSERT: claims are created server-side only
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 6. Lock the credit_order_profits function to service_role
--    Prevents users from manually crediting themselves profits
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'credit_order_profits'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.credit_order_profits FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.credit_order_profits FROM anon;
    REVOKE EXECUTE ON FUNCTION public.credit_order_profits FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.credit_order_profits TO service_role;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 7. Lock admin_apply_wallet_restoration to service_role
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'admin_apply_wallet_restoration'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.admin_apply_wallet_restoration FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.admin_apply_wallet_restoration FROM anon;
    REVOKE EXECUTE ON FUNCTION public.admin_apply_wallet_restoration FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_apply_wallet_restoration TO service_role;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 8. Ensure check_and_increment_rate_limit is service_role only
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'check_and_increment_rate_limit'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit FROM anon;
    REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit TO service_role;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 9. Add index on security_logs for faster admin queries
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'security_logs'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_security_logs_action ON public.security_logs(action);
    CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON public.security_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_logs_ip ON public.security_logs(ip_address) 
      WHERE ip_address IS NOT NULL;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 10. Add a cleanup trigger to purge old rate limit counters
--     (prevents generic_rate_limit_counters from growing unbounded)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_counters()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove counters older than 5 minutes (well past the 1-minute window)
  DELETE FROM public.generic_rate_limit_counters
  WHERE window_start < NOW() - INTERVAL '5 minutes';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_counters() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_counters() TO service_role;

-- Schedule cleanup to run every 5 minutes to keep table lean
SELECT cron.unschedule(jobname) 
FROM cron.job 
WHERE jobname = 'cleanup-rate-limit-counters';

SELECT cron.schedule(
  'cleanup-rate-limit-counters',
  '*/5 * * * *',
  'SELECT public.cleanup_rate_limit_counters();'
);

COMMENT ON FUNCTION public.cleanup_rate_limit_counters() IS 
'Removes stale rate limit counter rows older than 5 minutes to prevent unbounded table growth.';
