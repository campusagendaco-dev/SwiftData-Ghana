-- Migration: Fix Triggers Agent ID Constraint Violation
-- Description: Resolves agent_id foreign key constraint violations when inserting dummy/anonymous agent IDs ('00000000-0000-0000-0000-000000000000') into sms_logs.

-- 1. Update New Beneficiary Warning Trigger
CREATE OR REPLACE FUNCTION public.handle_new_beneficiary_order_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
  v_sms_api_key TEXT;
  v_whatsapp_link TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
  v_sms_agent_id UUID;
BEGIN
  -- Trigger when a new order is placed with bypass_beneficiary in metadata
  IF NEW.metadata->>'bypass_beneficiary' = 'true' THEN
    
    -- Identify the user/agent phone number
    IF NEW.agent_id IS NOT NULL AND NEW.agent_id != '00000000-0000-0000-0000-000000000000' THEN
      SELECT phone INTO v_phone FROM public.profiles WHERE user_id = NEW.agent_id;
    ELSE
      v_phone := NEW.customer_phone;
    END IF;

    v_normalized_phone := public.normalize_phone_sql(v_phone);

    IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
      -- Get configured credentials and WhatsApp link
      SELECT 
        txtconnect_api_key,
        COALESCE(support_channel_link, 'https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40')
      INTO v_sms_api_key, v_whatsapp_link
      FROM public.v_system_settings_with_secrets
      WHERE id = 1;

      -- Build notification text
      v_message := 'Notice: Since you purchased for a new unverified beneficiary, delivery will take 24 to 72 hours. Join our WhatsApp channel for updates: ' || v_whatsapp_link;

      IF v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
         v_payload := jsonb_build_object(
           'to', v_normalized_phone,
           'from', 'swiftupdate', -- Use sender ID 'swiftupdate' as requested
           'sms', v_message,
           'unicode', '0'
         );

         PERFORM net.http_post(
           url     := 'https://api.txtconnect.net/dev/api/sms/send',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
           body    := v_payload
         );

         -- Verify if agent_id is a valid profile to prevent FK violation in sms_logs
         IF NEW.agent_id IS NOT NULL AND NEW.agent_id != '00000000-0000-0000-0000-000000000000' AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.agent_id) THEN
           v_sms_agent_id := NEW.agent_id;
         ELSE
           v_sms_agent_id := NULL;
         END IF;

         -- Log SMS log
         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         VALUES (
           v_normalized_phone,
           'swiftupdate',
           v_message,
           'custom',
           'success',
           v_sms_agent_id
         );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Update Order Failure Trigger
CREATE OR REPLACE FUNCTION public.handle_order_failed_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
  v_sms_agent_id UUID;
BEGIN
  IF NEW.status = 'fulfillment_failed' AND (OLD.status IS NULL OR OLD.status != 'fulfillment_failed') THEN
    
    -- Identify the agent/user phone number to notify them about their refund
    IF NEW.agent_id IS NOT NULL AND NEW.agent_id != '00000000-0000-0000-0000-000000000000' THEN
      SELECT phone INTO v_phone FROM public.profiles WHERE user_id = NEW.agent_id;
    ELSE
      v_phone := NEW.customer_phone;
    END IF;

    v_normalized_phone := public.normalize_phone_sql(v_phone);

    IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
      SELECT txtconnect_api_key, txtconnect_sender_id 
      INTO v_sms_api_key, v_sms_sender_id 
      FROM public.v_system_settings_with_secrets 
      WHERE id = 1;

      v_message := 'Order Notice: Your purchase of ' || COALESCE(NEW.package_size, 'data') || ' for ' || COALESCE(NEW.customer_phone, '') || ' failed. Your wallet balance has been refunded. Try again: https://swiftdatagh.shop/dashboard';

      IF v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
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

         -- Verify if agent_id is a valid profile to prevent FK violation in sms_logs
         IF NEW.agent_id IS NOT NULL AND NEW.agent_id != '00000000-0000-0000-0000-000000000000' AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.agent_id) THEN
           v_sms_agent_id := NEW.agent_id;
         ELSE
           v_sms_agent_id := NULL;
         END IF;

         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         VALUES (
           v_normalized_phone,
           COALESCE(v_sms_sender_id, 'Orderinfo'),
           v_message,
           'custom',
           'success',
           v_sms_agent_id
         );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
