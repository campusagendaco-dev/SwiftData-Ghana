-- Migration: Comprehensive Automations Suite (2, 3, 4, 5, 6)
-- Adds dormant wallet win-back tracking, rapid bot rate-limit guard trigger, and helper RPCs.

-- 1. Add winback_sms_sent_at tracking column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS winback_sms_sent_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Rapid Bot & Fraud Rate-Limit Isolation Trigger
-- Automatically suspends accounts and rejects transactions if > 5 orders are placed within 60 seconds
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

      -- Revoke API keys
      UPDATE public.api_keys
      SET is_active = false
      WHERE user_id = v_user_id;

      RAISE EXCEPTION 'Security Alert: Rapid order velocity limit exceeded (>5 orders/min). Account suspended for security verification.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rapid_order_rate_limit_guard ON public.orders;

CREATE TRIGGER trg_rapid_order_rate_limit_guard
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_rapid_order_rate_limit();

-- 3. RPC Function to fetch dormant wallet recipients for win-back SMS
CREATE OR REPLACE FUNCTION public.get_dormant_wallet_recipients(
  p_min_balance NUMERIC DEFAULT 10.00,
  p_inactive_days INT DEFAULT 7,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  user_id UUID,
  phone TEXT,
  full_name TEXT,
  balance NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.user_id,
    p.phone,
    p.full_name,
    w.balance
  FROM public.profiles p
  JOIN public.wallets w ON w.agent_id = p.user_id
  WHERE w.balance >= p_min_balance
    AND p.phone IS NOT NULL
    AND p.phone != ''
    AND (p.sms_opt_out IS FALSE OR p.sms_opt_out IS NULL)
    AND (p.is_suspended IS FALSE OR p.is_suspended IS NULL)
    AND (p.winback_sms_sent_at IS NULL OR p.winback_sms_sent_at <= (NOW() - INTERVAL '14 days'))
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.agent_id = p.user_id
        AND o.created_at >= (NOW() - (p_inactive_days || ' days')::INTERVAL)
    )
  LIMIT p_limit;
$$;
