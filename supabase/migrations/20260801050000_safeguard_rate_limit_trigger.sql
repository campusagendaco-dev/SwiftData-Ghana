-- Safeguard rate limit function to avoid table name error if api_keys is not in public schema
CREATE OR REPLACE FUNCTION public.check_rapid_order_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recent_count INT;
  v_user_id UUID;
BEGIN
  v_user_id := NEW.agent_id;

  -- Skip anon guest orders with default zero UUID
  IF v_user_id IS NOT NULL AND v_user_id != '00000000-0000-0000-0000-000000000000' THEN
    SELECT COUNT(*) INTO v_recent_count
    FROM public.orders
    WHERE agent_id = v_user_id
      AND created_at >= (NOW() - INTERVAL '60 seconds');

    IF v_recent_count >= 5 THEN
      -- Suspend the abusive account immediately
      UPDATE public.profiles
      SET is_suspended = true
      WHERE user_id = v_user_id;

      -- Safely disable API keys if table exists
      BEGIN
        EXECUTE 'UPDATE public.api_keys SET is_active = false WHERE user_id = $1' USING v_user_id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      RAISE EXCEPTION 'Security Alert: Rapid order velocity limit exceeded (>5 orders/min). Account suspended for security verification.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
