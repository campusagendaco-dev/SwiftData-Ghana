-- Migration: Harden API & RPC package price resolution and fallback logic
-- Target: api.create_order_rpc
-- Purpose: Prevent arbitrary price overrides (e.g. 0.10 for 40GB) by requiring strict package matching and restricting amount fallback exclusively to Airtime.

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
  v_norm_net TEXT;
  v_norm_size TEXT;
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

  -- 3. Normalize network name and package size for robust matching
  v_norm_net := UPPER(TRIM(COALESCE(p_network, '')));
  v_norm_size := REPLACE(UPPER(TRIM(COALESCE(p_package_size, ''))), ' ', '');

  -- 4. Get Package Info (Fuzzy/case/whitespace-insensitive matching)
  SELECT * INTO v_pkg_row
  FROM public.global_package_settings
  WHERE (
    network = p_network OR 
    UPPER(network) = v_norm_net OR
    (v_norm_net IN ('MTN', 'YELLO') AND UPPER(network) = 'MTN') OR
    (v_norm_net IN ('TELECEL', 'VODAFONE', 'RED', 'VOD') AND UPPER(network) = 'TELECEL') OR
    (v_norm_net IN ('AT', 'AIRTELTIGO', 'BLUE') AND UPPER(network) = 'AIRTELTIGO') OR
    (v_norm_net IN ('MASHUP', 'MTN MASH UP', 'MTN_MASH_UP') AND UPPER(network) = 'MTN MASH UP')
  )
  AND REPLACE(UPPER(package_size), ' ', '') = v_norm_size
  LIMIT 1;

  -- 5. Calculate Pricing
  IF v_pkg_row IS NOT NULL THEN
    IF v_pkg_row.is_unavailable THEN
      RAISE EXCEPTION 'Package is currently unavailable';
    END IF;
    
    v_cost_price := COALESCE(NULLIF(v_pkg_row.cost_price, 0), v_pkg_row.agent_price, 0);
    v_final_price := (v_custom_prices->p_network->>p_package_size)::NUMERIC;

    IF v_final_price IS NULL OR v_final_price <= 0 THEN
      v_final_price := (v_custom_prices->v_pkg_row.network->>v_pkg_row.package_size)::NUMERIC;
    END IF;

    IF v_final_price IS NULL OR v_final_price <= 0 THEN
      IF v_is_sub_agent AND v_parent_agent_id IS NOT NULL THEN
        DECLARE
          v_parent_prices JSONB;
        BEGIN
          SELECT api_custom_prices INTO v_parent_prices
          FROM public.profiles WHERE user_id = v_parent_agent_id;

          v_final_price := (v_parent_prices->p_network->>p_package_size)::NUMERIC;
          IF v_final_price IS NULL OR v_final_price <= 0 THEN
            v_final_price := (v_parent_prices->v_pkg_row.network->>v_pkg_row.package_size)::NUMERIC;
          END IF;

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
    -- 🚨 SECURITY FIX: Fallback to p_amount ONLY if order is explicitly Airtime
    IF v_norm_size = 'AIRTIME' OR v_norm_net = 'AIRTIME' THEN
      IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid airtime amount specified';
      END IF;
      v_final_price := p_amount;
      v_cost_price := p_amount * 0.95;
    ELSE
      RAISE EXCEPTION 'Package price could not be resolved for % %. Order rejected.', p_network, p_package_size;
    END IF;
  END IF;

  IF v_final_price IS NULL OR v_final_price <= 0 THEN
    RAISE EXCEPTION 'Pricing could not be determined for this order';
  END IF;

  -- Admin profit: what platform keeps after paying provider and parent commission
  v_admin_profit := GREATEST(0, v_final_price - v_cost_price - v_parent_profit);

  -- 6. Wallet Check & Debit
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
      RAISE EXCEPTION 'Insufficient API balance. Required: GHs %, please fund your API wallet.', v_final_price;
    END IF;
  END IF;

  -- 7. Create Order
  INSERT INTO public.orders (
    id, agent_id, order_type, customer_phone, network, package_size,
    amount, profit, status, cost_price, parent_agent_id, parent_profit, payment_method
  ) VALUES (
    v_order_id, p_user_id, 'api', p_phone, COALESCE(v_pkg_row.network, p_network), COALESCE(v_pkg_row.package_size, p_package_size),
    v_final_price, v_admin_profit, CASE WHEN p_test_mode THEN 'fulfilled' ELSE 'pending' END, v_cost_price, v_parent_agent_id, v_parent_profit, 'wallet'
  );

  -- 8. Credit parent referral commission
  IF NOT p_test_mode AND v_parent_profit > 0 AND v_parent_agent_id IS NOT NULL THEN
    PERFORM public.credit_order_profits(v_order_id::TEXT);
  END IF;

  -- 9. Prepare Response
  v_idem_response := jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'status', CASE WHEN p_test_mode THEN 'fulfilled' ELSE 'pending' END,
    'amount', v_final_price,
    'balance', v_wallet_balance,
    'test_mode', p_test_mode,
    'request_id', p_request_id
  );

  -- 10. Store Idempotency
  INSERT INTO public.idempotency_keys (user_id, key, response_body)
  VALUES (p_user_id, p_idem_key, v_idem_response);

  RETURN v_idem_response;
END;
$$;

-- Secure function: Lock execute permission to service_role only
DO $$
DECLARE
  r RECORD;
  fn_sig TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api' AND p.proname = 'create_order_rpc'
  LOOP
    fn_sig := 'api.' || r.proname || '(' || r.args || ')';
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', fn_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn_sig);
  END LOOP;
END $$;
