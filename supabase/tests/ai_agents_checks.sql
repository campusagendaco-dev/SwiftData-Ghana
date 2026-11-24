-- Checks for 20261124160000_openai_autonomous_worker_fleet.sql (safe agents) and, once it
-- is applied, 20261124180000_ai_agent_schedules.sql.
-- Read-only and safe on production: it only reads catalogs and rows inside a transaction
-- that is rolled back. Any problem stops with "FAIL: ..."; no error = passed (the SQL
-- editor may show no rows).
BEGIN;

DO $$
DECLARE
  v_bad text;
BEGIN
  -- (a) every agent is watch-only or may only propose
  SELECT string_agg(name || '=' || coalesce(autonomy_mode, 'NULL'), ', ') INTO v_bad
    FROM public.ai_agent_registry
   WHERE autonomy_mode IS NULL OR autonomy_mode NOT IN ('observe_only', 'propose');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL (a): agents with an unsafe mode: %', v_bad; END IF;

  -- (b) new agents start watch-only
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ai_agent_registry' AND column_name = 'autonomy_mode'
       AND column_default LIKE '%observe_only%'
  ) THEN RAISE EXCEPTION 'FAIL (b): autonomy_mode default is not observe_only'; END IF;

  -- (c) every policy signed-in users get on the ai_* tables requires an admin with 2FA
  SELECT string_agg(tablename || '/' || policyname, ', ') INTO v_bad
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('ai_agent_registry', 'ai_worker_tasks', 'ai_system_memory', 'ai_agent_runs')
     AND NOT (roles = ARRAY['service_role']::name[])
     AND NOT (coalesce(qual, '') ILIKE '%is_admin()%' AND (with_check IS NULL OR with_check ILIKE '%is_admin()%'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL (c): policies without is_admin(): %', v_bad; END IF;

  -- (d) admins can only read tasks, memory and runs; writes go through the service role
  SELECT string_agg(tablename || '/' || policyname || ' ' || cmd, ', ') INTO v_bad
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('ai_worker_tasks', 'ai_system_memory', 'ai_agent_runs')
     AND NOT (roles = ARRAY['service_role']::name[])
     AND cmd <> 'SELECT';
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL (d): non-read policies for signed-in users: %', v_bad; END IF;

  -- (e) on the registry, signed-in users may change only is_active, autonomy_mode and active_model
  IF has_column_privilege('authenticated', 'public.ai_agent_registry', 'edge_function', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.ai_agent_registry', 'daily_budget_usd', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.ai_agent_registry', 'autonomy_mode', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL (e): wrong column update rights on ai_agent_registry';
  END IF;

  -- (f) a task can be claimed ("deciding") before it runs
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.ai_worker_tasks'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%deciding%'
  ) THEN RAISE EXCEPTION 'FAIL (f): ai_worker_tasks status does not allow deciding'; END IF;

  -- (h) the approval queue can spot repeat proposals, and no draft-era task can be approved
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ai_worker_tasks' AND column_name = 'target_key') THEN
    RAISE EXCEPTION 'FAIL (h): ai_worker_tasks.target_key is missing';
  END IF;
  EXECUTE $q$SELECT string_agg(id::text, ', ') FROM public.ai_worker_tasks
             WHERE status IN ('awaiting_approval', 'deciding') AND target_key IS NULL$q$ INTO v_bad;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL (h): waiting tasks from before the safe redesign: %', v_bad; END IF;

  -- (g) schedules: the ops worker runs every 15 minutes, never every 5
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT string_agg(jobname || ' ' || schedule, ', ') FROM cron.job
               WHERE jobname = 'ops-worker-ai-patrol' AND schedule <> '*/15 * * * *'$q$ INTO v_bad;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL (g): ops worker schedule: %', v_bad; END IF;
  END IF;
END $$;

SELECT 'ai agents checks passed' AS result;
ROLLBACK;
