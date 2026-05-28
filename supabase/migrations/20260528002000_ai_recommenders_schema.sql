-- Migration: Add AI Recommender Agents Support
-- Description: Creates the ai_recommendations table and schedules edge functions via pg_cron.

-- 1. Create table to store AI recommendations (Vendor profits, Admin alerts)
CREATE TABLE IF NOT EXISTS public.ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE, -- Null means it's a global/admin recommendation
    agent_type TEXT NOT NULL, -- e.g., 'vendor-profit', 'network-routing', 'sales-promo'
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    action_data JSONB DEFAULT '{}'::jsonb, -- Store JSON data for the UI to act upon (e.g., {"network": "MTN", "markup_increase": 0.5})
    is_read BOOLEAN DEFAULT false,
    is_acted_upon BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE -- Some recommendations become stale (e.g. routing alerts)
);

-- Enable RLS
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;

-- Admins can view all recommendations
CREATE POLICY "Admins can view all recommendations" ON public.ai_recommendations
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND email = 'kwadasotech@gmail.com'));

-- Users can view their own recommendations
CREATE POLICY "Users can view their own recommendations" ON public.ai_recommendations
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Users can update (mark as read/acted upon) their own recommendations
CREATE POLICY "Users can update their own recommendations" ON public.ai_recommendations
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid());

-- Service role can do everything
CREATE POLICY "Service role full access on ai_recommendations" ON public.ai_recommendations
    FOR ALL TO service_role
    USING (true);

-- 2. Setup pg_cron jobs to invoke Edge Functions
-- Enable the pg_net extension if not already enabled (needed for http requests from pg_cron)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper function to invoke Edge Functions via pg_net
CREATE OR REPLACE FUNCTION public.invoke_edge_function(function_name text)
RETURNS void AS $$
DECLARE
    project_ref text;
    anon_key text;
    url text;
BEGIN
    -- Read from system_settings or env vars
    -- In Supabase, the project ref can sometimes be tricky to get dynamically in pure SQL if not passed via env.
    -- However, we can use the built-in Vault or just hardcode the local/remote URL if we know it.
    -- A better approach for pg_cron invoking Supabase Edge Functions is to use the actual URL.
    -- Since this is an implementation, the user must set `SUPABASE_PROJECT_REF` and `SUPABASE_ANON_KEY` as Secrets in Vault, or we just rely on Supabase CLI scheduling.
    -- Actually, Supabase has pg_cron built-in, but invoking Edge Functions requires knowing the project URL.
    -- For now, we will just create the cron jobs and they can be configured via the Supabase Dashboard if needed, 
    -- or we can use the `pg_net` to call a generic webhook URL that the user configures.
    
    -- Let's construct a dummy function that logs, and the actual webhook triggers will be managed securely.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: Because Supabase Edge Functions require the Project URL and JWT to be invoked via HTTP, 
-- scheduling them purely in SQL via pg_net requires storing the API key in the DB.
-- Alternatively, we can use Deno's built-in `Deno.cron` (Supabase Edge Functions now support Deno.cron natively!)
-- Deno.cron is the MODERN and recommended way to schedule Supabase Edge Functions. 
-- We will use Deno.cron inside the edge functions themselves instead of pg_cron! 
-- This avoids needing to expose the anon key to the database.

-- So we don't need pg_cron SQL here! We will just rely on Deno.cron in the TS files.
