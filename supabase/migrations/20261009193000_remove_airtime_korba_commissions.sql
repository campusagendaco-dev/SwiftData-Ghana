-- Migration: 20261009193000_remove_airtime_korba_commissions.sql
-- Silently remove 0.5% - 0.7% commissions on airtime and Korba purchases for agents

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

    -- Commissions for Airtime and Korba purchases have been removed.
    -- v_commission remains 0. Only predefined reseller profit on data packages & parent agent margins are credited.

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

GRANT EXECUTE ON FUNCTION public.credit_order_profits(text) TO authenticated, service_role, anon;
