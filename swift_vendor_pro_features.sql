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
CREATE POLICY "Users can view their own beneficiaries"
    ON public.swift_beneficiaries FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own beneficiaries"
    ON public.swift_beneficiaries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own beneficiaries"
    ON public.swift_beneficiaries FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own beneficiaries"
    ON public.swift_beneficiaries FOR DELETE
    USING (auth.uid() = user_id);

-- Create index for faster querying
CREATE INDEX IF NOT EXISTS swift_beneficiaries_user_id_idx ON public.swift_beneficiaries(user_id);
CREATE INDEX IF NOT EXISTS swift_beneficiaries_account_number_idx ON public.swift_beneficiaries(account_number);
