-- Migration: Add Swift Vendor Pro Features

-- 1. Add vendor_preferences to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_preferences JSONB DEFAULT '{}'::jsonb;

-- 2. Create swift_beneficiaries table
CREATE TABLE IF NOT EXISTS public.swift_beneficiaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    network_or_bank TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('momo', 'bank', 'africa')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    usage_count INTEGER DEFAULT 1
);

-- Enable RLS
ALTER TABLE public.swift_beneficiaries ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Users can view their own beneficiaries" ON public.swift_beneficiaries;
CREATE POLICY "Users can view their own beneficiaries"
    ON public.swift_beneficiaries FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own beneficiaries" ON public.swift_beneficiaries;
CREATE POLICY "Users can insert their own beneficiaries"
    ON public.swift_beneficiaries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own beneficiaries" ON public.swift_beneficiaries;
CREATE POLICY "Users can update their own beneficiaries"
    ON public.swift_beneficiaries FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own beneficiaries" ON public.swift_beneficiaries;
CREATE POLICY "Users can delete their own beneficiaries"
    ON public.swift_beneficiaries FOR DELETE
    USING (auth.uid() = user_id);

-- Create index for faster querying
CREATE INDEX IF NOT EXISTS swift_beneficiaries_user_id_idx ON public.swift_beneficiaries(user_id);
CREATE INDEX IF NOT EXISTS swift_beneficiaries_account_number_idx ON public.swift_beneficiaries(account_number);

-- 3. Master Agent Franchising RPCs
CREATE OR REPLACE FUNCTION public.get_sub_agents_status(p_master_id UUID)
RETURNS TABLE (
    user_id UUID,
    full_name TEXT,
    momo_number TEXT,
    wallet_balance NUMERIC,
    total_sales_today NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.user_id,
        p.full_name,
        p.momo_number,
        COALESCE(w.balance, 0) AS wallet_balance,
        COALESCE((
            SELECT SUM(amount)
            FROM public.orders o
            WHERE o.agent_id = p.user_id 
              AND DATE(o.created_at) = CURRENT_DATE
              AND o.status = 'fulfilled'
        ), 0) AS total_sales_today
    FROM public.profiles p
    LEFT JOIN public.wallets w ON w.agent_id = p.user_id
    WHERE p.parent_agent_id = p_master_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.transfer_float_to_subagent(p_master_id UUID, p_sub_id UUID, p_amount NUMERIC)
RETURNS JSONB AS $$
DECLARE
    v_master_balance NUMERIC;
    v_is_valid_sub BOOLEAN;
BEGIN
    IF p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
    END IF;

    -- Verify sub-agent belongs to master
    SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE user_id = p_sub_id AND parent_agent_id = p_master_id
    ) INTO v_is_valid_sub;

    IF NOT v_is_valid_sub THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid sub-agent');
    END IF;

    -- Check master balance
    SELECT balance INTO v_master_balance FROM public.wallets WHERE agent_id = p_master_id FOR UPDATE;
    
    IF v_master_balance IS NULL OR v_master_balance < p_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient master float balance');
    END IF;

    -- Debit Master
    UPDATE public.wallets SET balance = balance - p_amount WHERE agent_id = p_master_id;
    
    -- Credit Sub-agent
    UPDATE public.wallets SET balance = balance + p_amount WHERE agent_id = p_sub_id;

    -- Log transaction
    INSERT INTO public.orders (agent_id, parent_agent_id, order_type, amount, status, metadata)
    VALUES (p_sub_id, p_master_id, 'float_bridge', p_amount, 'fulfilled', jsonb_build_object('description', 'Float bridge from master agent'));

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
