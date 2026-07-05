-- Migration: Demote API users with zero or negative API wallet balance.
-- Description: Disables API access and sets/retains Agent-only role for resellers whose api_balance is <= 0.

-- Disable triggers on profiles table
ALTER TABLE public.profiles DISABLE TRIGGER USER;

-- 1. Demote resellers (agents/sub-agents) with api_balance <= 0 to agent-only and disable API
UPDATE public.profiles p
SET 
  api_access_enabled = false,
  is_agent = true,
  agent_approved = true,
  is_sub_agent = false,
  sub_agent_approved = false
FROM public.wallets w
WHERE p.user_id = w.agent_id
  AND p.api_access_enabled = true
  AND (p.is_agent = true OR p.is_sub_agent = true)
  AND w.api_balance <= 0;

-- 2. Disable API access for regular customers with api_balance <= 0 (without promoting them to agent)
UPDATE public.profiles p
SET 
  api_access_enabled = false
FROM public.wallets w
WHERE p.user_id = w.agent_id
  AND p.api_access_enabled = true
  AND p.is_agent = false 
  AND p.is_sub_agent = false
  AND w.api_balance <= 0;

-- Re-enable triggers on profiles table
ALTER TABLE public.profiles ENABLE TRIGGER USER;
