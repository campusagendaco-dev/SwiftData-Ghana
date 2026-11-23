-- Checks for migration 20261123150000_db_space_cleanup.sql.
-- LOCAL ONLY (PGlite with stub tables). Do NOT run on production: the cleanup really deletes old
-- rows, and on production that would mean holding locks on large tables until the rollback.
-- Any FAIL raises; reaching the end means every check passed.
BEGIN;

DO $$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_res jsonb;
  v_n int;
  v_ok boolean;
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  -- Seed: one old and one recent row per table, plus edge cases.
  INSERT INTO cron.job_run_details (jobid, start_time, end_time) VALUES
    (1, now() - interval '8 days', now() - interval '8 days'),
    (1, now() - interval '6 days', now() - interval '6 days');
  INSERT INTO public.system_logs (ts) VALUES (now() - interval '31 days'), (now() - interval '29 days');
  INSERT INTO public.push_notification_logs (created_at) VALUES (now() - interval '31 days'), (now() - interval '29 days');
  INSERT INTO public.sms_logs (created_at) VALUES (now() - interval '91 days'), (now() - interval '89 days');
  INSERT INTO public.security_logs (created_at) VALUES (now() - interval '91 days'), (now() - interval '89 days');
  INSERT INTO public.user_notifications (read, created_at) VALUES
    (true,  now() - interval '61 days'),   -- read + old: deleted
    (false, now() - interval '400 days'),  -- unread, any age: kept
    (true,  now() - interval '59 days');   -- read + recent: kept
  INSERT INTO public.orders (created_at) VALUES (now() - interval '1000 days');

  -- (a) nightly run deletes exactly the old rows
  v_res := public.run_db_retention('nightly', 0, NULL);
  IF (v_res->>'more_remaining')::boolean THEN RAISE EXCEPTION 'FAIL (a) nightly run reported more remaining: %', v_res; END IF;
  IF (SELECT count(*) FROM cron.job_run_details) <> 1 OR EXISTS (SELECT 1 FROM cron.job_run_details WHERE start_time < now() - interval '7 days') THEN
    RAISE EXCEPTION 'FAIL (a) cron history';
  END IF;
  IF (SELECT count(*) FROM public.system_logs) <> 1 THEN RAISE EXCEPTION 'FAIL (a) system_logs'; END IF;
  IF (SELECT count(*) FROM public.push_notification_logs) <> 1 THEN RAISE EXCEPTION 'FAIL (a) push_notification_logs'; END IF;
  IF (SELECT count(*) FROM public.sms_logs) <> 1 THEN RAISE EXCEPTION 'FAIL (a) sms_logs'; END IF;
  IF (SELECT count(*) FROM public.security_logs) <> 1 THEN RAISE EXCEPTION 'FAIL (a) security_logs'; END IF;
  IF (v_res->'deleted'->>'public.sms_logs')::int <> 1 OR (v_res->'deleted'->>'cron.job_run_details')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL (a) deleted counts: %', v_res;
  END IF;
  RAISE NOTICE 'PASS (a) old log rows deleted, recent rows kept';

  -- (b) notifications: only read + older than 60 days
  IF (SELECT count(*) FROM public.user_notifications) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.user_notifications WHERE read = false AND created_at < now() - interval '300 days')
     OR NOT EXISTS (SELECT 1 FROM public.user_notifications WHERE read = true AND created_at > now() - interval '60 days') THEN
    RAISE EXCEPTION 'FAIL (b) notifications';
  END IF;
  RAISE NOTICE 'PASS (b) unread notifications are never deleted';

  -- (c) orders are never touched
  IF (SELECT count(*) FROM public.orders) <> 1 THEN RAISE EXCEPTION 'FAIL (c) orders touched'; END IF;
  RAISE NOTICE 'PASS (c) orders untouched';

  -- (d) the run is recorded
  SELECT count(*) INTO v_n FROM public.db_cleanup_runs WHERE source = 'nightly' AND finished_at IS NOT NULL AND (deleted->>'public.system_logs')::int = 1;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL (d) run not recorded'; END IF;
  RAISE NOTICE 'PASS (d) run recorded';

  -- (e) a time budget stops early and reports more remaining
  INSERT INTO public.system_logs (ts) SELECT now() - interval '40 days' FROM generate_series(1, 6000);
  v_res := public.run_db_retention('manual', 1, v_admin);
  IF NOT (v_res->>'more_remaining')::boolean THEN RAISE EXCEPTION 'FAIL (e) budget not applied: %', v_res; END IF;
  IF (SELECT count(*) FROM public.system_logs WHERE ts < now() - interval '30 days') = 0 THEN RAISE EXCEPTION 'FAIL (e) deleted everything'; END IF;
  -- keep calling until done
  FOR i IN 1..50 LOOP
    v_res := public.run_db_retention('manual', 1, v_admin);
    EXIT WHEN NOT (v_res->>'more_remaining')::boolean;
  END LOOP;
  IF (SELECT count(*) FROM public.system_logs WHERE ts < now() - interval '30 days') <> 0 THEN RAISE EXCEPTION 'FAIL (e) repeat calls did not finish'; END IF;
  RAISE NOTICE 'PASS (e) budgeted runs stop early and finish when repeated';

  -- (f) admin RPCs: non-admin and admin without 2FA are refused
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_ok := false;
  BEGIN PERFORM public.admin_db_cleanup_now(); EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM = 'not_authorized'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL (f) non-admin could clean'; END IF;
  v_ok := false;
  BEGIN PERFORM public.admin_db_space(); EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM = 'not_authorized'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL (f) non-admin could read sizes'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_ok := false;
  BEGIN PERFORM public.admin_db_cleanup_now(); EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM = 'not_authorized'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL (f) admin without 2FA could clean'; END IF;

  -- authenticated can never call the internal function directly
  v_ok := false;
  BEGIN PERFORM public.run_db_retention('manual', 0, v_user); EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL (f) authenticated could call run_db_retention'; END IF;
  RAISE NOTICE 'PASS (f) only 2FA-verified admins can use the admin functions';

  -- (g) a 2FA-verified admin can read sizes and clean
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_res := public.admin_db_space();
  IF jsonb_array_length(v_res->'tables') <> 6 OR (v_res->>'database_bytes')::bigint <= 0 OR v_res->'last_run' IS NULL THEN
    RAISE EXCEPTION 'FAIL (g) admin_db_space: %', v_res;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'tables') t WHERE t->>'target' = 'public.user_notifications' AND (t->>'keep_days')::int = 60) THEN
    RAISE EXCEPTION 'FAIL (g) notification rule missing';
  END IF;
  v_res := public.admin_db_cleanup_now();
  IF v_res->'deleted' IS NULL THEN RAISE EXCEPTION 'FAIL (g) admin clean: %', v_res; END IF;
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS (SELECT 1 FROM public.db_cleanup_runs WHERE source = 'manual' AND triggered_by = v_admin) THEN
    RAISE EXCEPTION 'FAIL (g) manual run not attributed to the admin';
  END IF;
  RAISE NOTICE 'PASS (g) a 2FA-verified admin can see sizes and clean';

  RAISE NOTICE 'ALL DB SPACE CHECKS PASSED';
END;
$$;

ROLLBACK;
