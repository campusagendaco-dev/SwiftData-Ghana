-- Checks for 20261124230000_mystery_box_guest_hardening.sql. Safe on production: it changes two
-- profiles inside a transaction that is rolled back, and creates no orders. No error = passed.
BEGIN;

DO $$
DECLARE
  v_a uuid;
  v_b uuid;
  v_admin uuid;
  v_owner uuid;
  v_credit timestamptz;
  v_failed boolean;
  v_test_phone constant text := '0599000001';
BEGIN
  -- nobody but the server reads who owns a number
  IF has_table_privilege('anon', 'public.guest_phone_owners', 'SELECT')
     OR has_table_privilege('authenticated', 'public.guest_phone_owners', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: customers can read guest number owners';
  END IF;

  -- the lookup by any phone number is gone; the lookup by order reference answers nothing for a made-up one
  IF to_regprocedure('public.guest_mystery_box_progress(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: the lookup by phone number still exists';
  END IF;
  IF NOT has_function_privilege('anon', 'public.guest_mystery_box_progress_for_order(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: guests cannot use the lookup by order reference';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guest_mystery_box_progress_for_order('not-a-real-reference-' || gen_random_uuid())) THEN
    RAISE EXCEPTION 'FAIL: a made-up order reference returned progress';
  END IF;
  IF has_function_privilege('anon', 'public.admin_set_guest_phone_owner(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: guests can move a number';
  END IF;

  -- two customer (non-admin) profiles
  SELECT user_id INTO v_a FROM public.profiles p
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id) ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_b FROM public.profiles p
   WHERE p.user_id > v_a AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id) ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' ORDER BY user_id LIMIT 1;
  IF v_b IS NULL OR v_admin IS NULL THEN RAISE EXCEPTION 'FAIL: need two profiles and an admin to test with'; END IF;
  DELETE FROM public.guest_phone_owners WHERE phone = v_test_phone;

  -- the first account to verify a number owns its guest purchases; a second one doesn't take it
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  UPDATE public.profiles SET phone = v_test_phone, phone_verified = true WHERE user_id = v_a;
  UPDATE public.profiles SET phone = v_test_phone, phone_verified = true WHERE user_id = v_b;
  SELECT user_id INTO v_owner FROM public.guest_phone_owners WHERE phone = v_test_phone;
  IF v_owner IS DISTINCT FROM v_a THEN RAISE EXCEPTION 'FAIL: the first account to verify does not own the number'; END IF;

  -- an admin without the authenticator app can't move it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.admin_set_guest_phone_owner(v_b);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: an SMS-login admin moved a number'; END IF;

  -- a customer can't see owners through the admin view
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_failed := false;
  BEGIN
    PERFORM * FROM public.admin_guest_phone_status(v_a);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: a customer used the admin number view';
  END IF;

  -- with the authenticator app it moves, from now on only, and is logged
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM public.admin_set_guest_phone_owner(v_b);
  SELECT user_id, credit_from INTO v_owner, v_credit FROM public.guest_phone_owners WHERE phone = v_test_phone;
  IF v_owner IS DISTINCT FROM v_b OR v_credit IS NULL THEN
    RAISE EXCEPTION 'FAIL: the admin move did not hand over the number from now on';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'guest_phone_owner_moved' AND details->>'phone' = v_test_phone) THEN
    RAISE EXCEPTION 'FAIL: the admin move was not logged';
  END IF;
END $$;

SELECT 'mystery box guest checks passed' AS result;
ROLLBACK;
