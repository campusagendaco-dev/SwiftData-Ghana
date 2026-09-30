-- Migration: Automated Twice-Daily "We Missed You" Push & In-App Broadcast for Inactive Users
-- Description: Schedules pg_cron jobs at 10:00 AM and 6:00 PM UTC daily to send winback push notifications to inactive users reminding them that all orders can now go through smoothly.

-- 1. Add missed_you_push_sent_at column to profiles if not exists
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS missed_you_push_sent_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Helper function to fetch inactive users for win-back notification
CREATE OR REPLACE FUNCTION public.get_inactive_winback_users(
  p_inactive_hours INT DEFAULT 24,
  p_limit INT DEFAULT 500
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  phone TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.user_id,
    p.full_name,
    p.phone
  FROM public.profiles p
  WHERE (p.is_suspended IS FALSE OR p.is_suspended IS NULL)
    AND (p.missed_you_push_sent_at IS NULL OR p.missed_you_push_sent_at <= (NOW() - INTERVAL '12 hours'))
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.agent_id = p.user_id
        AND o.created_at >= (NOW() - (p_inactive_hours || ' hours')::INTERVAL)
    )
  LIMIT p_limit;
$$;

-- 3. Core RPC function to dispatch automated "We Missed You" notifications
CREATE OR REPLACE FUNCTION public.dispatch_missed_you_push_broadcast(
  p_title TEXT DEFAULT 'We Missed You! 👋',
  p_body TEXT DEFAULT 'We missed you! Good news: all your data, airtime, and order payments can now go through smoothly. Place your order now! 🚀',
  p_link TEXT DEFAULT '/dashboard/buy-data',
  p_inactive_hours INT DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_ids UUID[];
  v_count INT := 0;
  v_push_count INT := 0;
  v_service_key TEXT;
  r RECORD;
BEGIN
  -- 1. Fetch eligible inactive user IDs
  SELECT ARRAY_AGG(user_id) INTO v_user_ids
  FROM public.get_inactive_winback_users(p_inactive_hours, 500);

  IF v_user_ids IS NULL OR ARRAY_LENGTH(v_user_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'targeted_users', 0,
      'push_tokens_notified', 0,
      'message', 'No inactive users eligible for winback notification at this time.'
    );
  END IF;

  v_count := ARRAY_LENGTH(v_user_ids, 1);

  -- 2. Insert in-app notifications (trg_user_notification_push will automatically trigger web push via send-push-notification)
  INSERT INTO public.user_notifications (user_id, title, message, type, link, data)
  SELECT 
    uid,
    p_title,
    p_body,
    'winback',
    p_link,
    '{"winback": true, "automated": true, "campaign": "we_missed_you"}'::jsonb
  FROM UNNEST(v_user_ids) AS uid;

  -- 3. Update missed_you_push_sent_at on profiles to prevent re-blasting within 12 hours
  UPDATE public.profiles
  SET missed_you_push_sent_at = NOW()
  WHERE user_id = ANY(v_user_ids);

  -- 4. Count total push subscriptions targeted
  SELECT COUNT(DISTINCT id) INTO v_push_count
  FROM public.push_subscriptions
  WHERE user_id = ANY(v_user_ids);

  -- 5. Also dispatch directly to push_subscriptions for offline browser/PWA tokens via pg_net if service key available
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

  IF v_service_key IS NOT NULL AND v_service_key != '' THEN
    FOR r IN 
      SELECT DISTINCT user_id 
      FROM public.push_subscriptions
      WHERE user_id = ANY(v_user_ids)
    LOOP
      PERFORM net.http_post(
        url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object(
          'user_id', r.user_id,
          'title', p_title,
          'body', p_body,
          'url', p_link
        )
      );
    END LOOP;
  END IF;

  -- 6. Log entry into push_notification_logs
  INSERT INTO public.push_notification_logs (
    user_id, title, body, url, device_count, success_count, failure_count, status, error_details
  ) VALUES (
    NULL,
    p_title,
    p_body,
    p_link,
    v_push_count,
    v_count,
    0,
    'delivered',
    'Automated twice-daily winback push blast dispatched to ' || v_count || ' inactive users.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'targeted_users', v_count,
    'push_tokens_notified', v_push_count,
    'message', 'Successfully dispatched "We Missed You" notification blast.'
  );
END;
$$;

-- 4. Enable pg_cron (idempotent check)
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- 5. Clear existing schedule if present
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN ('cron-missed-you-push-twice-daily');

-- 6. Schedule twice daily automated blast (10:00 AM and 6:00 PM UTC/GMT every day)
SELECT cron.schedule(
  'cron-missed-you-push-twice-daily',
  '0 10,18 * * *',
  $$
    SELECT public.dispatch_missed_you_push_broadcast(
      'We Missed You! 👋',
      'We missed you! Good news: all your data, airtime, and order payments can now go through smoothly. Place your order now! 🚀',
      '/dashboard/buy-data',
      24
    );
  $$
);
