-- Migration: Auto-creating wallet RPCs and hardening error handling
CREATE OR REPLACE FUNCTION public.debit_wallet(p_agent_id UUID, p_amount NUMERIC)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_balance NUMERIC;
    current_limit NUMERIC;
BEGIN
    IF p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'Amount must be greater than zero');
    END IF;

    SELECT balance, COALESCE(credit_limit, 0) INTO current_balance, current_limit 
    FROM wallets 
    WHERE agent_id = p_agent_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO wallets (agent_id, balance, loyalty_balance, api_balance, created_at, updated_at)
        VALUES (p_agent_id, 0.00, 0, 0.00, NOW(), NOW())
        ON CONFLICT (agent_id) DO NOTHING;

        RETURN json_build_object(
            'success', false, 
            'error', 'Insufficient wallet balance',
            'balance', 0.00,
            'credit_limit', 0.00
        );
    END IF;

    IF (current_balance - p_amount) < (-current_limit) THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Insufficient wallet balance',
            'balance', current_balance,
            'credit_limit', current_limit
        );
    END IF;

    UPDATE wallets 
    SET balance = balance - p_amount,
        updated_at = NOW()
    WHERE agent_id = p_agent_id;

    RETURN json_build_object('success', true, 'new_balance', current_balance - p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_wallet(p_agent_id UUID, p_amount NUMERIC)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_balance NUMERIC;
BEGIN
    IF p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'Amount must be greater than zero');
    END IF;

    SELECT balance INTO current_balance 
    FROM wallets 
    WHERE agent_id = p_agent_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO wallets (agent_id, balance, loyalty_balance, api_balance, created_at, updated_at)
        VALUES (p_agent_id, p_amount, 0, 0.00, NOW(), NOW())
        ON CONFLICT (agent_id) DO UPDATE
        SET balance = wallets.balance + EXCLUDED.balance,
            updated_at = NOW();

        RETURN json_build_object('success', true, 'new_balance', p_amount);
    END IF;

    UPDATE wallets 
    SET balance = balance + p_amount,
        updated_at = NOW()
    WHERE agent_id = p_agent_id;

    RETURN json_build_object('success', true, 'new_balance', current_balance + p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_wallet(UUID, NUMERIC) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, NUMERIC) TO service_role;
