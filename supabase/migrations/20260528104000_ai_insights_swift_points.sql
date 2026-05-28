-- 1. Add swift_points to wallets
ALTER TABLE public.wallets 
ADD COLUMN IF NOT EXISTS swift_points INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.wallets.swift_points IS 'Loyalty points earned by the agent. 1 point per GHS 1 spent.';

-- 2. Trigger to award points automatically
CREATE OR REPLACE FUNCTION public.trg_award_swift_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only award points when a new order is completed or an existing order changes to completed
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status != 'completed') THEN
    -- Make sure we don't reward wallet funding, and amount is valid
    IF NEW.order_type != 'wallet_fund' AND NEW.amount > 0 AND NEW.agent_id IS NOT NULL THEN
      UPDATE public.wallets 
      SET swift_points = swift_points + FLOOR(NEW.amount)::INTEGER
      WHERE agent_id = NEW.agent_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_swift_points_after_update ON public.orders;
CREATE TRIGGER trg_award_swift_points_after_update
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_award_swift_points();


-- 3. AI Churn Insights Engine (RPC)
CREATE OR REPLACE FUNCTION public.get_agent_churn_insights(p_agent_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH customer_stats AS (
    SELECT 
      customer_phone,
      network,
      COUNT(*) as total_orders,
      MAX(created_at) as last_purchase_date,
      MODE() WITHIN GROUP (ORDER BY package_size) as favorite_package
    FROM public.orders
    WHERE agent_id = p_agent_id 
      AND status = 'completed' 
      AND customer_phone IS NOT NULL
      AND customer_phone != ''
      AND customer_phone != 'N/A'
    GROUP BY customer_phone, network
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'phone', customer_phone,
      'network', network,
      'total_orders', total_orders,
      'last_purchase_date', last_purchase_date,
      'favorite_package', favorite_package,
      'days_since_last_purchase', EXTRACT(DAY FROM (now() - last_purchase_date))
    ) ORDER BY last_purchase_date ASC
  ), '[]'::jsonb) INTO v_result
  FROM customer_stats
  WHERE total_orders >= 2 
    AND last_purchase_date < now() - INTERVAL '7 days'
  LIMIT 5;

  RETURN v_result;
END;
$$;

-- 4. Redeem Points RPC
CREATE OR REPLACE FUNCTION public.redeem_swift_points(p_points INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_current_points INTEGER;
  v_cash_value NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized'); 
  END IF;
  
  IF p_points <= 0 OR p_points % 100 != 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Points must be redeemed in multiples of 100');
  END IF;

  SELECT swift_points INTO v_current_points FROM public.wallets WHERE agent_id = v_user_id FOR UPDATE;

  IF v_current_points IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_current_points < p_points THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient points');
  END IF;

  -- 100 points = GHS 1.00
  v_cash_value := (p_points / 100) * 1.00;

  UPDATE public.wallets 
  SET 
    swift_points = swift_points - p_points,
    balance = balance + v_cash_value,
    updated_at = now()
  WHERE agent_id = v_user_id;

  RETURN jsonb_build_object('success', true, 'redeemed_amount', v_cash_value, 'new_points', v_current_points - p_points);
END;
$$;
