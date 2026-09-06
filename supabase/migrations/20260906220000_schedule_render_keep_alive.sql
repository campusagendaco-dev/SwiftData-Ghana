-- Migration: Schedule automated Render keep-alive heartbeat
-- Description: Configures pg_cron job to ping Render backend /health every 10 minutes using pg_net to keep service warm 24/7.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Unschedule existing ping job if present
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname = 'cron-ping-render-keepalive';

-- Schedule ping every 10 minutes
SELECT cron.schedule(
  'cron-ping-render-keepalive',
  '*/10 * * * *',
  $$
    SELECT net.http_get(
      url := 'https://swiftdata-auth-backend.onrender.com/health',
      headers := jsonb_build_object(
        'User-Agent', 'Supabase-KeepAlive-Cron/1.0'
      )
    );
  $$
);
