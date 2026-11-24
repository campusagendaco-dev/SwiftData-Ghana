-- reset_promo_claims: require a completed 2FA login, not just the admin role.
--
-- The June 2026 version (20260619105100) checked user_roles itself, so an admin signed in
-- with only a password could wipe a promo's claim history and let everyone claim it again.
-- It now checks the admin role AND aal2 itself (it doesn't rely on is_admin() alone, so it
-- stays safe even if is_admin() is ever changed back). Same name, arguments and behaviour,
-- so the Promotions page needs no change.
--
-- Apply by pasting this file into the Supabase SQL editor (never db push), then run
-- supabase/tests/reset_promo_claims_checks.sql (no error = passed).

CREATE OR REPLACE FUNCTION public.reset_promo_claims(p_promo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin with 2FA required' USING ERRCODE = '42501';
  END IF;

  -- Delete all claim history for this promo code
  DELETE FROM public.promo_claims WHERE promo_code_id = p_promo_id;

  -- Reset the usage counter back to 0
  UPDATE public.promo_codes SET current_uses = 0 WHERE id = p_promo_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_promo_claims(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_promo_claims(uuid) TO authenticated;
