-- ALLOW SYSTEM ROLES IN SECURITY TRIGGER
-- This ensures migrations and system actions can update privileged fields.

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow admins, service_role (Edge Functions), and postgres (Migrations)
    IF (public.has_role(auth.uid(), 'admin')) 
       OR (current_setting('role') IN ('service_role', 'postgres', 'supabase_admin'))
    THEN
        RETURN NEW;
    END IF;

    -- If NOT an admin/system, block tampering with sensitive fields
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
