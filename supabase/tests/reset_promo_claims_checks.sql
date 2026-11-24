-- Checks for migration 20261124140000_reset_promo_claims_require_2fa.sql.
-- Safe on production: it calls reset_promo_claims only with a made-up promo id that matches
-- no rows, sets pretend login details for this transaction only, and rolls everything back.
-- Uses the first admin in user_roles. Any failure stops with "FAIL: ..."; no error = passed.
BEGIN;

DO $$
DECLARE
  v_admin uuid;
  v_other uuid := gen_random_uuid();  -- not in user_roles
  v_promo uuid := gen_random_uuid();  -- matches no promo code
  v_refused boolean;
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' ORDER BY user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'FAIL: no admin in user_roles to test with'; END IF;

  -- (a) admin signed in with password only (aal1): refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_refused := false;
  BEGIN PERFORM public.reset_promo_claims(v_promo); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'FAIL (a): admin without 2FA was allowed'; END IF;

  -- (b) admin with no aal claim at all: refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_refused := false;
  BEGIN PERFORM public.reset_promo_claims(v_promo); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'FAIL (b): admin with no aal claim was allowed'; END IF;

  -- (c) non-admin, even with 2FA: refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_refused := false;
  BEGIN PERFORM public.reset_promo_claims(v_promo); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'FAIL (c): non-admin was allowed'; END IF;

  -- (d) admin after entering the 2FA code: allowed (made-up id, so nothing is changed)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM public.reset_promo_claims(v_promo);
END $$;

SELECT 'reset_promo_claims 2FA checks passed' AS result;
ROLLBACK;
