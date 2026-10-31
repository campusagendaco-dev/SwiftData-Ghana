-- ============================================================================
-- Migration: Fix Notification System, Web Push Triggers, & Scheduled Broadcast Engine
-- Date: 2026-10-31
-- ============================================================================

-- 1. Ensure Web Push Registration RPCs exist and are granted to authenticated & service_role
CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_endpoint IS NULL OR trim(p_endpoint) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Endpoint is required');
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE endpoint = trim(p_endpoint)
    AND user_id IS DISTINCT FROM v_uid;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
  VALUES (v_uid, trim(p_endpoint), p_p256dh, p_auth, now())
  ON CONFLICT (user_id, endpoint)
  DO UPDATE SET
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    updated_at = now();

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  BEGIN
    DELETE FROM public.push_subscriptions WHERE endpoint = trim(p_endpoint);
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (v_uid, trim(p_endpoint), p_p256dh, p_auth);
    RETURN jsonb_build_object('success', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unregister_push_subscription(
  p_endpoint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE user_id = v_uid
    AND endpoint = trim(p_endpoint);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unregister_push_subscription(TEXT) TO authenticated, service_role;


-- 2. Fix handle_user_notification_push() Trigger Function:
--    a) Skip per-row HTTP post for bulk broadcasts / automated blasts (which send batched push directly)
--    b) Include Authorization: Bearer <service_role> from Vault so single-user pushes succeed (200 OK instead of 401)
CREATE OR REPLACE FUNCTION public.handle_user_notification_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_sub BOOLEAN := FALSE;
  v_service_key TEXT;
BEGIN
  -- Skip per-row push trigger if this row is part of a bulk/automated broadcast
  IF NEW.data IS NOT NULL AND (
    (NEW.data->>'skip_auto_push') = 'true' OR
    (NEW.data->>'broadcast') = 'true' OR
    (NEW.data->>'automated') = 'true'
  ) THEN
    RETURN NEW;
  END IF;

  -- Check if target user has at least one active push subscription
  SELECT EXISTS (
    SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id
  ) INTO v_has_sub;

  IF NOT v_has_sub THEN
    RETURN NEW;
  END IF;

  -- Retrieve Service Role Key from Vault
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NOT NULL AND v_service_key <> '' THEN
    PERFORM net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'user_id', NEW.user_id,
        'title', COALESCE(NEW.title, 'SwiftData Alert'),
        'body', COALESCE(NEW.message, 'You have a new notification'),
        'url', COALESCE(NEW.link, '/dashboard/notifications'),
        'id', NEW.id::text
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


-- 3. Rewrite broadcast_push_notification() to use batched Web Push (instead of 443x FOR loop)
--    and prevent duplicate SMS queue pile-ups
CREATE OR REPLACE FUNCTION public.broadcast_push_notification(
  p_title TEXT,
  p_body TEXT,
  p_link TEXT DEFAULT '/dashboard'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_key TEXT;
  v_total_subs INT := 0;
  v_offset INT := 0;
  v_has_active_sms_queue BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  -- 1. Bulk insert in-app notifications with skip_auto_push = true so the per-row trigger does not fire 500x
  INSERT INTO public.user_notifications (user_id, title, message, type, link, data)
  SELECT
    user_id,
    p_title,
    p_body,
    'info',
    p_link,
    '{"broadcast": true, "automated": true, "skip_auto_push": true}'::jsonb
  FROM public.profiles
  WHERE is_agent = true OR sub_agent_approved = true;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RETURN;
  END IF;

  -- 2. Dispatch Web Push in 100-device batches (at most 5 calls instead of 443 individual calls)
  SELECT COUNT(*) INTO v_total_subs FROM public.push_subscriptions;
  WHILE v_offset < v_total_subs AND v_offset < 1000 LOOP
    PERFORM net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'broadcast', true,
        'title', p_title,
        'body', p_body,
        'url', p_link,
        'offset', v_offset,
        'limit', 100
      )
    );
    v_offset := v_offset + 100;
  END LOOP;

  -- 3. Dispatch SMS broadcast via admin-send-sms ONLY if no other SMS broadcast is currently pending/processing
  SELECT EXISTS (
    SELECT 1 FROM public.scheduled_broadcasts WHERE status IN ('pending', 'processing')
  ) INTO v_has_active_sms_queue;

  IF NOT v_has_active_sms_queue THEN
    PERFORM net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/admin-send-sms',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'target_type', 'agents',
        'title', p_title,
        'message', p_body,
        'target_filters', jsonb_build_object('sender_id', 'SwiftDataGh')
      )
    );
  END IF;

  -- 4. Dispatch WhatsApp Blast Broadcast
  PERFORM net.http_post(
    url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/admin-broadcast-whatsapp',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'title', p_title,
      'message', p_body,
      'broadcast_to_channel', true,
      'check_delivery_smooth', true,
      'site_url', 'https://swiftdatagh.shop' || COALESCE(p_link, '')
    )
  );
END;
$$;

-- 3b. Restore clean UTF-8 emojis in run_daily_smooth_broadcast()
CREATE OR REPLACE FUNCTION public.run_daily_smooth_broadcast(p_slot TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_total INT := 0;
  v_recent_fulfilled INT := 0;
  v_recent_failed INT := 0;
  v_smooth_header TEXT := '';
  v_title TEXT;
  v_body TEXT;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'fulfilled'),
    COUNT(*) FILTER (WHERE status = 'fulfillment_failed')
  INTO v_recent_total, v_recent_fulfilled, v_recent_failed
  FROM public.orders
  WHERE created_at >= (NOW() - INTERVAL '60 minutes');

  IF v_recent_total >= 2 THEN
    IF v_recent_failed = 0 OR (v_recent_fulfilled::float / v_recent_total::float) >= 0.8 THEN
      v_smooth_header := '⚡ Live Network Status: Delivery is 100% Smooth & Instant! Zero carrier delay. ' || E'\n\n';
    END IF;
  END IF;

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


-- 4. Rewrite dispatch_missed_you_push_broadcast() to use batched user_ids instead of 400x FOR loop
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
  v_sub_user_ids UUID[];
  v_batch_ids UUID[];
  v_count INT := 0;
  v_push_count INT := 0;
  v_sub_user_count INT := 0;
  v_idx INT := 1;
  v_service_key TEXT;
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

  -- 2. Insert in-app notifications with skip_auto_push = true
  INSERT INTO public.user_notifications (user_id, title, message, type, link, data)
  SELECT
    uid,
    p_title,
    p_body,
    'info',
    p_link,
    '{"winback": true, "automated": true, "skip_auto_push": true, "campaign": "we_missed_you"}'::jsonb
  FROM UNNEST(v_user_ids) AS uid;

  -- 3. Update missed_you_push_sent_at on profiles to prevent re-blasting within 12 hours
  UPDATE public.profiles
  SET missed_you_push_sent_at = NOW()
  WHERE user_id = ANY(v_user_ids);

  -- 4. Collect distinct subscribed user_ids for batched push dispatch
  SELECT COUNT(DISTINCT id), ARRAY_AGG(DISTINCT user_id)
  INTO v_push_count, v_sub_user_ids
  FROM public.push_subscriptions
  WHERE user_id = ANY(v_user_ids);

  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  -- 5. Dispatch Web Push in batches of 100 user_ids (instead of 1 HTTP call per user)
  IF v_service_key IS NOT NULL AND v_service_key <> '' AND v_sub_user_ids IS NOT NULL THEN
    v_sub_user_count := COALESCE(ARRAY_LENGTH(v_sub_user_ids, 1), 0);
    WHILE v_idx <= v_sub_user_count LOOP
      v_batch_ids := v_sub_user_ids[v_idx : LEAST(v_idx + 99, v_sub_user_count)];
      PERFORM net.http_post(
        url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object(
          'user_ids', to_jsonb(v_batch_ids),
          'title', p_title,
          'body', p_body,
          'url', p_link,
          'limit', 100
        )
      );
      v_idx := v_idx + 100;
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
    COALESCE(v_push_count, 0),
    v_count,
    0,
    'delivered',
    'Automated winback push blast dispatched to ' || v_count || ' inactive users.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'targeted_users', v_count,
    'push_tokens_notified', COALESCE(v_push_count, 0),
    'message', 'Successfully dispatched "We Missed You" notification blast.'
  );
END;
$$;


-- 5. Cancel all stale backlogged scheduled_broadcasts (>1 hour old) and strip bloated cached_recipients JSONB
UPDATE public.scheduled_broadcasts
SET
  status = 'cancelled',
  result = (COALESCE(result, '{}'::jsonb) - 'cached_recipients') || '{"error": "Cancelled stale backlog during notification engine upgrade"}'::jsonb
WHERE status IN ('pending', 'processing')
  AND scheduled_at < (NOW() - INTERVAL '1 hour');

UPDATE public.scheduled_broadcasts
SET result = result - 'cached_recipients'
WHERE status IN ('sent', 'cancelled', 'failed')
  AND result ? 'cached_recipients';


-- 6. Add fast composite index on user_notifications and prune historical automated bloat
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON public.user_notifications (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_notifs INT := 0;
  v_cleaned_broadcasts INT := 0;
BEGIN
  -- Delete automated/broadcast notifications older than 7 days, read notifications older than 14 days, or any older than 30 days (in bounded batches of 50,000)
  WITH to_delete AS (
    SELECT ctid
    FROM public.user_notifications
    WHERE created_at < (NOW() - INTERVAL '30 days')
       OR (read = true AND created_at < (NOW() - INTERVAL '14 days'))
       OR ((data->>'automated' = 'true' OR data->>'broadcast' = 'true') AND created_at < (NOW() - INTERVAL '7 days'))
    LIMIT 50000
  ),
  deleted AS (
    DELETE FROM public.user_notifications
    WHERE ctid IN (SELECT ctid FROM to_delete)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted_notifs FROM deleted;

  -- Strip cached_recipients from any completed/cancelled scheduled_broadcasts
  WITH cleaned AS (
    UPDATE public.scheduled_broadcasts
    SET result = result - 'cached_recipients'
    WHERE status IN ('sent', 'cancelled', 'failed')
      AND result ? 'cached_recipients'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_cleaned_broadcasts FROM cleaned;

  RETURN jsonb_build_object(
    'deleted_notifications', v_deleted_notifs,
    'cleaned_broadcasts', v_cleaned_broadcasts
  );
END;
$$;

-- Run initial cleanup immediately
SELECT public.cleanup_old_notifications();

-- Schedule daily cleanup at 03:30 UTC
SELECT cron.unschedule('cleanup-old-notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-notifications');

SELECT cron.schedule(
  'cleanup-old-notifications',
  '30 3 * * *',
  $$ SELECT public.cleanup_old_notifications(); $$
);


-- 7. Fix process-retries-job to use vault.decrypted_secrets instead of empty current_setting
SELECT cron.unschedule('process-retries-job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-retries-job');

SELECT cron.schedule(
  'process-retries-job',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/process-retries',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'supabase_service_role' LIMIT 1
        )
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

NOTIFY pgrst, 'reload schema';
