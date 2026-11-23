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
  v_linked uuid;
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  -- Seed: one old and one recent row per table, plus edge cases.
  -- cron runids grow with time; a run that never started (NULL times) counts as old.
  INSERT INTO cron.job_run_details (jobid, start_time, end_time) VALUES
    (1, now() - interval '9 days', now() - interval '9 days'),
    (1, NULL, NULL),
    (1, now() - interval '8 days', now() - interval '8 days'),
    (1, now() - interval '6 days', now() - interval '6 days');
  INSERT INTO public.system_logs (ts) VALUES (now() - interval '31 days'), (now() - interval '29 days');
  -- an old log that another table still points at must be kept, not break the run
  INSERT INTO public.system_logs (ts) VALUES (now() - interval '45 days') RETURNING id INTO v_linked;
  INSERT INTO public.sentinel_actions (log_id) VALUES (v_linked);
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
  IF (SELECT count(*) FROM public.system_logs) <> 2 OR NOT EXISTS (SELECT 1 FROM public.system_logs WHERE id = v_linked) THEN
    RAISE EXCEPTION 'FAIL (a) system_logs (linked old log must stay)';
  END IF;
  IF (SELECT count(*) FROM public.push_notification_logs) <> 1 THEN RAISE EXCEPTION 'FAIL (a) push_notification_logs'; END IF;
  IF (SELECT count(*) FROM public.sms_logs) <> 1 THEN RAISE EXCEPTION 'FAIL (a) sms_logs'; END IF;
  IF (SELECT count(*) FROM public.security_logs) <> 1 THEN RAISE EXCEPTION 'FAIL (a) security_logs'; END IF;
  IF (v_res->'deleted'->>'public.sms_logs')::int <> 1 OR (v_res->'deleted'->>'cron.job_run_details')::int <> 3 THEN
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

  -- (e) a time budget stops early and reports more remaining (batch path for cron and logs)
  INSERT INTO cron.job_run_details (jobid, start_time, end_time)
    SELECT 1, now() - interval '20 days', now() - interval '20 days' FROM generate_series(1, 4500);
  -- keep runid order = time order: move the one recent run after the new old ones
  UPDATE cron.job_run_details SET runid = 1000000 WHERE start_time > now() - interval '7 days';
  INSERT INTO public.system_logs (ts) SELECT now() - interval '40 days' FROM generate_series(1, 6000);
  v_res := public.run_db_retention('manual', 1, v_admin);
  IF NOT (v_res->>'more_remaining')::boolean THEN RAISE EXCEPTION 'FAIL (e) budget not applied: %', v_res; END IF;
  IF (SELECT count(*) FROM public.system_logs WHERE ts < now() - interval '30 days') = 0 THEN RAISE EXCEPTION 'FAIL (e) deleted everything'; END IF;
  -- keep calling until done
  FOR i IN 1..50 LOOP
    v_res := public.run_db_retention('manual', 1, v_admin);
    EXIT WHEN NOT (v_res->>'more_remaining')::boolean;
  END LOOP;
  IF (SELECT count(*) FROM public.system_logs WHERE ts < now() - interval '30 days') <> 1
     OR (SELECT count(*) FROM cron.job_run_details) <> 1 THEN
    RAISE EXCEPTION 'FAIL (e) repeat calls did not finish';
  END IF;
  RAISE NOTICE 'PASS (e) budgeted runs stop early and finish when repeated';

  -- (e2) one table failing doesn't stop the others, and the error is recorded
  INSERT INTO public.sms_logs (created_at) VALUES (now() - interval '100 days');
  ALTER TABLE public.sentinel_actions RENAME TO sentinel_actions_gone;
  v_res := public.run_db_retention('nightly', 0, NULL);
  ALTER TABLE public.sentinel_actions_gone RENAME TO sentinel_actions;
  IF v_res->'errors'->>'public.system_logs' IS NULL THEN RAISE EXCEPTION 'FAIL (e2) error not reported: %', v_res; END IF;
  IF (v_res->'deleted'->>'public.sms_logs')::int <> 1 THEN RAISE EXCEPTION 'FAIL (e2) other tables not cleaned: %', v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.db_cleanup_runs WHERE errors ? 'public.system_logs') THEN RAISE EXCEPTION 'FAIL (e2) error not logged'; END IF;
  RAISE NOTICE 'PASS (e2) one failing table does not block the rest';

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

  -- (h) finding where cron history turns recent: gaps in runid, every boundary position
  FOR k IN 0..12 LOOP
    DELETE FROM cron.job_run_details;
    -- 12 runs with runids 10, 25, 40, ... (gaps); the first k are old
    INSERT INTO cron.job_run_details (runid, jobid, start_time, end_time)
    SELECT 10 + (i - 1) * 15, 1,
           CASE WHEN i <= k THEN now() - interval '30 days' + i * interval '1 hour' ELSE now() - interval '1 day' + i * interval '1 minute' END,
           NULL
    FROM generate_series(1, 12) i;
    IF k = 0 AND public._db_retention_cron_cut() IS NOT NULL THEN RAISE EXCEPTION 'FAIL (h) nothing old but cut %', public._db_retention_cron_cut(); END IF;
    IF k = 12 AND public._db_retention_cron_cut() <> 10 + 11 * 15 + 1 THEN RAISE EXCEPTION 'FAIL (h) all old, cut %', public._db_retention_cron_cut(); END IF;
    IF k BETWEEN 1 AND 11 AND public._db_retention_cron_cut() <> 10 + k * 15 THEN
      RAISE EXCEPTION 'FAIL (h) k=% cut % expected %', k, public._db_retention_cron_cut(), 10 + k * 15;
    END IF;
  END LOOP;
  DELETE FROM cron.job_run_details;
  IF public._db_retention_cron_cut() IS NOT NULL THEN RAISE EXCEPTION 'FAIL (h) empty table'; END IF;
  RAISE NOTICE 'PASS (h) cron history boundary found by runid lookups';

  RAISE NOTICE 'ALL DB SPACE CHECKS PASSED';
END;
$$;

ROLLBACK;
