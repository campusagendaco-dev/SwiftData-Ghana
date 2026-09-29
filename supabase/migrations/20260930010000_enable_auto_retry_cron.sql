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
          (SELECT current_setting('app.settings.service_role_key', true)),
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxzb2NkanBmbGVjZHV1bW9waWpuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY3OTc0MywiZXhwIjoyMDkxMjU1NzQzfQ.1QNTQHip6aZGlHn8A87S2VVYhu4yQ_BG58C98424MH4'
        )
      )::jsonb,
      body := '{}'::jsonb
  );
  $$
);
