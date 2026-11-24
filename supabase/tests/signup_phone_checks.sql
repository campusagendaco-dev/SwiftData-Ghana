-- Checks for 20261124220000_signup_phone_verification_hardening.sql. Safe on production:
-- it changes one profile inside a transaction that is rolled back. No error = passed.
BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_flag boolean;
BEGIN
  IF has_table_privilege('authenticated', 'public.signup_phone_otps', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: signed-in users can read signup codes';
  END IF;

  SELECT user_id INTO v_user FROM public.profiles ORDER BY user_id LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'FAIL: no profile to test with'; END IF;

  -- a signed-in user can't mark their own phone verified
  UPDATE public.profiles SET phone_verified = false, phone = '0241112222' WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  UPDATE public.profiles SET phone_verified = true WHERE user_id = v_user;
  SELECT phone_verified INTO v_flag FROM public.profiles WHERE user_id = v_user;
  IF v_flag THEN RAISE EXCEPTION 'FAIL: a user marked their own phone verified'; END IF;

  -- the server can
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  UPDATE public.profiles SET phone_verified = true WHERE user_id = v_user;
  SELECT phone_verified INTO v_flag FROM public.profiles WHERE user_id = v_user;
  IF NOT v_flag THEN RAISE EXCEPTION 'FAIL: the server could not mark a phone verified'; END IF;

  -- changing a verified phone resets it until verified again
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  UPDATE public.profiles SET phone = '0209998888' WHERE user_id = v_user;
  SELECT phone_verified INTO v_flag FROM public.profiles WHERE user_id = v_user;
  IF v_flag THEN RAISE EXCEPTION 'FAIL: changing a verified phone kept it verified'; END IF;
END $$;

SELECT 'signup phone checks passed' AS result;
ROLLBACK;
