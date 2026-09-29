-- Fix Korba agent commissions rounding and robust Korba detection
CREATE OR REPLACE FUNCTION public.credit_order_profits(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 AS $$
DECLARE
    v_agent_id UUID;
    v_parent_agent_id UUID;
    v_profit NUMERIC;
    v_parent_profit NUMERIC;
    v_profit_credited BOOLEAN;
    v_parent_profit_credited BOOLEAN;
    v_status TEXT;
    v_order_type TEXT;
    v_network TEXT;
    v_amount NUMERIC;
    v_provider_id UUID;
    v_provider_handler TEXT;
    v_order_count INTEGER;
    v_commission NUMERIC := 0;
    v_is_korba BOOLEAN := false;
BEGIN
    -- Select and lock the order row
    SELECT 
        agent_id, parent_agent_id, profit, parent_profit, 
        profit_credited, parent_profit_credited, status,
        order_type, network, amount, provider_id,
        COALESCE((metadata->>'is_korba')::boolean, false) OR (UPPER(COALESCE(network, '')) LIKE 'KORBA%')
    INTO 
        v_agent_id, v_parent_agent_id, v_profit, v_parent_profit, 
        v_profit_credited, v_parent_profit_credited, v_status,
        v_order_type, v_network, v_amount, v_provider_id,
        v_is_korba
    FROM orders
    WHERE id = p_order_id::UUID
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    -- Only calculate/update commission if not already profit_credited
    IF NOT v_profit_credited AND v_agent_id IS NOT NULL AND v_agent_id <> '00000000-0000-0000-0000-000000000000'::UUID THEN
        -- 1. Count completed orders of this agent
        SELECT COUNT(id) INTO v_order_count
        FROM orders
        WHERE agent_id = v_agent_id
          AND status IN ('fulfilled', 'completed')
          AND id <> p_order_id::UUID;

        -- Get the handler_type of the provider
        IF v_provider_id IS NOT NULL THEN
            SELECT handler_type INTO v_provider_handler
            FROM providers
            WHERE id = v_provider_id;
        END IF;

        IF v_provider_handler = 'korba' THEN
            v_is_korba := true;
        END IF;

        -- 2. Determine commission based on rules:
        -- Airtime: 0.5% (or 0.7% if order count >= 100)
        -- Korba Data: 0.5% (or 0.7% if order count >= 100)
        -- ECG Utility: 0.1%
        IF v_order_type = 'airtime' THEN
            IF v_order_count >= 100 THEN
                v_commission := GREATEST(ROUND(v_amount * 0.007, 2), 0.01);
            ELSE
                v_commission := GREATEST(ROUND(v_amount * 0.005, 2), 0.01);
            END IF;
        ELSIF v_order_type = 'utility' AND (UPPER(v_network) LIKE '%ECG%' OR EXISTS (
            SELECT 1 FROM orders WHERE id = p_order_id::UUID AND (
                UPPER(COALESCE(utility_provider, '')) LIKE '%ECG%' OR 
                UPPER(COALESCE(utility_type, '')) LIKE '%ECG%'
            )
        )) THEN
            v_commission := GREATEST(ROUND(v_amount * 0.001, 2), 0.01);
        ELSIF v_order_type = 'data' AND v_is_korba THEN
            IF v_order_count >= 100 THEN
                v_commission := GREATEST(ROUND(v_amount * 0.007, 2), 0.01);
            ELSE
                v_commission := GREATEST(ROUND(v_amount * 0.005, 2), 0.01);
            END IF;
        END IF;

        -- Update v_profit to include the calculated commission
        IF v_commission > 0 THEN
            v_profit := COALESCE(v_profit, 0) + v_commission;
        END IF;
    END IF;

    -- 1. Credit Agent Profit
    IF COALESCE(v_profit, 0) > 0 AND v_agent_id IS NOT NULL AND v_agent_id <> '00000000-0000-0000-0000-000000000000'::UUID AND NOT v_profit_credited THEN
        UPDATE wallets SET balance = balance + v_profit WHERE agent_id = v_agent_id;
        v_profit_credited := TRUE;
    END IF;

    -- 2. Credit Parent Profit
    IF COALESCE(v_parent_profit, 0) > 0 AND v_parent_agent_id IS NOT NULL AND v_parent_agent_id <> '00000000-0000-0000-0000-000000000000'::UUID AND NOT v_parent_profit_credited THEN
        UPDATE wallets SET balance = balance + v_parent_profit WHERE agent_id = v_parent_agent_id;
        v_parent_profit_credited := TRUE;
    END IF;

    -- Update the order row with the calculated profit and flags
    UPDATE orders 
    SET 
        profit = COALESCE(v_profit, 0),
        profit_credited = v_profit_credited,
        parent_profit_credited = v_parent_profit_credited
    WHERE id = p_order_id::UUID;

    RETURN jsonb_build_object(
        'success', true, 
        'profit_credited', v_profit_credited, 
        'parent_profit_credited', v_parent_profit_credited,
        'calculated_profit', v_profit
    );
END;
$$;
