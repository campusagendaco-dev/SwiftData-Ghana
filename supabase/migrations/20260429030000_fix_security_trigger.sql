-- FIX SECURITY TRIGGER
-- Allow service_role (Edge Functions) to bypass privileged field checks.

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- If the user is an admin OR we are running as service_role (Edge Functions), allow the change
    IF (public.has_role(auth.uid(), 'admin')) OR (current_setting('role') = 'service_role') THEN
        RETURN NEW;
    END IF;

    -- If NOT an admin/system, check for tampering with sensitive fields
    IF (
        NEW.is_agent IS DISTINCT FROM OLD.is_agent OR
        NEW.agent_approved IS DISTINCT FROM OLD.agent_approved OR
        NEW.is_sub_agent IS DISTINCT FROM OLD.is_sub_agent OR
        NEW.sub_agent_approved IS DISTINCT FROM OLD.sub_agent_approved OR
        NEW.agent_prices IS DISTINCT FROM OLD.agent_prices OR
        NEW.markups IS DISTINCT FROM OLD.markups OR
        NEW.is_api_user IS DISTINCT FROM OLD.is_api_user OR
        NEW.api_status IS DISTINCT FROM OLD.api_status
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You cannot change privileged profile fields.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
