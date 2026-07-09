-- Migration: Schedule Remaining Cron Jobs for Subscriptions and Custom Broadcasts
-- Description: Sets up pg_cron jobs to trigger the cron-process-subscriptions Edge Function (every 10 minutes) and the process-scheduled-sms Edge Function (every minute).

-- 1. Enable pg_cron (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- 2. Clear any existing schedules to avoid duplicates
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN (
  'cron-process-subscriptions',
  'process-scheduled-sms'
);

-- 3. Schedule Subscriptions processing job (every 10 minutes)
SELECT cron.schedule(
  'cron-process-subscriptions',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/cron-process-subscriptions',
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'supabase_service_role' LIMIT 1
        )
      )::jsonb,
      body := '{}'::jsonb
    );
  $$
);

-- 4. Schedule Custom Broadcasts processing job (every minute)
SELECT cron.schedule(
  'process-scheduled-sms',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/process-scheduled-sms',
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'supabase_service_role' LIMIT 1
        )
      )::jsonb,
      body := '{}'::jsonb
    );
  $$
);
