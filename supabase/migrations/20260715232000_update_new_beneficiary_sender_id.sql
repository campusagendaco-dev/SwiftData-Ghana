-- Migration: Update New Beneficiary Warning SMS Sender ID
-- Description: Changes the sender ID from 'swiftupdate' to 'SwiftDataGh' for beneficiary bypass notification SMS.

CREATE OR REPLACE FUNCTION public.handle_new_beneficiary_order_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
  v_sms_api_key TEXT;
  v_whatsapp_link TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
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
           'from', 'SwiftDataGh', -- Changed sender ID to 'SwiftDataGh'
           'sms', v_message,
           'unicode', '0'
         );

         PERFORM net.http_post(
           url     := 'https://api.txtconnect.net/dev/api/sms/send',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
           body    := v_payload
         );

         -- Log SMS log
         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         VALUES (
           v_normalized_phone,
           'SwiftDataGh', -- Changed sender ID to 'SwiftDataGh'
           v_message,
           'custom',
           'success',
           NEW.agent_id
         );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
