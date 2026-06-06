-- Recreate public.agent_stores view to expose p.registered_user_prices
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
    p.registered_user_prices, -- Added to view
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
  AND p.onboarding_complete = true;

GRANT SELECT ON public.agent_stores TO anon, authenticated;
