-- ============================================================
-- SCHEDULE CRON JOB FOR HEALING STUCK PROCESSING ORDERS
-- ============================================================

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove old schedule if exists (idempotent)
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'cron-heal-processing';

-- Auto-heal processing orders every 3 minutes
SELECT cron.schedule(
  'cron-heal-processing',
  '*/3 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/heal-processing-orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
