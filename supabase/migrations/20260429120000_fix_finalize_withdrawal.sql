-- Fix finalize_withdrawal to always allow admin confirmation.
-- The wallet balance check at REQUEST time is the correct gate.
-- Blocking confirmation because the agent later spent their balance
-- prevents legitimate admin actions and causes the 400 error.

CREATE OR REPLACE FUNCTION public.finalize_withdrawal(p_withdrawal_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_agent_id UUID;
    v_amount   NUMERIC;
    v_status   TEXT;
    v_new_bal  NUMERIC;
BEGIN
    -- Lock the withdrawal row
    SELECT agent_id, amount, status
    INTO v_agent_id, v_amount, v_status
    FROM public.withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not found');
    END IF;

    IF v_status NOT IN ('pending', 'processing') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Withdrawal is already ' || v_status);
    END IF;

    -- Deduct from wallet (allow negative — request-time check already validated funds)
    UPDATE public.wallets
    SET balance = balance - v_amount
    WHERE agent_id = v_agent_id
    RETURNING balance INTO v_new_bal;

    -- Mark withdrawal completed
    UPDATE public.withdrawals
    SET status = 'completed', completed_at = now()
    WHERE id = p_withdrawal_id;

    -- Audit trail
    INSERT INTO public.orders (agent_id, order_type, amount, profit, status, failure_reason)
    VALUES (v_agent_id, 'withdrawal', v_amount, 0, 'fulfilled', 'Cash withdrawal confirmed');

    RETURN jsonb_build_object('success', true, 'new_balance', COALESCE(v_new_bal, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.finalize_withdrawal(UUID) TO service_role;
