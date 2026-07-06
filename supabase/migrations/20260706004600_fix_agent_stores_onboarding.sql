-- 20260706004600_fix_agent_stores_onboarding.sql
-- Backfills onboarding_complete to true for all active agents/sub-agents.
-- Relaxes the agent_stores view to show stores for agents who have a configured store name even if onboarding_complete is false.

-- 1. Backfill onboarding_complete
UPDATE public.profiles
SET onboarding_complete = true
WHERE (is_agent = true OR is_sub_agent = true)
  AND slug IS NOT NULL 
  AND slug <> '';

-- 2. Redefine agent_stores view
DROP VIEW IF EXISTS public.agent_stores CASCADE;

CREATE OR REPLACE VIEW public.agent_stores AS
SELECT 
    p.user_id,
    p.full_name,
    s.store_name,
    p.whatsapp_number,
    p.support_number,
    p.whatsapp_group_link,
    p.agent_prices,
    p.sub_agent_prices,
    p.registered_user_prices,
    p.disabled_packages,
    p.is_agent,
    p.is_sub_agent,
    p.agent_approved,
    p.sub_agent_approved,
    p.parent_agent_id,
    p.sub_agent_activation_markup,
    s.store_logo_url,
    s.store_primary_color,
    s.slug,
    p.email,
    s.custom_domain
FROM public.reseller_stores s
LEFT JOIN public.profiles p ON s.user_id = p.user_id
WHERE (p.is_agent = true OR p.is_sub_agent = true)
  AND (p.onboarding_complete = true OR (p.store_name IS NOT NULL AND p.store_name <> ''));

GRANT SELECT ON public.agent_stores TO anon, authenticated;
