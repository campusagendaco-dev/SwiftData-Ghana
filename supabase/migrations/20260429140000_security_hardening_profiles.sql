-- SECURITY HARDENING: RESTRICT PUBLIC ACCESS TO SENSITIVE PROFILE DATA
-- This migration creates a restricted view for public agent stores and revokes direct table access for anonymous users.

-- 1. Create a restricted view for public store pages (excludes momo_number, etc.)
CREATE OR REPLACE VIEW public.agent_stores AS
SELECT 
    user_id,
    full_name,
    store_name,
    whatsapp_number,
    support_number,
    whatsapp_group_link,
    agent_prices,
    sub_agent_prices,
    disabled_packages,
    is_agent,
    is_sub_agent,
    agent_approved,
    sub_agent_approved,
    parent_agent_id,
    sub_agent_activation_markup,
    store_logo_url,
    store_primary_color,
    slug,
    email -- Kept for contact info, but momo_number is removed
FROM public.profiles
WHERE is_agent = true 
  AND onboarding_complete = true 
  AND (agent_approved = true OR sub_agent_approved = true);

-- 2. Drop the overly permissive public RLS policy
DROP POLICY IF EXISTS "Public can view agent store profiles" ON public.profiles;

-- 3. Grant access to the view
GRANT SELECT ON public.agent_stores TO anon, authenticated;

-- 4. Ensure RLS is still on for profiles (it should be)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
