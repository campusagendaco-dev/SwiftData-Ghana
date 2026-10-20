-- ============================================================================
-- 1. LOCK DOWN v_system_settings_with_secrets (SERVICE_ROLE ONLY)
-- ============================================================================
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

-- ============================================================================
-- 2. PROTECT SENSITIVE COLUMNS ON public.profiles FROM CLIENT ESCALATION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_protect_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := false;
BEGIN
  -- Allow service_role and SECURITY DEFINER functions (owned by postgres/supabase_admin)
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Check if the authenticated caller is a verified admin
  IF auth.uid() IS NOT NULL THEN
    BEGIN
      v_is_admin := public.has_role(auth.uid(), 'admin');
    EXCEPTION WHEN OTHERS THEN
      v_is_admin := false;
    END;
  END IF;

  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  -- Block privilege escalation and role/loyalty tampering from client JWTs
  IF NEW.is_agent IS DISTINCT FROM OLD.is_agent THEN
    RAISE EXCEPTION 'Cannot modify is_agent directly from client';
  END IF;

  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
    RAISE EXCEPTION 'Cannot modify is_approved directly from client';
  END IF;

  IF NEW.is_sub_agent IS DISTINCT FROM OLD.is_sub_agent THEN
    RAISE EXCEPTION 'Cannot modify is_sub_agent directly from client';
  END IF;

  IF NEW.loyalty_points IS DISTINCT FROM OLD.loyalty_points THEN
    RAISE EXCEPTION 'Cannot modify loyalty_points directly from client';
  END IF;

  IF NEW.referral_earnings IS DISTINCT FROM OLD.referral_earnings THEN
    RAISE EXCEPTION 'Cannot modify referral_earnings directly from client';
  END IF;

  IF NEW.total_gb_purchased IS DISTINCT FROM OLD.total_gb_purchased THEN
    RAISE EXCEPTION 'Cannot modify total_gb_purchased directly from client';
  END IF;

  -- Prevent users from modifying their own balance directly from client
  IF NEW.balance IS DISTINCT FROM OLD.balance AND (auth.uid() IS NULL OR OLD.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot modify own profile balance directly from client';
  END IF;

  -- Prevent silently hijacking parent_agent_id once set
  IF OLD.parent_agent_id IS NOT NULL AND NEW.parent_agent_id IS DISTINCT FROM OLD.parent_agent_id THEN
    RAISE EXCEPTION 'Cannot reassign parent_agent_id directly from client';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_profile_sensitive_columns();

-- ============================================================================
-- 3. LOCK DOWN public.wallets (READ-ONLY FOR OWNERS, MUTATE VIA RPC/SERVICE_ROLE)
-- ============================================================================
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallets FROM anon, authenticated;
GRANT SELECT ON TABLE public.wallets TO authenticated;
GRANT ALL ON TABLE public.wallets TO service_role;

-- ============================================================================
-- 4. SYNC public.profiles <-> public.reseller_stores FOR STOREFRONT AGENTS
-- Storefront agents (is_agent = true and store_name is set) have 1 row in
-- reseller_stores; direct resellers (store_name is null) have 0 rows.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_sync_profile_to_reseller_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_store_id uuid;
  v_slug text;
BEGIN
  IF COALESCE(NEW.is_agent, false) = true
     AND NEW.user_id IS NOT NULL
     AND NEW.store_name IS NOT NULL
     AND btrim(NEW.store_name) <> ''
  THEN
    v_slug := NULLIF(btrim(COALESCE(NEW.slug, '')), '');
    IF v_slug IS NULL THEN
      v_slug := lower(regexp_replace(btrim(NEW.store_name), '[^a-zA-Z0-9]+', '-', 'g'));
      v_slug := trim(both '-' from v_slug);
      IF v_slug = '' THEN
        v_slug := 'store-' || substr(replace(NEW.user_id::text, '-', ''), 1, 5);
      END IF;
    END IF;

    SELECT id INTO v_existing_store_id
    FROM public.reseller_stores
    WHERE user_id = NEW.user_id
    ORDER BY created_at ASC NULLS LAST
    LIMIT 1;

    IF v_existing_store_id IS NOT NULL THEN
      UPDATE public.reseller_stores
      SET
        store_name = btrim(NEW.store_name),
        slug = v_slug,
        store_logo_url = COALESCE(NEW.store_logo_url, store_logo_url),
        store_primary_color = COALESCE(NEW.store_primary_color, store_primary_color, '#fbbf24'),
        custom_domain = COALESCE(NEW.custom_domain, custom_domain),
        updated_at = now()
      WHERE id = v_existing_store_id
        AND NOT EXISTS (
          SELECT 1 FROM public.reseller_stores rs2
          WHERE rs2.slug = v_slug AND rs2.id <> v_existing_store_id
        );
    ELSE
      INSERT INTO public.reseller_stores (
        user_id,
        store_name,
        slug,
        store_logo_url,
        store_primary_color,
        custom_domain
      )
      VALUES (
        NEW.user_id,
        btrim(NEW.store_name),
        v_slug,
        NEW.store_logo_url,
        COALESCE(NEW.store_primary_color, '#fbbf24'),
        NEW.custom_domain
      )
      ON CONFLICT (slug) DO UPDATE
      SET
        store_name = EXCLUDED.store_name,
        store_logo_url = COALESCE(EXCLUDED.store_logo_url, public.reseller_stores.store_logo_url),
        store_primary_color = COALESCE(EXCLUDED.store_primary_color, public.reseller_stores.store_primary_color),
        custom_domain = COALESCE(EXCLUDED.custom_domain, public.reseller_stores.custom_domain),
        updated_at = now()
      WHERE public.reseller_stores.user_id = EXCLUDED.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_to_reseller_store ON public.profiles;
CREATE TRIGGER trg_sync_profile_to_reseller_store
  AFTER INSERT OR UPDATE OF is_agent, is_approved, store_name, slug, store_logo_url, store_primary_color, custom_domain ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_profile_to_reseller_store();

-- ============================================================================
-- 5. HIGH-THROUGHPUT COMPOSITE & PARTIAL INDEXES
-- ============================================================================
DO $$
BEGIN
  -- 1. public.orders indexes
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'status'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'created_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_orders_status_created_at_desc
      ON public.orders (status, created_at DESC);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'agent_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'created_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_orders_agent_id_created_at_desc
      ON public.orders (agent_id, created_at DESC);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'customer_phone'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'created_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_created_at_desc
      ON public.orders (customer_phone, created_at DESC);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'provider_order_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_orders_provider_order_id_partial
      ON public.orders (provider_order_id)
      WHERE provider_order_id IS NOT NULL;
  END IF;

  -- 2. public.profiles indexes
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'slug'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_profiles_slug_partial
      ON public.profiles (slug)
      WHERE slug IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'parent_agent_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_profiles_parent_agent_id_partial
      ON public.profiles (parent_agent_id)
      WHERE parent_agent_id IS NOT NULL;
  END IF;

  -- 3. public.reseller_stores indexes
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reseller_stores' AND column_name = 'user_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_reseller_stores_user_id
      ON public.reseller_stores (user_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reseller_stores' AND column_name = 'slug'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_reseller_stores_slug
      ON public.reseller_stores (slug);
  END IF;
END $$;

