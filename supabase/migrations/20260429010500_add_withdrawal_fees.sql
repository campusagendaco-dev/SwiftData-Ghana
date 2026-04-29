-- Add fee and net_amount columns to withdrawals table
ALTER TABLE public.withdrawals 
ADD COLUMN IF NOT EXISTS fee NUMERIC(12, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12, 2) DEFAULT 0;

-- Update existing withdrawals to set net_amount = amount (as they had 0 fee previously)
UPDATE public.withdrawals SET net_amount = amount WHERE net_amount = 0;

-- Update request_withdrawal RPC to calculate and store fee
DROP FUNCTION IF EXISTS public.request_withdrawal(UUID, NUMERIC);
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_agent_id UUID, p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_profit NUMERIC;
    v_total_withdrawn NUMERIC;
    v_wallet_balance NUMERIC;
    v_available_to_withdraw NUMERIC;
    v_withdrawal_id UUID;
    v_fee NUMERIC;
    v_net_amount NUMERIC;
BEGIN
    -- 1. Calculate Lifetime Profit (from own orders + parent profit from sub-agents)
    SELECT COALESCE(SUM(profit), 0) INTO v_total_profit 
    FROM public.orders 
    WHERE agent_id = p_agent_id AND status = 'fulfilled';

    SELECT v_total_profit + COALESCE(SUM(parent_profit), 0) INTO v_total_profit
    FROM public.orders
    WHERE parent_agent_id = p_agent_id AND status = 'fulfilled';

    -- 2. Calculate Total Requested/Withdrawn
    SELECT COALESCE(SUM(amount), 0) INTO v_total_withdrawn
    FROM public.withdrawals
    WHERE agent_id = p_agent_id AND status IN ('pending', 'completed', 'processing');

    -- 3. Get Liquid Wallet Balance
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE agent_id = p_agent_id;

    -- 4. Available to withdraw is the LEAST of (Theoretical Profit Balance) and (Liquid Wallet Balance)
    v_available_to_withdraw := LEAST(v_total_profit - v_total_withdrawn, v_wallet_balance);

    IF p_amount > v_available_to_withdraw THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient balance',
            'available', v_available_to_withdraw
        );
    END IF;

    -- 5. Calculate Fee (1.5%)
    v_fee := ROUND(p_amount * 0.015, 2);
    v_net_amount := p_amount - v_fee;

    -- 6. Insert Withdrawal
    INSERT INTO public.withdrawals (agent_id, amount, fee, net_amount, status)
    VALUES (p_agent_id, p_amount, v_fee, v_net_amount, 'pending')
    RETURNING id INTO v_withdrawal_id;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'fee', v_fee,
        'net_amount', v_net_amount
    );
END;
$$;
