-- Migration: Add API request approval flow columns and security trigger logic.
-- Description:
-- 1. Adds api_request_status and api_requested_at columns to public.profiles.
-- 2. Updates the protect_profile_privileged_fields function to secure these columns.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS api_request_status TEXT CHECK (api_request_status IN ('pending', 'approved', 'rejected')) DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS api_requested_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Enable select access on new columns for authenticated users
GRANT SELECT (api_request_status, api_requested_at) ON public.profiles TO authenticated;

-- Redefine protect_profile_privileged_fields to handle request status security
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If the user is an admin OR it's the service role, let them change anything.
  IF public.has_role(auth.uid(), 'admin') OR (current_setting('role') = 'service_role') THEN
    RETURN NEW;
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
