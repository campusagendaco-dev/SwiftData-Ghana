-- Add Secondary Provider Settings to system_settings
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS secondary_data_provider_api_key TEXT;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS secondary_data_provider_base_url TEXT;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS auto_failover_enabled BOOLEAN DEFAULT FALSE;

-- Add Credit Limit (Overdraft) to wallets
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(12,2) DEFAULT 0.00;

-- Update the debit_wallet RPC to handle credit limits (overdraft)
CREATE OR REPLACE FUNCTION public.debit_wallet(p_agent_id UUID, p_amount DECIMAL)
RETURNS JSON AS $$
DECLARE
    current_balance DECIMAL;
    current_limit DECIMAL;
BEGIN
    -- Get current balance and credit limit with a row lock
    SELECT balance, credit_limit INTO current_balance, current_limit 
    FROM public.wallets 
    WHERE agent_id = p_agent_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Wallet not found');
    END IF;

    -- Check if balance - amount is still above the negative credit limit
    -- Example: Balance 10, Limit 50. Can spend up to 60. Min balance allowed: -50.
    IF (current_balance - p_amount) < (-current_limit) THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Insufficient balance',
            'balance', current_balance,
            'credit_limit', current_limit
        );
    END IF;

    -- Update balance
    UPDATE public.wallets 
    SET balance = balance - p_amount,
        updated_at = NOW()
    WHERE agent_id = p_agent_id;

    RETURN json_build_object(
        'success', true, 
        'new_balance', (current_balance - p_amount)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
