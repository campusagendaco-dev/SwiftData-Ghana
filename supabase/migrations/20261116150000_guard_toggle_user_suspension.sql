-- ============================================================================================
-- Fix admin suspend/unsuspend: drop the non-existent `suspended_at` column and guard
-- toggle_user_suspension behind an admin check.
--
-- 1. `profiles` has no `suspended_at` column (only `suspended_until`). The bulk_suspend_users
--    definitions from 20261024120000 and 20261116110000 wrote `suspended_at`, so every call failed
--    (surfacing as HTTP 400 on the profiles PATCH and HTTP 500 from system-payout-v1). Those files
--    have been corrected in place, but if they were already applied the live function is still
--    broken, so it is re-created here.
-- 2. 20260722215800 re-created toggle_user_suspension (SECURITY DEFINER) and granted it to
--    `authenticated` with no role check, letting any signed-in user suspend any account or lift
--    their own suspension. The admin UI now uses it as a fallback, so it keeps the grant but only
--    admins or the service role may run it.
--
-- Apply this single file in the Supabase SQL editor (do not run `supabase db push`).
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.bulk_suspend_users(p_user_ids UUID[], p_suspend BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.is_admin()
    OR current_setting('role', true) = 'service_role'
    OR COALESCE(auth.role(), '') = 'service_role'
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
    OR current_setting('role', true) = 'service_role'
    OR COALESCE(auth.role(), '') = 'service_role'
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
