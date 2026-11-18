-- Prevent sub-admins from modifying `profiles.markups` (which stores
-- `is_sub_admin`, `is_super_admin`, and `admin_permissions`) to self-escalate
-- to Super Admin or alter another admin's permissions.

CREATE OR REPLACE FUNCTION public.guard_sub_admin_markups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_is_sub_admin boolean := false;
BEGIN
  -- Always allow service_role / superuser / owner contexts
  IF current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
     OR COALESCE(auth.role(), '') = 'service_role'
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.markups IS DISTINCT FROM OLD.markups THEN
    SELECT COALESCE((p.markups->>'is_sub_admin')::boolean, false)
      INTO v_caller_is_sub_admin
      FROM public.profiles p
     WHERE p.user_id = auth.uid();

    IF v_caller_is_sub_admin THEN
      RAISE EXCEPTION 'Sub-admins are not permitted to modify admin permissions or role flags.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_sub_admin_markups ON public.profiles;
CREATE TRIGGER trg_guard_sub_admin_markups
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sub_admin_markups();
