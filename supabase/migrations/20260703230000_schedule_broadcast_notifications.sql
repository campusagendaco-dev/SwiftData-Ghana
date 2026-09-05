-- Migration: Schedule automated daily push and in-app broadcasts for packages
-- Description: Configures pg_cron jobs to broadcast alerts for Kokro bundles (5am), MTN 399 (10am), Video Packs (8pm), and Midnight Bundles (9pm) every day.

-- 1. Helper function to broadcast notifications (both in-app and Web Push)
CREATE OR REPLACE FUNCTION public.broadcast_push_notification(
  p_title TEXT,
  p_body TEXT,
  p_link TEXT DEFAULT '/dashboard'
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD;
  v_service_key TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
BEGIN
  -- Retrieve Supabase Service Role Key from Vault or system settings fallback
  BEGIN
    SELECT decrypted_secret INTO v_service_key 
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    BEGIN
      SELECT current_setting('app.settings.service_role_key', true) INTO v_service_key;
    EXCEPTION WHEN OTHERS THEN
      v_service_key := NULL;
    END;
  END IF;

  -- 1. Insert in-app notifications
  INSERT INTO public.user_notifications (user_id, title, message, type, link, data)
  SELECT 
    user_id,
    p_title,
    p_body,
    'info',
    p_link,
    '{"broadcast": true, "automated": true}'::jsonb
  FROM public.profiles
  WHERE is_agent = true OR sub_agent_approved = true;

  -- 2. Dispatch push notifications to each subscriber via Deno Edge Function using pg_net
  FOR r IN 
    SELECT DISTINCT user_id 
    FROM public.push_subscriptions
  LOOP
    PERFORM net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/send-push-notification',
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      )::jsonb,
      body := json_build_object(
        'user_id', r.user_id,
        'title', p_title,
        'body', p_body,
        'url', p_link
      )::jsonb
    );
  END LOOP;

  -- 3. Dispatch SMS broadcasts via admin-send-sms Edge Function (supports both Korba SMS & TxtConnect + logs)
  IF v_service_key IS NOT NULL AND v_service_key != '' THEN
    PERFORM net.http_post(
      url     := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/admin-send-sms',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object(
        'target_type', 'agents',
        'title', p_title,
        'message', p_body
      )
    );
  END IF;
END;
$$;

-- 2. Enable pg_cron (idempotent check)
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- 3. Clear existing broadcast cron schedules to avoid duplicates
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN (
  'cron-broadcast-kokro',
  'cron-broadcast-mtn399',
  'cron-broadcast-video',
  'cron-broadcast-midnight'
);

-- 4. Schedule daily broadcasts (UTC matches GMT/Ghana local time)
-- Kokro bundle (MTN + AirtelTigo) at 5:00 AM everyday
SELECT cron.schedule(
  'cron-broadcast-kokro',
  '0 5 * * *',
  $$
    SELECT public.broadcast_push_notification(
      '🐔 MTN & AirtelTigo Kokro Bundles Active! 🌅',
      'Start your morning strong! MTN and AirtelTigo Kokro data packages are active right now. Purchase at reseller rates on https://swiftdatagh.shop and earn up to GHS 3.50 commission per customer sale!',
      '/dashboard/buy-data'
    );
  $$
);

-- MTN 399 Packages at 10:00 AM everyday
SELECT cron.schedule(
  'cron-broadcast-mtn399',
  '0 10 * * *',
  $$
    SELECT public.broadcast_push_notification(
      '🔥 MTN 399 Data Packages Live! 🚀',
      'Get high-speed, non-expiry MTN 399 bundles. Best rates for heavy internet users. Buy wholesale at https://swiftdatagh.shop and make GHS 12.00 profit on every order!',
      '/dashboard/buy-data'
    );
  $$
);

-- Video Packs at 8:00 PM (20:00 UTC) everyday
SELECT cron.schedule(
  'cron-broadcast-video',
  '0 20 * * *',
  $$
    SELECT public.broadcast_push_notification(
      '🎬 Evening Video Streaming Packs Active! 📺',
      'Stream your favorite shows and movies tonight! Get high-volume streaming video packs for YouTube, Netflix, and TikTok at wholesale rates on https://swiftdatagh.shop now!',
      '/dashboard/buy-data'
    );
  $$
);

-- Midnight Bundles at 9:00 PM (21:00 UTC) everyday
SELECT cron.schedule(
  'cron-broadcast-midnight',
  '0 21 * * *',
  $$
    SELECT public.broadcast_push_notification(
      '🌙 Midnight Bundles Live — Top Up Now! 🐔',
      'Get ready for overnight downloads! Midnight bundles are now open for pre-order. Secure your package at GHS 3.00 wholesale rate on https://swiftdatagh.shop before midnight! 🚀',
      '/dashboard/buy-data'
    );
  $$
);
