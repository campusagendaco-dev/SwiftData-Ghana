-- Migration: Completely remove auto-retry triggers and cron jobs
-- Drop the trigger on orders table
DROP TRIGGER IF EXISTS on_order_needs_fulfillment ON orders;

-- Drop the trigger function
DROP FUNCTION IF EXISTS trigger_retry_order();

-- Unschedule pg_cron jobs
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('process-retries-job', 'cron-auto-retry');
