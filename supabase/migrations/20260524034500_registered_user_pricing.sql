-- Migration: Add registered_user_prices to profiles table
-- This allows Master Agents to set a specific pricing tier for users who create an account on their store,
-- distinct from the public/guest pricing (agent_prices) and franchisee pricing (sub_agent_prices).

BEGIN;

-- Add the new column if it doesn't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS registered_user_prices JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Comment on column for schema documentation
COMMENT ON COLUMN public.profiles.registered_user_prices IS 'Prices charged to retail customers who have registered an account on the agent store.';

COMMIT;
