-- Re-assert that the "send to everyone" notification functions are server-only.
-- 20261031110000 redefined some of these (dispatch_missed_you_push_broadcast lost its
-- admin guard); they stayed safe only because 20261024110000 had revoked EXECUTE.
-- This makes the lock explicit for every overload, so a future CREATE OR REPLACE of a
-- new signature can't silently reopen them.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'broadcast_push_notification',
        'dispatch_system_upgrade_broadcast',
        'run_daily_smooth_broadcast',
        'cleanup_old_notifications',
        'handle_user_notification_push'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- dispatch_missed_you_push_broadcast is called by the admin Notifications page, so it keeps
-- EXECUTE for authenticated, but the admin check that 20261031110000 dropped is restored.
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
  -- [security 2026-11-04] restored: browser callers must be admins (service_role / cron / triggers unaffected)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'dispatch_missed_you_push_broadcast: admin privileges required' USING ERRCODE = '42501';
  END IF;
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

REVOKE ALL ON FUNCTION public.dispatch_missed_you_push_broadcast(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_missed_you_push_broadcast(text, text, text, integer) TO authenticated, service_role;
