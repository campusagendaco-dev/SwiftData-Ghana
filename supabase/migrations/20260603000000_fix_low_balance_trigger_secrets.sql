-- Fix handle_api_wallet_balance_trigger to reference the secrets view
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
          'from', COALESCE(v_sms_sender_id, 'SwiftDataGh'),
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
