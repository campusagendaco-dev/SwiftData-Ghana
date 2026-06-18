-- ══════════════════════════════════════════════════════════════
-- SECURITY PATCH: Fix partial migration from 20260618100000
-- Applies only the steps that were NOT yet applied:
--   - Wallet balance guard (NOT VALID to avoid breaking existing rows)
--   - All remaining steps from the partial migration
-- ══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- 4b. Wallet balance guard with NOT VALID
--     (previous attempt failed due to existing rows with negative balances)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'credit_order_profits'
  ) THEN
    ALTER TABLE public.wallets 
      DROP CONSTRAINT IF EXISTS wallets_balance_guard;
    
    -- NOT VALID = only validates NEW rows, does not scan existing data
    -- This protects going forward without breaking existing accounts
    ALTER TABLE public.wallets
      ADD CONSTRAINT wallets_balance_guard 
      CHECK (balance >= -COALESCE(credit_limit, 0)) NOT VALID;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 5. Lock down the process_auto_bridges_for_agent RPC
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'process_auto_bridges_for_agent'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.process_auto_bridges_for_agent FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.process_auto_bridges_for_agent FROM anon;
    REVOKE EXECUTE ON FUNCTION public.process_auto_bridges_for_agent FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.process_auto_bridges_for_agent TO service_role;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 6. Harden API: Lock ALL overloads of api.create_order_rpc to service_role
--    (function is overloaded so we must iterate each signature via pg_proc)
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  fn_sig TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api' AND p.proname = 'create_order_rpc'
  LOOP
    fn_sig := 'api.' || r.proname || '(' || r.args || ')';
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', fn_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn_sig);
    RAISE NOTICE 'Locked: %', fn_sig;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 7. system_secrets: Strict RLS — no reads from public
-- ────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.system_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_read_system_secrets" ON public.system_secrets;
DROP POLICY IF EXISTS "public_read_system_secrets" ON public.system_secrets;

-- ────────────────────────────────────────────────────────────
-- 8. v_system_settings_with_secrets: service_role only
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON public.v_system_settings_with_secrets FROM anon;
REVOKE ALL ON public.v_system_settings_with_secrets FROM authenticated;
GRANT SELECT ON public.v_system_settings_with_secrets TO service_role;

-- ────────────────────────────────────────────────────────────
-- 9. Audit trigger for system_settings
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_system_settings_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.security_logs (
    action,
    user_id,
    metadata,
    created_at
  ) VALUES (
    'system_settings_changed',
    auth.uid(),
    jsonb_build_object(
      'changed_by_role', current_role,
      'old_maintenance_mode', OLD.maintenance_mode,
      'new_maintenance_mode', NEW.maintenance_mode,
      'old_disable_ordering', OLD.disable_ordering,
      'new_disable_ordering', NEW.disable_ordering
    ),
    NOW()
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_system_settings_trigger ON public.system_settings;
CREATE TRIGGER audit_system_settings_trigger
  AFTER UPDATE ON public.system_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_system_settings_changes();

-- ────────────────────────────────────────────────────────────
-- 10. Security logs RLS
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'security_logs') THEN
    ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "admins_read_security_logs" ON public.security_logs;
    CREATE POLICY "admins_read_security_logs" ON public.security_logs
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

COMMENT ON FUNCTION public.auto_deliver_mashup_orders() IS 
'SECURITY: service_role only. Called by pg_cron to auto-deliver MTN Mash Up orders after configured delay.';
