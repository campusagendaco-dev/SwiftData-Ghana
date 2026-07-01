-- Migration: Fix API Users Profit Wallet Crediting & Reclaim Past Incorrect Credits
-- Target: public.credit_order_profits (skip direct agent credit for API orders) and past balances

CREATE OR REPLACE FUNCTION public.credit_order_profits(p_order_id TEXT)
RETURNS JSONB AS $$
DECLARE
    v_agent_id UUID;
    v_parent_agent_id UUID;
    v_profit NUMERIC;
    v_parent_profit NUMERIC;
    v_profit_credited BOOLEAN;
    v_parent_profit_credited BOOLEAN;
    v_status TEXT;
    v_order_type TEXT;
    v_order_uuid UUID;
    v_res JSON;
BEGIN
    -- Safely cast to UUID
    BEGIN
        v_order_uuid := p_order_id::UUID;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid order ID format');
    END;

    -- Select and lock the order row to prevent race conditions
    SELECT 
        agent_id, parent_agent_id, profit, parent_profit, 
        profit_credited, parent_profit_credited, status, order_type
    INTO 
        v_agent_id, v_parent_agent_id, v_profit, v_parent_profit, 
        v_profit_credited, v_parent_profit_credited, v_status, v_order_type
    FROM public.orders
    WHERE id = v_order_uuid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    -- 1. Credit Agent Profit using public.credit_wallet (SKIP for API orders)
    IF v_profit > 0 AND v_agent_id IS NOT NULL AND NOT COALESCE(v_profit_credited, FALSE) THEN
        IF COALESCE(v_order_type, '') = 'api' THEN
            -- API orders: do not credit the agent (orders.profit is platform profit)
            v_profit_credited := TRUE;
        ELSE
            v_res := public.credit_wallet(v_agent_id, v_profit);
            IF (v_res->>'success')::BOOLEAN THEN
                v_profit_credited := TRUE;
                
                -- Log the transaction
                INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
                VALUES (
                    'info', 'system', 'agent.profit.credited',
                    format('Credited agent GHS %s profit for order %s', v_profit, p_order_id),
                    v_order_uuid, v_agent_id,
                    jsonb_build_object('profit', v_profit)
                );
            ELSE
                -- Log failure but do not crash the order transaction
                INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
                VALUES (
                    'error', 'system', 'agent.profit.failed',
                    format('Failed to credit agent profit: %s', v_res->>'error'),
                    v_order_uuid, v_agent_id,
                    v_res::JSONB
                );
            END IF;
        END IF;
    ELSIF COALESCE(v_order_type, '') = 'api' THEN
        v_profit_credited := TRUE;
    END IF;

    -- 2. Credit Parent Profit using public.credit_wallet
    IF v_parent_profit > 0 AND v_parent_agent_id IS NOT NULL AND NOT COALESCE(v_parent_profit_credited, FALSE) THEN
        v_res := public.credit_wallet(v_parent_agent_id, v_parent_profit);
        IF (v_res->>'success')::BOOLEAN THEN
            v_parent_profit_credited := TRUE;

            -- Log the transaction
            INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
            VALUES (
                'info', 'system', 'parent.profit.credited',
                format('Credited parent agent GHS %s profit for order %s', v_parent_profit, p_order_id),
                v_order_uuid, v_parent_agent_id,
                jsonb_build_object('parent_profit', v_parent_profit)
            );
        ELSE
            -- Log failure but do not crash the order transaction
            INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
            VALUES (
                'error', 'system', 'parent.profit.failed',
                format('Failed to credit parent profit: %s', v_res->>'error'),
                v_order_uuid, v_parent_agent_id,
                v_res::JSONB
            );
        END IF;
    END IF;

    -- Update the order row with credit status flags
    UPDATE public.orders 
    SET 
        profit_credited = COALESCE(v_profit_credited, FALSE),
        parent_profit_credited = COALESCE(v_parent_profit_credited, FALSE),
        updated_at = NOW()
    WHERE id = v_order_uuid;

    RETURN jsonb_build_object(
        'success', true, 
        'profit_credited', COALESCE(v_profit_credited, FALSE), 
        'parent_profit_credited', COALESCE(v_parent_profit_credited, FALSE)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Secure the function permissions
REVOKE EXECUTE ON FUNCTION public.credit_order_profits(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_order_profits(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.credit_order_profits(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.credit_order_profits(TEXT) TO service_role;

-- 3. Clean up/reclaim incorrect agent profit credits from wallets for past API orders
-- Temporarily drop the balance guard constraint to allow balance adjustments for spent profits
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_balance_guard;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT id, agent_id, profit 
        FROM public.orders 
        WHERE order_type = 'api' AND profit_credited = TRUE AND profit > 0 AND status = 'fulfilled'
    LOOP
        -- Deduct from agent's main wallet balance
        UPDATE public.wallets 
        SET balance = balance - r.profit,
            updated_at = NOW()
        WHERE agent_id = r.agent_id;
        
        -- Log the reclamation
        INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
        VALUES (
            'warning', 'system', 'agent.profit.reclaimed',
            format('Reclaimed GHS %s incorrect API agent profit credit for order %s', r.profit, r.id),
            r.id, r.agent_id,
            jsonb_build_object('profit_reclaimed', r.profit)
        );
    END LOOP;
END $$;

-- Re-enable the balance guard constraint as NOT VALID so historical negative balances are tolerated
ALTER TABLE public.wallets 
  ADD CONSTRAINT wallets_balance_guard 
  CHECK (balance >= -COALESCE(credit_limit, 0)) NOT VALID;
