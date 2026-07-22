-- Migration: Suspension Reason SMS Customization
-- Description: Adds a suspension_reason column to profiles, updates log_security_violation to save it, and customizes the account suspension SMS trigger to explain the specific reason and include the support contact.

-- 1. Add suspension_reason column to public.profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS suspension_reason TEXT DEFAULT NULL;

-- 2. Update log_security_violation to save the reason
CREATE OR REPLACE FUNCTION public.log_security_violation(
    p_user_id UUID,
    p_reason TEXT,
    p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_count INTEGER;
    v_suspended_until TIMESTAMP WITH TIME ZONE;
    v_is_suspended BOOLEAN := FALSE;
    v_email TEXT;
    v_full_name TEXT;
BEGIN
    -- Get user email and name for log
    SELECT email, full_name INTO v_email, v_full_name
    FROM public.profiles WHERE user_id = p_user_id;

    -- 1. Insert violation record
    INSERT INTO public.security_violations (user_id, reason, details)
    VALUES (p_user_id, p_reason, p_details);

    -- 2. Increment count and determine suspension
    UPDATE public.profiles
    SET security_violation_count = security_violation_count + 1
    WHERE user_id = p_user_id
    RETURNING security_violation_count INTO v_new_count;

    IF v_new_count = 1 THEN
        -- 1st Strike: 12-Hour Suspension
        v_suspended_until := now() + interval '12 hours';
        v_is_suspended := TRUE;
    ELSIF v_new_count = 2 THEN
        -- 2nd Strike: 24-Hour Suspension
        v_suspended_until := now() + interval '24 hours';
        v_is_suspended := TRUE;
    ELSE
        -- 3rd Strike+: Permanent Suspension
        v_suspended_until := NULL;
        v_is_suspended := TRUE;
    END IF;

    -- 3. Apply suspension and store the reason
    UPDATE public.profiles
    SET is_suspended = v_is_suspended,
        suspended_until = v_suspended_until,
        suspension_reason = p_reason,
        updated_at = now()
    WHERE user_id = p_user_id;

    -- 4. Log to system_logs
    INSERT INTO public.system_logs (ts, level, source, event, agent_id, message, data)
    VALUES (
        now(),
        'warn',
        'security-guard',
        'user.security_violation',
        p_user_id,
        format('Security violation logged for %s (%s). Strike %s. Action: %s.', 
            COALESCE(v_full_name, 'Unknown'), 
            COALESCE(v_email, 'unknown@email.com'), 
            v_new_count,
            CASE 
                WHEN v_suspended_until IS NOT NULL THEN 'Suspended until ' || v_suspended_until::text
                ELSE 'Permanently suspended'
            END
        ),
        jsonb_build_object(
            'violation_reason', p_reason,
            'violation_details', p_details,
            'strike_count', v_new_count,
            'suspended_until', v_suspended_until
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'strike_count', v_new_count,
        'suspended_until', v_suspended_until,
        'is_suspended', v_is_suspended
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_security_violation(UUID, TEXT, JSONB) TO service_role;

-- 3. Update the handle_profile_suspension_trigger function to incorporate the reason and support number
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
      -- Fetch credentials and support phone number
      SELECT txtconnect_api_key, txtconnect_sender_id, customer_service_number
      INTO v_sms_api_key, v_sms_sender_id, v_support_number
      FROM public.v_system_settings_with_secrets
      WHERE id = 1;

      -- Build dynamic message incorporating the specific reason
      IF NEW.suspension_reason IS NOT NULL AND NEW.suspension_reason != '' THEN
        v_message := format('SwiftData Notice: Your account has been suspended due to: %s. To resolve this and unsuspend your account, please contact support at %s. Thank you!',
          NEW.suspension_reason,
          COALESCE(v_support_number, 'our support line')
        );
      ELSE
        v_message := format('SwiftData Notice: Your account has been suspended due to security compliance rules. To unsuspend your account ASAP, please contact support at %s. Thank you!',
          COALESCE(v_support_number, 'our support line')
        );
      END IF;

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
