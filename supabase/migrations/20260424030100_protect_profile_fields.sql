-- SECURITY HARDENING: Prevent non-admins from approving themselves or changing privileged flags.
-- RLS 'WITH CHECK' cannot easily compare OLD and NEW values, so a trigger is the safest way.

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

  -- For non-admins, if they try to change any of these fields, ignore the change (keep OLD value).
  IF NEW.is_agent IS DISTINCT FROM OLD.is_agent THEN
    NEW.is_agent := OLD.is_agent;
  END IF;

  IF NEW.agent_approved IS DISTINCT FROM OLD.agent_approved THEN
    NEW.agent_approved := OLD.agent_approved;
  END IF;

  IF NEW.sub_agent_approved IS DISTINCT FROM OLD.sub_agent_approved THEN
    NEW.sub_agent_approved := OLD.sub_agent_approved;
  END IF;

  IF NEW.is_sub_agent IS DISTINCT FROM OLD.is_sub_agent THEN
    NEW.is_sub_agent := OLD.is_sub_agent;
  END IF;

  -- Also protect the user's wallet-related fields if any exist in profile
  -- (e.g., if there were a balance column here).

  RETURN NEW;
END;
$$;

-- Apply the trigger to the profiles table
DROP TRIGGER IF EXISTS ensure_profile_security ON public.profiles;
CREATE TRIGGER ensure_profile_security
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_fields();
