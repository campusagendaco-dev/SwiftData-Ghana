-- Migration: Update Default SMS Sender ID and Clean SMS Templates
-- Description: Redefines balance alert trigger, mashup complete trigger, and broadcast notifications trigger functions to fall back to 'Orderinfo' instead of 'SwiftDataGh'. Also updates standard database settings to use 'Orderinfo' as default sender ID and removes WhatsApp channel invitation links from default SMS messages.

-- 1. Redefine handle_api_wallet_balance_trigger with new fallback sender ID
CREATE OR REPLACE FUNCTION public.handle_api_wallet_balance_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
BEGIN
  -- Reset the flag if wallet is refilled above threshold, enabling trigger to fire next time it drops.
  IF NEW.api_balance >= 100.00 AND COALESCE(OLD.api_balance, 0) < 100.00 THEN
     NEW.api_low_balance_alert_sent := false;
  END IF;

  -- Detect if balance crossed UNDER 100.00 and hasn't generated an alert yet
  IF NEW.api_balance < 100.00 AND COALESCE(OLD.api_balance, 9999) >= 100.00 
     AND COALESCE(NEW.api_low_balance_alert_sent, false) = false THEN
     
     -- Build standardized notification text
     v_message := '⚠️ Low Balance Alert: Your API Wallet balance is currently GHS ' || ROUND(NEW.api_balance, 2) || '. Please top up soon to avoid service interruption.';

     -- AUTOMATIC IN-APP NOTIFICATION INSERT!
     INSERT INTO public.user_notifications (user_id, title, message, type, link)
     VALUES (NEW.agent_id, 'Low API Balance', v_message, 'warning', '/dashboard/api');

     -- Identify recipient phone number
     SELECT phone INTO v_phone FROM public.profiles WHERE user_id = NEW.agent_id;
     v_normalized_phone := public.normalize_phone_sql(v_phone);

     -- Pull configured SMS Credentials (use the secure settings view!)
     SELECT txtconnect_api_key, txtconnect_sender_id 
     INTO v_sms_api_key, v_sms_sender_id 
     FROM public.v_system_settings_with_secrets 
     WHERE id = 1;

     -- Dispatch SMS via pg_net
     IF v_normalized_phone IS NOT NULL AND v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
        v_payload := jsonb_build_object(
          'to', v_normalized_phone,
          'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
          'sms', v_message,
          'unicode', '0'
        );

        PERFORM net.http_post(
          url     := 'https://api.txtconnect.net/dev/api/sms/send',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
          body    := v_payload
        );
     END IF;

     -- Mark alert tracking column
     NEW.api_low_balance_alert_sent := true;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Redefine handle_mashup_order_completed_trigger with new fallback sender ID
CREATE OR REPLACE FUNCTION public.handle_mashup_order_completed_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_normalized_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
BEGIN
  -- Trigger when status changes to 'completed' or 'fulfilled' and network is 'MTN Mash Up'
  IF (NEW.status = 'completed' OR NEW.status = 'fulfilled') 
     AND (COALESCE(OLD.status, 'none') NOT IN ('completed', 'fulfilled')) 
     AND NEW.network = 'MTN Mash Up' THEN
     
     -- 1. Normalize recipient phone
     v_normalized_phone := public.normalize_phone_sql(NEW.customer_phone);

     -- 2. Pull configured SMS Credentials directly from settings
     SELECT txtconnect_api_key, txtconnect_sender_id 
     INTO v_sms_api_key, v_sms_sender_id 
     FROM public.v_system_settings_with_secrets 
     WHERE id = 1;

     -- 3. Proceed only if requirements met
     IF v_normalized_phone IS NOT NULL AND v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
        v_message := 'Your MTN Mash Up bundle of ' || NEW.package_size || ' has been successfully completed. Please check your balance for proof. Thank you for your business!';
        
        v_payload := jsonb_build_object(
          'to', v_normalized_phone,
          'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
          'sms', v_message,
          'unicode', '0'
        );

        -- 4. Dispatch direct, asynchronous HTTP Request via pg_net Extension
        PERFORM net.http_post(
          url     := 'https://api.txtconnect.net/dev/api/sms/send',
          headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || v_sms_api_key
          ),
          body    := v_payload
        );
     END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Redefine broadcast_push_notification with new fallback sender ID
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
  FROM public.system_settings 
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
  END IF;
END;
$$;

-- 4. Update system_settings table defaults and existing values
UPDATE public.system_settings
SET 
  txtconnect_sender_id = 'Orderinfo'
WHERE txtconnect_sender_id = 'SwiftDataGh' OR txtconnect_sender_id IS NULL OR txtconnect_sender_id = '';

-- 5. Strip out default WhatsApp Channel links from default SMS messages
UPDATE public.system_settings
SET 
  payment_success_sms_message = 'Success! Your order for {phone} has been processed.'
WHERE payment_success_sms_message LIKE '%https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40%';

UPDATE public.system_settings
SET 
  utility_paid_sms_message = 'Payment received! Your {utility_type} bill for {account} is being processed.'
WHERE utility_paid_sms_message LIKE '%https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40%';

UPDATE public.system_settings
SET 
  wallet_topup_sms_message = 'Your wallet has been credited with GHS {amount}. New balance: GHS {balance}.'
WHERE wallet_topup_sms_message LIKE '%https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40%';

UPDATE public.system_settings
SET 
  withdrawal_completed_sms_message = 'Your withdrawal of GHS {amount} has been completed.'
WHERE withdrawal_completed_sms_message LIKE '%https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40%';

UPDATE public.system_settings
SET 
  manual_credit_sms_message = 'Your account has been manually credited with GHS {amount}.'
WHERE manual_credit_sms_message LIKE '%https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40%';
