-- Migration: Re-enable automated order retries, status checks, and profit crediting cron
-- Description: Schedules pg_cron every 1 minute to invoke process-retries edge function via pg_net.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Unschedule any previous retry cron to avoid duplicate jobs
SELECT cron.unschedule(jobname) FROM cron.job 
WHERE jobname IN ('process-retries-job', 'cron-auto-retry');

-- Schedule process-retries every 1 minute
SELECT cron.schedule(
  'process-retries-job',
  '* * * * *',
  $$
  SELECT net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/process-retries',
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          NULLIF(current_setting('app.settings.service_role_key', true), ''),
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1)
        )
      )::jsonb,
      body := '{}'::jsonb
  );
  $$
);
