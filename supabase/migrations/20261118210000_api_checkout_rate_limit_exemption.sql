-- ============================================================================================
-- API Partner Paystack Checkout: exempt customer-paid API checkout/collection orders from the
-- per-agent rapid order velocity guard. These orders are funded by the end customer's MoMo
-- payment (never the partner's wallet), so many customers checking out at once must not suspend
-- the partner account. Checkout velocity is enforced separately in developer-api
-- (30 checkouts/min per partner, 2 prompts/min per paying phone).
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.check_rapid_order_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count INT;
  v_user_id UUID;
BEGIN
  v_user_id := NEW.agent_id;

  -- Customer-paid API checkout / collection orders are rate limited in developer-api instead
  IF COALESCE(NEW.metadata->>'api_checkout', 'false') = 'true'
     AND COALESCE(NEW.payment_method, '') = 'paystack' THEN
    RETURN NEW;
  END IF;

  -- Skip anon guest orders with default zero UUID
  IF v_user_id IS NOT NULL AND v_user_id != '00000000-0000-0000-0000-000000000000' THEN
    SELECT COUNT(*) INTO v_recent_count
    FROM public.orders
    WHERE agent_id = v_user_id
      AND created_at >= (NOW() - INTERVAL '60 seconds')
      AND NOT (COALESCE(metadata->>'api_checkout', 'false') = 'true' AND COALESCE(payment_method, '') = 'paystack');

    IF v_recent_count >= 5 THEN
      UPDATE public.profiles
      SET is_suspended = true
      WHERE user_id = v_user_id;

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
