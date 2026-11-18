-- ============================================================================================
-- Lock down Paystack & system secrets + guard vendor terminal status on profiles:
--   1. Revoke all table-level privileges on `public.system_secrets` and
--      `public.v_system_settings_with_secrets` from PUBLIC, anon, and authenticated so
--      only `service_role` and `postgres` hold grants (defense-in-depth beyond RLS).
--   2. Revoke write privileges on `public.system_settings` from PUBLIC and anon.
--   3. Guard `vendor_status` and `terminal_locked` inside `protect_profile_privileged_fields()`
--      so non-admin authenticated users cannot self-activate `vendor_status = 'active'` or
--      clear `terminal_locked` to reach `paystack-vendor` transfer endpoints.
-- ============================================================================================

REVOKE ALL ON TABLE public.system_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.system_secrets TO service_role, postgres;

REVOKE ALL ON TABLE public.v_system_settings_with_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_system_settings_with_secrets TO service_role, postgres;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.system_settings FROM PUBLIC, anon;

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

  -- 0. Protect Suspension & Swift Vendor Terminal Status
  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    NEW.is_suspended := OLD.is_suspended;
  END IF;

  IF NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
    NEW.suspended_until := OLD.suspended_until;
  END IF;

  IF NEW.terminal_locked IS DISTINCT FROM OLD.terminal_locked THEN
    NEW.terminal_locked := OLD.terminal_locked;
  END IF;

  IF NEW.vendor_status IS DISTINCT FROM OLD.vendor_status THEN
    NEW.vendor_status := OLD.vendor_status;
  END IF;

  IF NEW.vendor_activated_at IS DISTINCT FROM OLD.vendor_activated_at THEN
    NEW.vendor_activated_at := OLD.vendor_activated_at;
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
