-- SCHEDULED ORDERS: Allow users to automate their data/airtime purchases.

DO $$ BEGIN
  CREATE TYPE public.schedule_frequency AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.scheduled_orders (
    id UUID PRIMARY KEY DEFAULT crypto.random_uuid(),
    agent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recipient_phone TEXT NOT NULL,
    network TEXT NOT NULL,
    amount DECIMAL(12, 2),
    package_size TEXT,
    order_type TEXT NOT NULL, -- 'data' or 'airtime'
    frequency public.schedule_frequency NOT NULL,
    next_run TIMESTAMP WITH TIME ZONE NOT NULL,
    last_run TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for the processor
CREATE INDEX IF NOT EXISTS idx_scheduled_orders_next_run ON public.scheduled_orders(next_run) WHERE is_active = TRUE;

-- RLS
ALTER TABLE public.scheduled_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own schedules" ON public.scheduled_orders;
CREATE POLICY "Users can manage their own schedules"
    ON public.scheduled_orders
    FOR ALL
    USING (auth.uid() = agent_id);

-- Admin can view all
DROP POLICY IF EXISTS "Admins can view all schedules" ON public.scheduled_orders;
CREATE POLICY "Admins can view all schedules"
    ON public.scheduled_orders
    FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));

-- Function to update next_run after execution
CREATE OR REPLACE FUNCTION public.calculate_next_run(freq public.schedule_frequency, current_run TIMESTAMP WITH TIME ZONE)
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
    IF freq = 'daily' THEN
        RETURN current_run + INTERVAL '1 day';
    ELSIF freq = 'weekly' THEN
        RETURN current_run + INTERVAL '1 week';
    ELSIF freq = 'monthly' THEN
        RETURN current_run + INTERVAL '1 month';
    ELSE
        RETURN current_run + INTERVAL '1 day';
    END IF;
END;
$$ LANGUAGE plpgsql;
