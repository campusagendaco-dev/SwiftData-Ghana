-- Migration: 20261024090000_lock_credit_order_profits.sql
-- SECURITY FIX:
--   1. credit_order_profits was executable by `anon` and `authenticated`, so anyone
--      could call it over the REST API.
--   2. It never checked order status, so profit could be paid on pending / failed
--      orders that were never delivered.
-- All legitimate callers (edge functions using service_role, and the
-- tr_on_order_fulfilled_credit_profit trigger) only call it after the order is
-- marked 'fulfilled', so this guard does not block any valid payout.

CREATE OR REPLACE FUNCTION public.credit_order_profits(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
 AS $$
DECLARE
    v_agent_id UUID;
    v_parent_agent_id UUID;
    v_profit NUMERIC;
    v_parent_profit NUMERIC;
    v_profit_credited BOOLEAN;
    v_parent_profit_credited BOOLEAN;
    v_status TEXT;
BEGIN
    -- Select and lock the order row
    SELECT
        agent_id, parent_agent_id, profit, parent_profit,
        COALESCE(profit_credited, false), COALESCE(parent_profit_credited, false), status
    INTO
        v_agent_id, v_parent_agent_id, v_profit, v_parent_profit,
        v_profit_credited, v_parent_profit_credited, v_status
    FROM orders
    WHERE id = p_order_id::UUID
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    -- Only delivered orders may pay out profit.
    IF v_status IS DISTINCT FROM 'fulfilled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order is not fulfilled', 'status', v_status);
    END IF;

    -- Commissions for Airtime and Korba purchases remain removed (unchanged behaviour).

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

-- Only the backend (service_role) may call this. The fulfillment trigger runs as
-- SECURITY DEFINER and is unaffected.
REVOKE EXECUTE ON FUNCTION public.credit_order_profits(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_order_profits(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.credit_order_profits(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.credit_order_profits(text) TO service_role;
