-- ================================================================
-- SCHEDULE AUTOMATED BULK ORDER STATUS CHECK EVERY 3 MINUTES
-- Queries upstream carrier/provider APIs for active processing
-- orders every 3 minutes via check-order-status (auto_bulk: true)
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Unschedule any existing bulk status check cron job to avoid duplicates
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN ('cron-bulk-check-order-status', 'bulk-check-order-status-3min');

-- Schedule bulk status check every 3 minutes
SELECT cron.schedule(
  'cron-bulk-check-order-status',
  '*/3 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/check-order-status',
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          NULLIF(current_setting('app.settings.service_role_key', true), ''),
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1)
        )
      )::jsonb,
      body := '{"auto_bulk": true, "limit": 50}'::jsonb
    );
  $$
);

