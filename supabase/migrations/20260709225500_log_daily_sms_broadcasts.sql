-- Migration: Log Daily SMS Broadcasts
-- Description: Redefines the public.broadcast_push_notification function to insert a row into the public.sms_logs table for every recipient when a daily automated marketing SMS broadcast is dispatched.

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
  v_phone_array JSONB;
BEGIN
  -- Retrieve Supabase Service Role Key from Vault
  SELECT decrypted_secret INTO v_service_key 
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role' LIMIT 1;

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

  -- 3. Dispatch SMS broadcasts directly to TxtConnect API in a single bulk request (bypasses rate limits)
  SELECT txtconnect_api_key, txtconnect_sender_id 
  INTO v_sms_api_key, v_sms_sender_id 
  FROM public.v_system_settings_with_secrets 
  WHERE id = 1;

  SELECT COALESCE(json_agg(public.normalize_phone_sql(phone))::jsonb, '[]'::jsonb) INTO v_phone_array
  FROM public.profiles
  WHERE (is_agent = true OR sub_agent_approved = true) AND phone IS NOT NULL AND phone != '';

  IF v_phone_array IS NOT NULL AND jsonb_array_length(v_phone_array) > 0 AND v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
    PERFORM net.http_post(
      url     := 'https://api.txtconnect.net/dev/api/sms/send',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
      body    := jsonb_build_object(
        'to', v_phone_array,
        'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
        'sms', p_title || E'\n' || p_body,
        'unicode', '0'
      )
    );

    -- Log bulk-sent SMS to public.sms_logs for platform visibility and admin tracking
    INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
    SELECT 
      public.normalize_phone_sql(phone),
      COALESCE(v_sms_sender_id, 'Orderinfo'),
      p_title || E'\n' || p_body,
      'broadcast',
      'success',
      user_id
    FROM public.profiles
    WHERE (is_agent = true OR sub_agent_approved = true) AND phone IS NOT NULL AND phone != '';
  END IF;
END;
$$;
