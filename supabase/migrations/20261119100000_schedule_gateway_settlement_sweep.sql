-- Schedule automatic 15-minute Payment Gateway settlement release & webhook retry sweep.
-- Releases matured held collections (`status = 'paid' AND settle_after <= now()`)
-- and retries failed/pending merchant webhooks with exponential backoff.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'gateway-settlement-webhook-sweep';

    PERFORM cron.schedule(
      'gateway-settlement-webhook-sweep',
      '*/15 * * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/gateway-collect/v1/admin/sweep',
          headers := json_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1)
          )::jsonb,
          body := '{}'::jsonb
        );
      $cmd$
    );
  END IF;
END $$;
