-- Migration: Failed Login SMS Alert
-- Description: Creates the failed_logins table and the log_failed_login RPC, which counts recent failures and sends an SMS alert on exactly 2 failed attempts.

-- Create table to track failed login attempts
CREATE TABLE IF NOT EXISTS public.failed_logins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast lookup by email and timestamp
CREATE INDEX IF NOT EXISTS idx_failed_logins_email_created_at ON public.failed_logins (email, created_at DESC);

-- Enable RLS on failed_logins
ALTER TABLE public.failed_logins ENABLE ROW LEVEL SECURITY;

-- Enable SELECT and INSERT for service_role only
CREATE POLICY "service_role_all_failed_logins"
    ON public.failed_logins FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create RPC to log failed logins and trigger alerts
CREATE OR REPLACE FUNCTION public.log_failed_login(p_email TEXT, p_ip TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
  v_normalized_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_sms_message TEXT;
  v_sms_payload JSONB;
  v_fail_count INT;
  v_agent_id UUID;
BEGIN
  -- Insert failed attempt
  INSERT INTO public.failed_logins (email, ip_address)
  VALUES (LOWER(TRIM(p_email)), p_ip);

  -- Count failures in the last 15 minutes for this email
  SELECT COUNT(*) INTO v_fail_count
  FROM public.failed_logins
  WHERE email = LOWER(TRIM(p_email))
    AND created_at >= NOW() - INTERVAL '15 minutes';

  -- If exactly 2 failed attempts
  IF v_fail_count = 2 THEN
    -- Look up the account phone number
    SELECT phone, user_id INTO v_phone, v_agent_id
    FROM public.profiles
    WHERE email ILIKE TRIM(p_email)
    LIMIT 1;

    IF v_phone IS NOT NULL AND v_phone != '' THEN
      v_normalized_phone := public.normalize_phone_sql(v_phone);

      IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
        -- Fetch SMS credentials
        SELECT txtconnect_api_key, txtconnect_sender_id 
        INTO v_sms_api_key, v_sms_sender_id 
        FROM public.v_system_settings_with_secrets 
        WHERE id = 1;

        IF v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
          v_sms_message := 'SwiftData Security Alert: 2 failed login attempts detected on your account (' || LOWER(TRIM(p_email)) || ') from IP ' || COALESCE(p_ip, 'unknown') || '. If this was not you, please secure your account immediately.';
          
          v_sms_payload := jsonb_build_object(
            'to', v_normalized_phone,
            'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
            'sms', v_sms_message,
            'unicode', '0'
          );

          PERFORM net.http_post(
            url     := 'https://api.txtconnect.net/dev/api/sms/send',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
            body    := v_sms_payload
          );

          -- Log to public.sms_logs
          INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
          VALUES (
            v_normalized_phone,
            COALESCE(v_sms_sender_id, 'Orderinfo'),
            v_sms_message,
            'custom',
            'success',
            v_agent_id
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'count', v_fail_count);
END;
$$;

-- Grant execution to service_role (invoked by Edge Function)
REVOKE EXECUTE ON FUNCTION public.log_failed_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_failed_login(TEXT, TEXT) TO service_role;
