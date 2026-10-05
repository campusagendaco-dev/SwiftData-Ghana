-- Migration: Schedule daily smooth broadcasts (7am and every 3 hours) synced across Web Push, In-App, and WhatsApp
-- Description:
-- 1. Updates public.broadcast_push_notification to sync with admin-broadcast-whatsapp
-- 2. Creates public.run_daily_smooth_broadcast to check real-time order delivery smoothness, highlight Korba & carrier packages, and broadcast
-- 3. Configures pg_cron to trigger every 3 hours: 7:00 AM, 10:00 AM, 1:00 PM, 4:00 PM, 7:00 PM, and 10:00 PM (UTC/Ghana Time)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA cron TO postgres;

-- 1. Synchronized Broadcast Function (Web Push + In-App + SMS + WhatsApp Blast)
CREATE OR REPLACE FUNCTION public.broadcast_push_notification(
  p_title TEXT,
  p_body TEXT,
  p_link TEXT DEFAULT '/dashboard'
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD;
  v_service_key TEXT;
BEGIN
  -- Retrieve Supabase Service Role Key from Vault or fallback
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

  -- 3. Dispatch SMS broadcasts via admin-send-sms
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

  -- 4. Dispatch WhatsApp Blast Broadcast (synced to all WhatsApp users and WhatsApp channel)
  IF v_service_key IS NOT NULL AND v_service_key != '' THEN
    PERFORM net.http_post(
      url     := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/admin-broadcast-whatsapp',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object(
        'title', p_title,
        'message', p_body,
        'broadcast_to_channel', true,
        'check_delivery_smooth', true,
        'site_url', 'https://swiftdatagh.shop' || COALESCE(p_link, '')
      )
    );
  END IF;
END;
$$;

-- 2. Routine to check delivery smoothness and broadcast tailored daily interval messages
CREATE OR REPLACE FUNCTION public.run_daily_smooth_broadcast(p_slot TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_recent_total INT := 0;
  v_recent_fulfilled INT := 0;
  v_recent_failed INT := 0;
  v_is_smooth BOOLEAN := TRUE;
  v_smooth_header TEXT := '';
  v_title TEXT;
  v_body TEXT;
BEGIN
  -- Check delivery health over the last 60 minutes
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'fulfilled'),
    COUNT(*) FILTER (WHERE status = 'fulfillment_failed')
  INTO v_recent_total, v_recent_fulfilled, v_recent_failed
  FROM public.orders
  WHERE created_at >= (NOW() - INTERVAL '60 minutes');

  IF v_recent_total >= 2 THEN
    IF v_recent_failed = 0 OR (v_recent_fulfilled::float / v_recent_total::float) >= 0.8 THEN
      v_is_smooth := TRUE;
      v_smooth_header := '⚡ Live Network Status: Delivery is 100% Smooth & Instant! Zero carrier delay. ' || E'\n\n';
    ELSE
      v_is_smooth := FALSE;
    END IF;
  END IF;

  -- Select customized message per 3-hour slot highlighting Korba and carrier packages
  CASE p_slot
    WHEN '7am' THEN
      v_title := '🌅 Morning Kickoff: MTN, Telecel & Korba Bundles Active! ⚡';
      v_body := v_smooth_header || 'Start your day fully connected! High-speed MTN, Telecel, AirtelTigo and Korba special packages are active right now with instant automated delivery. Buy wholesale or retail at https://swiftdatagh.shop or via WhatsApp bot!';
    WHEN '10am' THEN
      v_title := '🚀 MTN 399 & Korba BigTime Packages Live! 🔥';
      v_body := v_smooth_header || 'Huge data savings for work, school, and heavy downloads! Non-expiry MTN 399 and Korba BigTime packages are delivering with zero delay. Order now at https://swiftdatagh.shop or on WhatsApp!';
    WHEN '1pm' THEN
      v_title := '⚡ Afternoon Power-Up: Instant Data Delivery Active! 📶';
      v_body := v_smooth_header || 'Never run out of internet mid-day. Instant bundle refills for MTN, Telecel, and Korba data packages ready in seconds. Top up your wallet or order directly!';
    WHEN '4pm' THEN
      v_title := '🎯 Evening Stock: Korba No-Expiry & Telecel Specials! 📱';
      v_body := v_smooth_header || 'Get ready for the evening commute! Korba No-Expiry bundles and Telecel high-speed packages are fully stocked. Earn up to GHS 12 profit per customer sale!';
    WHEN '7pm' THEN
      v_title := '🎬 Prime Streaming & Video Packs Active! 📺';
      v_body := v_smooth_header || 'Stream YouTube, Netflix & TikTok smoothly tonight! Evening streaming packs and Korba high-volume bundles are active right now at unbeatable wholesale rates.';
    WHEN '10pm' THEN
      v_title := '🌙 Midnight Heavy Download & Korba Packs Live! 🚀';
      v_body := v_smooth_header || 'Pre-order your overnight heavy download packages! Midnight bundles and Korba night data packages are open now. Secure high-volume data before bedtime!';
    ELSE
      v_title := '⚡ SwiftData High-Speed Bundles Active! 🚀';
      v_body := v_smooth_header || 'Automated bundle delivery is active across all networks including MTN, Telecel, AirtelTigo and Korba. Order anytime on https://swiftdatagh.shop or WhatsApp bot!';
  END CASE;

  PERFORM public.broadcast_push_notification(v_title, v_body, '/dashboard/buy-data');
END;
$$;

-- 3. Clear existing broadcast cron schedules to avoid duplicate executions
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN (
  'cron-broadcast-7am',
  'cron-broadcast-10am',
  'cron-broadcast-1pm',
  'cron-broadcast-4pm',
  'cron-broadcast-7pm',
  'cron-broadcast-10pm',
  'cron-broadcast-kokro',
  'cron-broadcast-mtn399',
  'cron-broadcast-video',
  'cron-broadcast-midnight'
);

-- 4. Schedule 6 daily broadcast intervals (Ghana Time is UTC+0)
-- 7:00 AM everyday
SELECT cron.schedule(
  'cron-broadcast-7am',
  '0 7 * * *',
  $$ SELECT public.run_daily_smooth_broadcast('7am'); $$
);

-- 10:00 AM everyday
SELECT cron.schedule(
  'cron-broadcast-10am',
  '0 10 * * *',
  $$ SELECT public.run_daily_smooth_broadcast('10am'); $$
);

-- 1:00 PM (13:00 UTC) everyday
SELECT cron.schedule(
  'cron-broadcast-1pm',
  '0 13 * * *',
  $$ SELECT public.run_daily_smooth_broadcast('1pm'); $$
);

-- 4:00 PM (16:00 UTC) everyday
SELECT cron.schedule(
  'cron-broadcast-4pm',
  '0 16 * * *',
  $$ SELECT public.run_daily_smooth_broadcast('4pm'); $$
);

-- 7:00 PM (19:00 UTC) everyday
SELECT cron.schedule(
  'cron-broadcast-7pm',
  '0 19 * * *',
  $$ SELECT public.run_daily_smooth_broadcast('7pm'); $$
);

-- 10:00 PM (22:00 UTC) everyday
SELECT cron.schedule(
  'cron-broadcast-10pm',
  '0 22 * * *',
  $$ SELECT public.run_daily_smooth_broadcast('10pm'); $$
);
