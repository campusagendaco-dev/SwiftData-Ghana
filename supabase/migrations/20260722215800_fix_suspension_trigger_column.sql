-- Migration: Fix column name in account suspension SMS trigger and clear suspended_until in admin bulk suspension RPCs
-- Description: Replaces invalid column 'support_number' with 'customer_service_number', removes invalid 'suspension_reason' field reference, and resets suspended_until = NULL when admins manually suspend users so the auto-unsuspend cron job does not release admin suspensions.

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

-- Ensure manual admin suspensions reset suspended_until to NULL so the 5-minute auto-unsuspend cron job does not override admin suspensions
CREATE OR REPLACE FUNCTION public.bulk_suspend_users(p_user_ids UUID[], p_suspend BOOLEAN)
RETURNS JSONB AS $$
BEGIN
    UPDATE public.profiles 
    SET is_suspended = p_suspend,
        suspended_until = NULL,
        updated_at = now()
    WHERE user_id = ANY(p_user_ids);

    RETURN jsonb_build_object('success', true, 'updated_count', array_length(p_user_ids, 1));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.bulk_suspend_users(UUID[], BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.toggle_user_suspension(p_user_id UUID, p_suspend BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles 
  SET is_suspended = p_suspend,
      suspended_until = NULL,
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_user_suspension(UUID, BOOLEAN) TO authenticated, service_role;
