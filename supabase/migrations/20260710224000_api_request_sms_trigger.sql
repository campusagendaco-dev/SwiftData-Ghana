-- Migration: API Request SMS Notification Trigger
-- Description: Sends an SMS to the user when they request API access, prompting them to submit their site URL to the support team for approval.

CREATE OR REPLACE FUNCTION public.handle_api_request_status_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_support_number TEXT;
  v_normalized_phone TEXT;
  v_message TEXT;
  v_payload JSONB;
BEGIN
  -- Trigger only when api_request_status changes to 'pending'
  IF NEW.api_request_status = 'pending' AND (OLD.api_request_status IS NULL OR OLD.api_request_status != 'pending') THEN
    
    -- Identify and normalize user phone number
    v_normalized_phone := public.normalize_phone_sql(NEW.phone);

    IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
      -- Get configured SMS credentials and support number from settings
      SELECT 
        txtconnect_api_key, 
        txtconnect_sender_id,
        COALESCE(customer_service_number, '0540309637')
      INTO v_sms_api_key, v_sms_sender_id, v_support_number
      FROM public.v_system_settings_with_secrets
      WHERE id = 1;

      -- Build notification text
      v_message := 'Hello! Your request for API access has been received. Please submit your website URL to our support team on ' || v_support_number || ' to get approved. Thank you!';

      -- Dispatch SMS via pg_net if API key is set
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

-- Create trigger on public.profiles table
DROP TRIGGER IF EXISTS trg_api_request_status_sms ON public.profiles;
CREATE TRIGGER trg_api_request_status_sms
  AFTER UPDATE OF api_request_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_api_request_status_trigger();
