-- Migration: Disable unused API access and enforce Agent role for non-API resellers.
-- Description: 
-- 1. Sets api_access_enabled = false for all users who have never generated an API key.
-- 2. For users who are currently agents/sub-agents but have no API key, it demotes/retains them in the Agent role only.

-- 1. Handle resellers (agents/sub-agents) without API keys: disable API and demote to agent role only
UPDATE public.profiles
SET 
  api_access_enabled = false,
  is_agent = true,
  agent_approved = true,
  is_sub_agent = false,
  sub_agent_approved = false
WHERE 
  (is_agent = true OR is_sub_agent = true)
  AND (api_key_hash IS NULL OR TRIM(api_key_hash) = '')
  AND (api_key IS NULL OR TRIM(api_key) = '');

-- 2. Disable API access for regular customers who do not have an API key (without changing their roles)
UPDATE public.profiles
SET 
  api_access_enabled = false
WHERE 
  is_agent = false 
  AND is_sub_agent = false
  AND api_access_enabled = true
  AND (api_key_hash IS NULL OR TRIM(api_key_hash) = '')
  AND (api_key IS NULL OR TRIM(api_key) = '');
