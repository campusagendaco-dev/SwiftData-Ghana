-- Timers for the safe AI agents. Run ONLY AFTER these functions are deployed with the
-- safe-agents code: ops-worker-ai, threat-hunter, aml-scanner, account-cloner (otherwise
-- the old deployed versions would start acting on their own every few minutes).
-- Requires 20261124160000_openai_autonomous_worker_fleet.sql first.
-- Apply by pasting into the Supabase SQL editor (never db push), then run
-- supabase/tests/ai_agents_checks.sql (no error = passed).
DO $$
DECLARE
  j record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; no agent timers were created';
    RETURN;
  END IF;

  FOR j IN SELECT * FROM (VALUES
      ('ops-worker-ai-patrol',  '*/15 * * * *', 'ops-worker-ai',  '{"mode":"patrol","source":"pg_cron"}'),
      ('threat-hunter-patrol',  '*/5 * * * *',  'threat-hunter',  '{"source":"pg_cron"}'),
      ('aml-scanner-patrol',    '*/10 * * * *', 'aml-scanner',    '{"source":"pg_cron"}'),
      ('account-cloner-patrol', '*/20 * * * *', 'account-cloner', '{"source":"pg_cron"}')
    ) AS t(jobname, schedule, fn, body)
  LOOP
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j.jobname;
    PERFORM cron.schedule(
      j.jobname,
      j.schedule,
      format($cmd$
        SELECT net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/%s',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1), '')
          ),
          body := %L::jsonb,
          timeout_milliseconds := 60000
        );
      $cmd$, j.fn, j.body)
    );
  END LOOP;
END $$;
