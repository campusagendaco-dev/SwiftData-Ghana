-- ============================================================================================
-- Fix admin suspend/unsuspend & service-role admin RPCs on live database:
--   1. Replace non-existent `suspended_at` with `suspended_until = NULL` in `bulk_suspend_users`.
--   2. Allow `service_role` / owner calls (where `auth.uid()` is NULL) alongside `public.is_admin()`
--      in `bulk_suspend_users`, `toggle_user_suspension`, and `delete_provider_safe`.
--   3. Guard `is_suspended` and `suspended_until` inside `protect_profile_privileged_fields()` so
--      regular authenticated users cannot lift their own suspension via direct `profiles` UPDATE,
--      while permitting admins, `service_role`, and internal privileged callers.
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow platform admins, service_role, and internal/owner execution contexts (where auth.uid() is NULL and caller is not anon/authenticated).
  IF public.has_role(auth.uid(), 'admin')
     OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
     OR COALESCE(auth.role(), '') = 'service_role'
     OR (auth.uid() IS NULL AND COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated'))
  THEN
    RETURN NEW;
  END IF;

  -- 0. Protect Suspension Status (prevent self-unsuspension)
  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    NEW.is_suspended := OLD.is_suspended;
  END IF;

  IF NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
    NEW.suspended_until := OLD.suspended_until;
  END IF;

  -- 1. Protect Agent/Sub-Agent Status & Approval
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

  -- 2. Protect API-Related Fields (Prevent self-enablement and key tampering)
  IF NEW.api_access_enabled IS DISTINCT FROM OLD.api_access_enabled THEN
    NEW.api_access_enabled := OLD.api_access_enabled;
  END IF;

  IF NEW.api_key IS DISTINCT FROM OLD.api_key THEN
    NEW.api_key := OLD.api_key;
  END IF;

  IF NEW.api_key_hash IS DISTINCT FROM OLD.api_key_hash THEN
    NEW.api_key_hash := OLD.api_key_hash;
  END IF;

  IF NEW.api_key_prefix IS DISTINCT FROM OLD.api_key_prefix THEN
    NEW.api_key_prefix := OLD.api_key_prefix;
  END IF;

  IF NEW.api_rate_limit IS DISTINCT FROM OLD.api_rate_limit THEN
    NEW.api_rate_limit := OLD.api_rate_limit;
  END IF;

  IF NEW.api_allowed_actions IS DISTINCT FROM OLD.api_allowed_actions THEN
    NEW.api_allowed_actions := OLD.api_allowed_actions;
  END IF;

  -- 2.1 API pricing is admin-only
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

CREATE OR REPLACE FUNCTION public.bulk_suspend_users(p_user_ids UUID[], p_suspend BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked INTEGER;
BEGIN
  IF NOT (
    public.is_admin()
    OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
    OR COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NULL AND COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated'))
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only platform administrators can suspend accounts.' USING ERRCODE = '42501';
  END IF;

  IF p_user_ids IS NULL OR COALESCE(array_length(p_user_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', true, 'count', 0);
  END IF;

  UPDATE public.profiles
  SET is_suspended = COALESCE(p_suspend, false),
      suspended_until = NULL,
      updated_at = NOW()
  WHERE user_id = ANY(p_user_ids);

  SELECT count(*) INTO v_blocked
  FROM public.profiles
  WHERE user_id = ANY(p_user_ids)
    AND is_suspended IS DISTINCT FROM COALESCE(p_suspend, false);
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Suspension change was reverted by protect_profile_privileged_fields for % account(s).', v_blocked
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('success', true, 'count', COALESCE(array_length(p_user_ids, 1), 0));
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_suspend_users(UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_suspend_users(UUID[], BOOLEAN) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.toggle_user_suspension(p_user_id UUID, p_suspend BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.is_admin()
    OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
    OR COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NULL AND COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated'))
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only platform administrators can suspend accounts.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET is_suspended = COALESCE(p_suspend, false),
      suspended_until = NULL,
      updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_user_suspension(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_user_suspension(UUID, BOOLEAN) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_provider_safe(p_provider_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NOT (
    public.is_admin()
    OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
    OR COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NULL AND COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated'))
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only platform administrators can delete providers.' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM public.providers WHERE id = p_provider_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider not found.');
  END IF;

  UPDATE public.orders
  SET provider_id = NULL
  WHERE provider_id = p_provider_id;

  DELETE FROM public.provider_packages
  WHERE provider_id = p_provider_id;

  BEGIN
    DELETE FROM public.provider_errors WHERE provider_id = p_provider_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  DELETE FROM public.providers
  WHERE id = p_provider_id;

  RETURN jsonb_build_object('success', true, 'message', 'Provider ' || v_name || ' deleted successfully.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_provider_safe(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_provider_safe(UUID) TO authenticated, service_role;
