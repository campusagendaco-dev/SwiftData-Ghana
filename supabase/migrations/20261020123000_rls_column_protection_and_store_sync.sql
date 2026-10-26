-- ============================================================================
-- RLS column protection & store sync (RECONCILED 2026-10-26)
--
-- NOTE: The original version of this migration defined
--   * trg_protect_profile_sensitive_columns  (BEFORE UPDATE on profiles)
--   * trg_sync_profile_to_reseller_store     (AFTER INSERT/UPDATE on profiles)
-- Both were REMOVED because:
--   1. Production already enforces the same rules via
--      tr_protect_profile_fields -> protect_profile_privileged_fields() and
--      trigger_sync_profile_to_reseller_store -> sync_profile_to_reseller_store().
--   2. The protection trigger referenced columns that do NOT exist on
--      public.profiles (balance, is_approved, loyalty_points, referral_earnings,
--      total_gb_purchased). PL/pgSQL resolves NEW.<col> at runtime, so EVERY
--      profile UPDATE would have failed with "record new has no field ...".
--   3. A second sync trigger would race the existing one on reseller_stores.slug.
-- Indexes already present in prod (status/created_at, agent_id/created_at,
-- profiles.slug unique, reseller_stores user_id/slug) were dropped from this file.
-- ============================================================================

-- 1. LOCK DOWN v_system_settings_with_secrets (SERVICE_ROLE ONLY)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'v_system_settings_with_secrets'
  ) THEN
    REVOKE ALL ON TABLE public.v_system_settings_with_secrets FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE public.v_system_settings_with_secrets TO service_role, postgres;
  END IF;
END $$;

-- 2. LOCK DOWN public.wallets (READ-ONLY FOR CLIENTS, MUTATE VIA RPC/SERVICE_ROLE)
--    The frontend never writes wallets directly; all mutations go through
--    SECURITY DEFINER RPCs or Edge Functions (service_role).
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallets FROM anon, authenticated;
GRANT SELECT ON TABLE public.wallets TO authenticated;
GRANT ALL ON TABLE public.wallets TO service_role;

-- 3. MISSING HOT-PATH INDEXES
--    (Applied to prod with CREATE INDEX CONCURRENTLY; IF NOT EXISTS keeps this idempotent.)
CREATE INDEX IF NOT EXISTS idx_orders_provider_order_id_partial
  ON public.orders (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_created_at_desc
  ON public.orders (customer_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_parent_agent_id_partial
  ON public.profiles (parent_agent_id)
  WHERE parent_agent_id IS NOT NULL;
