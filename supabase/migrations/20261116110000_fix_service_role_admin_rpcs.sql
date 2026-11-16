-- ============================================================================================
-- Fix service_role authorization inside admin SECURITY DEFINER RPCs called by Edge Functions
--
-- Root cause: `system-payout-v1` and `admin-user-actions` verify the admin caller via
-- `verifyAdmin(...)` and then invoke RPCs using `supabaseAdmin` (`service_role` key, where
-- `auth.uid()` is NULL). `public.bulk_suspend_users` and `public.delete_provider_safe` checked
-- `IF NOT public.is_admin()`, which evaluated `user_id = auth.uid()` -> FALSE for `service_role`,
-- raising 42501 and causing `system-payout-v1` to return HTTP 500.
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
    OR current_setting('role', true) = 'service_role'
    OR COALESCE(auth.role(), '') = 'service_role'
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
