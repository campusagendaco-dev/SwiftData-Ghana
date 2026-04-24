-- Add branding columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS store_logo_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS store_primary_color TEXT DEFAULT '#fbbf24';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS store_banner_url TEXT;

-- Create saved_customers table for the Address Book feature
CREATE TABLE IF NOT EXISTS saved_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    network TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on saved_customers
ALTER TABLE saved_customers ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Agents can only manage their own saved customers
CREATE POLICY "Agents can manage their own saved customers"
    ON saved_customers
    FOR ALL
    USING (auth.uid() = agent_id)
    WITH CHECK (auth.uid() = agent_id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_saved_customers_agent_id ON saved_customers(agent_id);
