-- Migration: Fix pg_cron schedule for "We Missed You" twice-daily blast
-- Splits 0 10,18 * * * into two distinct standard single-hour schedules for pg_cron compatibility.

-- 1. Unschedule old combined job if present
SELECT cron.unschedule('cron-missed-you-push-twice-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-missed-you-push-twice-daily');

SELECT cron.unschedule('cron-missed-you-morning')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-missed-you-morning');

SELECT cron.unschedule('cron-missed-you-evening')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-missed-you-evening');

-- 2. Schedule 10:00 AM UTC (Morning Win-Back Push)
SELECT cron.schedule(
  'cron-missed-you-morning',
  '0 10 * * *',
  'SELECT public.dispatch_missed_you_push_broadcast(''We Missed You! 👋'', ''We missed you! Good news: all your data, airtime, and order payments can now go through smoothly. Place your order now! 🚀'', ''/dashboard/buy-data'', 24);'
);

-- 3. Schedule 6:00 PM UTC (Evening Win-Back Push)
SELECT cron.schedule(
  'cron-missed-you-evening',
  '0 18 * * *',
  'SELECT public.dispatch_missed_you_push_broadcast(''We Missed You! 👋'', ''We missed you! Good news: all your data, airtime, and order payments can now go through smoothly. Place your order now! 🚀'', ''/dashboard/buy-data'', 24);'
);
