-- Setup pg_cron job for Guardian AI (Run this in the Supabase SQL Editor)
-- This will trigger the guardian-ai edge function every 5 minutes.

-- Ensure pg_net is enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create the cron job
SELECT cron.schedule(
    'guardian-ai-patrol',
    '*/5 * * * *', -- Every 5 minutes
    $$
    SELECT net.http_post(
        url:='https://lsocdjpflecduumopijn.supabase.co/functions/v1/guardian-ai',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
        body:='{"source": "pg_cron"}'::jsonb
    ) as request_id;
    $$
);
