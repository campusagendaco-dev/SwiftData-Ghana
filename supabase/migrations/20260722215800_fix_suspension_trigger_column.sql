-- Migration: Fix column name and remove invalid field reference in account suspension SMS trigger function
-- Description: Replaces invalid column 'support_number' with 'customer_service_number' and removes reference to non-existent field 'suspension_reason' on profiles.

CREATE OR REPLACE FUNCTION public.handle_profile_suspension_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_support_number TEXT;
  v_normalized_phone TEXT;
  v_message TEXT;
  v_payload JSONB;
BEGIN
  -- Trigger when is_suspended changes from false/null to true
  IF NEW.is_suspended = true AND (OLD.is_suspended = false OR OLD.is_suspended IS NULL) THEN
    v_normalized_phone := public.normalize_phone_sql(NEW.phone);

    IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
      -- Fetch credentials and support phone number using valid column 'customer_service_number'
      SELECT txtconnect_api_key, txtconnect_sender_id, customer_service_number
      INTO v_sms_api_key, v_sms_sender_id, v_support_number
      FROM public.v_system_settings_with_secrets
      WHERE id = 1;

      -- Build dynamic compliance notification message
      v_message := format('SwiftData Notice: Your account has been suspended due to security compliance rules. To unsuspend your account ASAP, please contact support at %s. Thank you!',
        COALESCE(v_support_number, 'our support line')
      );

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

         -- Log to public.sms_logs
         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         VALUES (
           v_normalized_phone,
           COALESCE(v_sms_sender_id, 'Orderinfo'),
           v_message,
           'custom',
           'success',
           NEW.user_id
         );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
