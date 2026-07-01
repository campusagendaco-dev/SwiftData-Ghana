-- Create direct debit mandates table
CREATE TABLE IF NOT EXISTS public.direct_debit_mandates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    customer_number VARCHAR(15) NOT NULL,
    transaction_id VARCHAR(100) NOT NULL UNIQUE,
    mandate_id VARCHAR(100),
    amount NUMERIC(10,2) NOT NULL,
    frequency_type VARCHAR(20) NOT NULL CHECK (frequency_type IN ('Daily', 'Weekly', 'Monthly', 'Yearly')),
    frequency VARCHAR(10) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    debit_day VARCHAR(5) NOT NULL,
    description TEXT,
    payer_name TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pending_pre_approval', 'active', 'failed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Create direct debit transactions table
CREATE TABLE IF NOT EXISTS public.direct_debit_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    mandate_id UUID REFERENCES public.direct_debit_mandates(id) ON DELETE CASCADE,
    transaction_id VARCHAR(100) NOT NULL UNIQUE,
    amount NUMERIC(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('processing', 'success', 'failed')),
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- RLS Policies for mandates
ALTER TABLE public.direct_debit_mandates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own mandates" ON public.direct_debit_mandates;
CREATE POLICY "Users manage own mandates"
    ON public.direct_debit_mandates FOR ALL
    USING ((auth.uid())::text = (user_id)::text)
    WITH CHECK ((auth.uid())::text = (user_id)::text);

DROP POLICY IF EXISTS "Service role reads all mandates" ON public.direct_debit_mandates;
CREATE POLICY "Service role reads all mandates"
    ON public.direct_debit_mandates FOR SELECT
    USING (auth.role() = 'service_role');

-- RLS Policies for transactions
ALTER TABLE public.direct_debit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own mandate transactions" ON public.direct_debit_transactions;
CREATE POLICY "Users view own mandate transactions"
    ON public.direct_debit_transactions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.direct_debit_mandates m 
        WHERE m.id = direct_debit_transactions.mandate_id 
          AND (m.user_id)::text = (auth.uid())::text
    ));

DROP POLICY IF EXISTS "Service role manages all mandate transactions" ON public.direct_debit_transactions;
CREATE POLICY "Service role manages all mandate transactions"
    ON public.direct_debit_transactions FOR ALL
    USING (auth.role() = 'service_role');

-- Enable Realtime
alter publication supabase_realtime add table public.direct_debit_mandates;
alter publication supabase_realtime add table public.direct_debit_transactions;
