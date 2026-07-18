-- Migration: AI Agents Dynamic Model Routing
-- Description: Adds active_model column to ai_agent_registry and sets default models for seeded agents.

ALTER TABLE public.ai_agent_registry ADD COLUMN IF NOT EXISTS active_model TEXT;

-- Seed default models for existing agents
UPDATE public.ai_agent_registry SET active_model = 'claude-haiku-4-5-20251001' WHERE name = 'sentinel_prime';
UPDATE public.ai_agent_registry SET active_model = 'claude-haiku-4-5-20251001' WHERE name = 'guardian_ai';
UPDATE public.ai_agent_registry SET active_model = 'claude-haiku-4-5-20251001' WHERE name = 'threat_hunter';
UPDATE public.ai_agent_registry SET active_model = 'claude-haiku-4-5-20251001' WHERE name = 'aml_scanner';
UPDATE public.ai_agent_registry SET active_model = 'claude-haiku-4-5-20251001' WHERE name = 'account_cloner';
UPDATE public.ai_agent_registry SET active_model = 'gemini-1.5-flash' WHERE name = 'sentinel_evolve';

-- Refresh publication to ensure model changes replicate instantly
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.ai_agent_registry;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_agent_registry;
