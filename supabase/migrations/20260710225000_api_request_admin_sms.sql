-- Migration: Notify Admin via SMS on API Request
-- Description: Updates the public.handle_api_request_status_trigger function to also notify the admin team and configured customer support line via SMS when a user requests API access.

CREATE OR REPLACE FUNCTION public.handle_api_request_status_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_support_number TEXT;
  v_normalized_phone TEXT;
  v_admin_phones TEXT;
  v_message TEXT;
  v_admin_message TEXT;
  v_payload JSONB;
  v_admin_payload JSONB;
BEGIN
  -- Trigger only when api_request_status changes to 'pending'
  IF NEW.api_request_status = 'pending' AND (OLD.api_request_status IS NULL OR OLD.api_request_status != 'pending') THEN
    
    -- Identify and normalize user phone number
    v_normalized_phone := public.normalize_phone_sql(NEW.phone);

    -- Get configured SMS credentials and support number from settings
    SELECT 
      txtconnect_api_key, 
      txtconnect_sender_id,
      COALESCE(customer_service_number, '0540309637')
    INTO v_sms_api_key, v_sms_sender_id, v_support_number
    FROM public.v_system_settings_with_secrets
    WHERE id = 1;

    -- Build user message
    v_message := 'Hello! Your request for API access has been received. Please submit your website URL to our support team on ' || v_support_number || ' to get approved. Thank you!';

    -- Build admin notification message
    v_admin_message := 'Alert: User ' || COALESCE(NEW.full_name, 'Customer') || ' (' || COALESCE(NEW.phone, '') || ') has requested API access. Please review and approve.';

    IF v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN

      -- 1. Dispatch SMS to user
      IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
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

         -- Log user SMS to public.sms_logs
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

      -- 2. Dispatch SMS to Admins
      WITH admin_phones AS (
        SELECT public.normalize_phone_sql(phone) as ph
        FROM public.profiles p
        JOIN public.user_roles ur ON p.user_id = ur.user_id
        WHERE ur.role = 'admin' AND p.phone IS NOT NULL AND p.phone != ''
        UNION
        SELECT public.normalize_phone_sql(v_support_number) as ph
      )
      SELECT COALESCE(string_agg(ph, ','), '') INTO v_admin_phones
      FROM admin_phones
      WHERE ph IS NOT NULL AND ph != '';

      IF v_admin_phones IS NOT NULL AND v_admin_phones != '' THEN
         v_admin_payload := jsonb_build_object(
           'to', v_admin_phones,
           'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
           'sms', v_admin_message,
           'unicode', '0'
         );

         PERFORM net.http_post(
           url     := 'https://api.txtconnect.net/dev/api/sms/send',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
           body    := v_admin_payload
         );

         -- Log admin SMS to public.sms_logs (associated with admin recipient log entry)
         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         SELECT 
           val,
           COALESCE(v_sms_sender_id, 'Orderinfo'),
           v_admin_message,
           'custom',
           'success',
           NEW.user_id
         FROM regexp_split_to_table(v_admin_phones, ',') val;
      END IF;

    END IF;
  END IF;

  RETURN NEW;
END;
$$;
