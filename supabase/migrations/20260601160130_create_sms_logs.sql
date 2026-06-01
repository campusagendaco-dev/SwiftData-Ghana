-- 20260601160130_create_sms_logs.sql
-- Creates the public.sms_logs table to track sent SMS messages
-- Secures table with RLS and adds to realtime publication

CREATE TABLE IF NOT EXISTS public.sms_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient TEXT NOT NULL,
    sender_id TEXT,
    body TEXT NOT NULL,
    type TEXT DEFAULT 'broadcast', -- 'broadcast', 'payment_success', 'order_failed', 'low_balance', etc.
    status TEXT DEFAULT 'success', -- 'success', 'failed'
    error_message TEXT,
    agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexing for high-performance searches and filtering
CREATE INDEX IF NOT EXISTS idx_sms_logs_recipient ON public.sms_logs (recipient);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON public.sms_logs (status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON public.sms_logs (created_at DESC);

-- Enable RLS
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

-- Allow read access for admins and service role
DROP POLICY IF EXISTS "admins_manage_sms_logs" ON public.sms_logs;
CREATE POLICY "admins_manage_sms_logs"
    ON public.sms_logs FOR SELECT
    USING (public.is_admin());

-- Allow full access for service role (insertion by Edge Functions)
DROP POLICY IF EXISTS "service_role_all_sms_logs" ON public.sms_logs;
CREATE POLICY "service_role_all_sms_logs"
    ON public.sms_logs FOR ALL
    USING (true)
    WITH CHECK (true);

-- Add to Realtime Publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sms_logs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_logs;
    END IF;
END $$;
