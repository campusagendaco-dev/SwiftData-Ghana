-- Order jobs, part 1 (owner-approved plan, 2026-11-24). Apply by pasting into the SQL editor.
--
-- 1. cron-heal-processing has failed on every run since July: it read app.supabase_url /
--    app.service_role_key, which were never set. Reschedule it the way the working jobs do:
--    fixed project URL + the service-role key from Vault. (The heal function itself now only
--    looks at orders from the last 7 days.)
-- 2. auto-deliver-mashup-orders-job marked EVERY order stuck in processing for 15+ minutes as
--    fulfilled without asking the provider, which fights the heal and reset jobs. It has been
--    failing (blocked by the price check) for months, so switching it off changes nothing that
--    is happening today. The function public.auto_deliver_mashup_orders() is kept.

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cron-heal-processing';
  PERFORM cron.schedule(
    'cron-heal-processing',
    '*/3 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/heal-processing-orders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1), '')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cmd$
  );

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'auto-deliver-mashup-orders-job';
END;
$$;

-- Shows the result: heal scheduled with the Vault key, auto-deliver gone.
SELECT jobname, schedule, active,
       (command LIKE '%vault.decrypted_secrets%') AS uses_vault_key
FROM cron.job
WHERE jobname IN ('cron-heal-processing', 'auto-deliver-mashup-orders-job');
