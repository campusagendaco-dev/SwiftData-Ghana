-- FINAL SECURITY TRIGGER & PERMISSIONS FIX (V2)
-- 1. Fix trigger to use actual column names
-- 2. Restore SELECT access to system_settings (RLS will still protect it)

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- If the user is an admin OR we are running as service_role (Edge Functions), allow the change
    IF (public.has_role(auth.uid(), 'admin')) OR (current_setting('role') = 'service_role') THEN
        RETURN NEW;
    END IF;

    -- If NOT an admin/system, check for tampering with sensitive fields
    -- Removed non-existent columns: is_api_user, api_status
    -- Corrected columns: api_access_enabled
    IF (
        NEW.is_agent IS DISTINCT FROM OLD.is_agent OR
        NEW.agent_approved IS DISTINCT FROM OLD.agent_approved OR
        NEW.is_sub_agent IS DISTINCT FROM OLD.is_sub_agent OR
        NEW.sub_agent_approved IS DISTINCT FROM OLD.sub_agent_approved OR
        NEW.agent_prices IS DISTINCT FROM OLD.agent_prices OR
        NEW.markups IS DISTINCT FROM OLD.markups OR
        NEW.api_access_enabled IS DISTINCT FROM OLD.api_access_enabled
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You cannot change privileged profile fields.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT SELECT ON public.system_settings TO authenticated;
GRANT SELECT ON public.public_system_settings TO authenticated, anon;
