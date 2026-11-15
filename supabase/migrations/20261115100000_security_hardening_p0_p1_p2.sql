-- ============================================================================================
-- Security Hardening (P0 / P1 / P2)
--
-- 1. P0 #3: Lock down `api.credit_api_wallet` and `api.transfer_funds` EXECUTE grants
--           (and default function privileges in schema `api`) to `service_role` only.
-- 2. P1 #9: Remove `OR user_id IS NULL` from `Users can view own disputes` RLS policy on
--           `public.order_disputes` and prevent `user_id` spoofing on dispute inserts.
-- 3. P1 #10: Protect `is_suspended` and `markups` in `public.protect_profile_privileged_fields()`
--            while allowing authorized key rotation via `app.api_key_rotation_allowed` GUC in
--            `api.rotate_api_key()` (gated on `api_access_enabled = true`).
-- 4. P2 #16: Explicitly set `search_path = public` on remaining `SECURITY DEFINER` functions.
-- ============================================================================================

-- --------------------------------------------------------------------------------------------
-- 1. P0 #3: Lock down `api` schema wallet & internal RPC permissions
-- --------------------------------------------------------------------------------------------
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION api.credit_api_wallet(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION api.credit_api_wallet(UUID, NUMERIC) TO service_role;
EXCEPTION WHEN undefined_function OR invalid_schema_name THEN
  NULL;
END $$;

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION api.transfer_funds(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION api.transfer_funds(UUID, NUMERIC, TEXT, TEXT) TO service_role;
EXCEPTION WHEN undefined_function OR invalid_schema_name THEN
  NULL;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated';

    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api'
        AND p.proname IN (
          'credit_api_wallet',
          'transfer_funds',
          'authenticate_client',
          'log_internal_error',
          'create_order_rpc'
        )
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END LOOP;
  END IF;
END $$;

-- --------------------------------------------------------------------------------------------
-- 2. P1 #9: Harden `public.order_disputes` RLS & insert sanitization
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sanitize_order_dispute_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Non-admin browser callers (anon / authenticated) can only file disputes as themselves (or NULL for anon).
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
    NEW.user_id := auth.uid();
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;

  IF NEW.user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN
      NEW.user_id := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Users can view own disputes" ON public.order_disputes;
CREATE POLICY "Users can view own disputes"
  ON public.order_disputes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- --------------------------------------------------------------------------------------------
-- 3. P1 #10: Harden `public.protect_profile_privileged_fields()` & `api.rotate_api_key()`
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If the user is an admin OR it's the service role, let them change anything.
  IF public.has_role(auth.uid(), 'admin') OR (current_setting('role', true) = 'service_role') THEN
    RETURN NEW;
  END IF;

  -- 1. Protect Agent/Sub-Agent Status, Approval, Suspension & Admin Markups
  IF NEW.is_agent IS DISTINCT FROM OLD.is_agent THEN
    NEW.is_agent := OLD.is_agent;
  END IF;

  IF NEW.agent_approved IS DISTINCT FROM OLD.agent_approved THEN
    NEW.agent_approved := OLD.agent_approved;
  END IF;

  IF NEW.sub_agent_approved IS DISTINCT FROM OLD.sub_agent_approved THEN
    NEW.sub_agent_approved := OLD.sub_agent_approved;
  END IF;

  -- Allow setting is_sub_agent to TRUE during onboarding, but block un-setting it later.
  IF NEW.is_sub_agent IS DISTINCT FROM OLD.is_sub_agent THEN
    IF OLD.is_sub_agent = true OR OLD.sub_agent_approved = true THEN
      NEW.is_sub_agent := OLD.is_sub_agent;
    END IF;
  END IF;

  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    NEW.is_suspended := OLD.is_suspended;
  END IF;

  IF NEW.markups IS DISTINCT FROM OLD.markups THEN
    NEW.markups := OLD.markups;
  END IF;

  -- 2. Protect API-Related Fields (Prevent self-enablement and unauthorized key tampering)
  IF NEW.api_access_enabled IS DISTINCT FROM OLD.api_access_enabled THEN
    NEW.api_access_enabled := OLD.api_access_enabled;
  END IF;

  IF NEW.api_key IS DISTINCT FROM OLD.api_key THEN
    NEW.api_key := OLD.api_key;
  END IF;

  IF current_setting('app.api_key_rotation_allowed', true) = 'true' THEN
    -- Allowed via api.rotate_api_key() for users with api_access_enabled = true
    NULL;
  ELSE
    IF NEW.api_key_hash IS DISTINCT FROM OLD.api_key_hash THEN
      NEW.api_key_hash := OLD.api_key_hash;
    END IF;

    IF NEW.api_key_prefix IS DISTINCT FROM OLD.api_key_prefix THEN
      NEW.api_key_prefix := OLD.api_key_prefix;
    END IF;

    IF NEW.api_secret_key_hash IS DISTINCT FROM OLD.api_secret_key_hash THEN
      NEW.api_secret_key_hash := OLD.api_secret_key_hash;
    END IF;
  END IF;

  IF NEW.api_rate_limit IS DISTINCT FROM OLD.api_rate_limit THEN
    NEW.api_rate_limit := OLD.api_rate_limit;
  END IF;

  IF NEW.api_allowed_actions IS DISTINCT FROM OLD.api_allowed_actions THEN
    NEW.api_allowed_actions := OLD.api_allowed_actions;
  END IF;

  -- 2.1 API pricing is admin-only: a self-set api_custom_prices map would let an
  --     API user buy any bundle at any price via wallet-buy-data / developer-api.
  IF NEW.api_custom_prices IS DISTINCT FROM OLD.api_custom_prices THEN
    NEW.api_custom_prices := OLD.api_custom_prices;
  END IF;

  -- 2.2 Protect API Request Flow (Allow self-submit to 'pending' from NULL/rejected, block self-approval/rejection)
  IF NEW.api_request_status IS DISTINCT FROM OLD.api_request_status THEN
    IF NEW.api_request_status = 'pending' AND (OLD.api_request_status IS NULL OR OLD.api_request_status = 'rejected') THEN
      NEW.api_requested_at := NOW();
    ELSE
      NEW.api_request_status := OLD.api_request_status;
    END IF;
  END IF;

  IF NEW.api_requested_at IS DISTINCT FROM OLD.api_requested_at AND NEW.api_request_status IS NOT DISTINCT FROM OLD.api_request_status THEN
    NEW.api_requested_at := OLD.api_requested_at;
  END IF;

  -- 3. Protect Referral & Financial metadata
  IF NEW.parent_agent_id IS DISTINCT FROM OLD.parent_agent_id THEN
    NEW.parent_agent_id := OLD.parent_agent_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION api.rotate_api_key()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_new_key TEXT;
  v_key_hash TEXT;
  v_prefix TEXT;
  v_new_secret TEXT;
  v_user_id UUID;
  v_api_access_enabled BOOLEAN := false;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT COALESCE(api_access_enabled, false)
  INTO v_api_access_enabled
  FROM public.profiles
  WHERE user_id = v_user_id;

  IF NOT COALESCE(v_api_access_enabled, false) AND NOT public.has_role(v_user_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'API access is not enabled for this account');
  END IF;

  -- Generate 32-char hex API Key
  v_new_key := 'swft_live_' || lower(replace(gen_random_uuid()::text, '-', ''));
  v_key_hash := encode(sha256(v_new_key::bytea), 'hex');
  v_prefix := left(v_new_key, 12);

  -- Generate 32-char hex Secret Key
  v_new_secret := lower(replace(gen_random_uuid()::text, '-', ''));

  PERFORM set_config('app.api_key_rotation_allowed', 'true', true);

  UPDATE public.profiles
  SET
    api_key = NULL,
    api_key_hash = v_key_hash,
    api_key_prefix = v_prefix,
    api_secret_key_hash = v_new_secret
  WHERE user_id = v_user_id;

  PERFORM set_config('app.api_key_rotation_allowed', '', true);

  RETURN jsonb_build_object(
    'success', true,
    'api_key', v_new_key,
    'prefix', v_prefix,
    'secret', v_new_secret
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION api.rotate_api_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.rotate_api_key() TO authenticated, service_role;

-- --------------------------------------------------------------------------------------------
-- 4. P2 #16: Set explicit `search_path = public` on remaining SECURITY DEFINER RPCs
-- --------------------------------------------------------------------------------------------
DO $$
BEGIN
  ALTER FUNCTION public.transfer_float_to_subagent(uuid, uuid, numeric) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.get_sub_agents_status(uuid) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.get_agent_churn_insights(uuid) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.repay_agent_credit(uuid, numeric, text) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.purge_old_system_logs() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.get_admin_sales_stats_v2(timestamp with time zone) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.user_transfer_to_api(numeric) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.force_order_pending_status() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
