-- Migration: Fix API Wallet Deduction and Refund Logic
-- Corrects api.create_order_rpc to check/debit api_balance instead of balance.
-- Updates public.refund_failed_order to credit api_balance for API orders.

CREATE OR REPLACE FUNCTION api.create_order_rpc(
  p_user_id UUID,
  p_network TEXT,
  p_package_size TEXT,
  p_phone TEXT,
  p_amount NUMERIC,
  p_request_id TEXT,
  p_idem_key TEXT,
  p_test_mode BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_wallet_balance NUMERIC;
  v_cost_price NUMERIC;
  v_agent_price NUMERIC;
  v_final_price NUMERIC;
  v_parent_agent_id UUID;
  v_parent_profit NUMERIC := 0;
  v_order_id UUID := gen_random_uuid();
  v_custom_prices JSONB;
  v_is_sub_agent BOOLEAN;
  v_pkg_row RECORD;
  v_idem_response JSONB;
  v_admin_profit NUMERIC;
BEGIN
  -- 1. Check Idempotency
  SELECT response_body INTO v_idem_response
  FROM public.idempotency_keys
  WHERE user_id = p_user_id AND key = p_idem_key;

  IF v_idem_response IS NOT NULL THEN
    RETURN v_idem_response || jsonb_build_object('idempotent_replayed', true);
  END IF;

  -- 2. Get Profile Info
  SELECT api_custom_prices, is_sub_agent, parent_agent_id
  INTO v_custom_prices, v_is_sub_agent, v_parent_agent_id
  FROM public.profiles WHERE user_id = p_user_id;

  -- 3. Get Package Info
  SELECT * INTO v_pkg_row
  FROM public.global_package_settings
  WHERE network = p_network AND package_size = p_package_size;

  -- 4. Calculate Pricing
  IF v_pkg_row IS NOT NULL THEN
    IF v_pkg_row.is_unavailable THEN
      RAISE EXCEPTION 'Package is currently unavailable';
    END IF;
    
    v_cost_price := COALESCE(v_pkg_row.cost_price, v_pkg_row.agent_price, 0);
    v_final_price := (v_custom_prices->p_network->>p_package_size)::NUMERIC;

    IF v_final_price IS NULL OR v_final_price <= 0 THEN
      IF v_is_sub_agent AND v_parent_agent_id IS NOT NULL THEN
        DECLARE
          v_parent_prices JSONB;
        BEGIN
          SELECT api_custom_prices INTO v_parent_prices
          FROM public.profiles WHERE user_id = v_parent_agent_id;

          v_final_price := (v_parent_prices->p_network->>p_package_size)::NUMERIC;

          IF v_final_price IS NULL OR v_final_price <= 0 THEN
            v_final_price := COALESCE(v_pkg_row.api_price, v_pkg_row.agent_price);
          END IF;

          -- Parent profit: difference between sub-agent price and admin wholesale
          v_parent_profit := GREATEST(0, v_final_price - v_pkg_row.agent_price);
        END;
      ELSE
        v_final_price := COALESCE(v_pkg_row.api_price, v_pkg_row.agent_price);
      END IF;
    END IF;
  ELSE
    -- Default/Airtime pricing
    v_final_price := p_amount;
    v_cost_price := p_amount * 0.95; -- Dummy cost
  END IF;

  IF v_final_price IS NULL OR v_final_price <= 0 THEN
    RAISE EXCEPTION 'Pricing could not be determined';
  END IF;

  -- Admin profit: what platform keeps after paying provider and parent commission
  v_admin_profit := GREATEST(0, v_final_price - v_cost_price - v_parent_profit);

  -- 5. Wallet Check & Debit
  IF p_test_mode THEN
    SELECT api_balance INTO v_wallet_balance FROM public.wallets WHERE agent_id = p_user_id;
    IF v_wallet_balance IS NULL THEN v_wallet_balance := 0; END IF;
  ELSE
    UPDATE public.wallets
    SET api_balance = api_balance - v_final_price,
        updated_at = now()
    WHERE agent_id = p_user_id AND api_balance >= v_final_price
    RETURNING api_balance INTO v_wallet_balance;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient API balance. Please fund your API wallet.';
    END IF;
  END IF;

  -- 6. Create Order
  INSERT INTO public.orders (
    id, agent_id, order_type, customer_phone, network, package_size,
    amount, profit, status, cost_price, parent_agent_id, parent_profit, payment_method
  ) VALUES (
    v_order_id, p_user_id, 'api', p_phone, p_network, p_package_size,
    v_final_price, v_admin_profit, CASE WHEN p_test_mode THEN 'fulfilled' ELSE 'pending' END, v_cost_price, v_parent_agent_id, v_parent_profit, 'wallet'
  );

  -- 7. Credit parent referral commission (INSERT goes directly to fulfilled — no UPDATE trigger fires)
  IF NOT p_test_mode AND v_parent_profit > 0 AND v_parent_agent_id IS NOT NULL THEN
    PERFORM public.credit_order_profits(v_order_id::TEXT);
  END IF;

  -- 8. Prepare Response
  v_idem_response := jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'status', CASE WHEN p_test_mode THEN 'fulfilled' ELSE 'pending' END,
    'amount', v_final_price,
    'balance', v_wallet_balance,
    'test_mode', p_test_mode,
    'request_id', p_request_id
  );

  -- 9. Store Idempotency
  INSERT INTO public.idempotency_keys (user_id, key, response_body)
  VALUES (p_user_id, p_idem_key, v_idem_response);

  RETURN v_idem_response;
END;
$$;


CREATE OR REPLACE FUNCTION public.refund_failed_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_order.auto_refunded THEN RETURN false; END IF;  -- idempotent
  IF COALESCE(v_order.payment_method, 'wallet') NOT IN ('wallet', 'balance') THEN RETURN false; END IF;
  IF v_order.amount <= 0 THEN RETURN false; END IF;

  -- Refund wallet
  IF v_order.order_type = 'api' THEN
    PERFORM api.credit_api_wallet(v_order.agent_id, v_order.amount);
  ELSE
    PERFORM public.credit_wallet(p_agent_id := v_order.agent_id, p_amount := v_order.amount);
  END IF;

  -- Mark order as refunded
  UPDATE public.orders SET
    auto_refunded  = true,
    refunded_at    = now(),
    refund_amount  = v_order.amount,
    refund_reason  = 'Auto-refund: order fulfillment failed',
    updated_at     = now()
  WHERE id = p_order_id;

  RETURN true;
END;
$$;
