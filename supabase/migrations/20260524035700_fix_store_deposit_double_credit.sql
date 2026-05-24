-- Fix double-crediting bug in fulfill_store_wallet_topup
-- If a Master Agent logs into their own store and makes a deposit (where customer_id = agent_id),
-- the previous function credited the wallet twice. We now conditionally credit the agent wallet
-- only if the customer is not the agent themselves.

CREATE OR REPLACE FUNCTION public.fulfill_store_wallet_topup(
  p_order_id UUID,
  p_customer_id UUID,
  p_agent_id UUID,
  p_amount NUMERIC(12, 2)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_exists BOOLEAN;
  v_agent_exists BOOLEAN;
BEGIN
  -- 1. Verify customer profile exists
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id = p_customer_id) INTO v_customer_exists;
  -- 2. Verify agent profile exists
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id = p_agent_id) INTO v_agent_exists;

  IF NOT v_customer_exists OR NOT v_agent_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer or Agent profile not found.');
  END IF;

  -- 3. Ensure agent wallet exists
  IF NOT EXISTS(SELECT 1 FROM public.wallets WHERE agent_id = p_agent_id) THEN
    INSERT INTO public.wallets (agent_id, balance) VALUES (p_agent_id, 0);
  END IF;

  -- 4. Credit the customer's local store balance (in their wallet)
  INSERT INTO public.wallets (agent_id, balance)
  VALUES (p_customer_id, p_amount)
  ON CONFLICT (agent_id)
  DO UPDATE SET balance = public.wallets.balance + p_amount;

  -- 5. Credit the agent's platform wallet
  -- Prevent double-crediting if the agent is testing their own store (customer = agent)
  IF p_customer_id != p_agent_id THEN
    UPDATE public.wallets 
    SET balance = COALESCE(balance, 0) + p_amount 
    WHERE agent_id = p_agent_id;
  END IF;

  -- 6. Mark the top-up order as fulfilled
  UPDATE public.orders 
  SET status = 'fulfilled', failure_reason = NULL 
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
