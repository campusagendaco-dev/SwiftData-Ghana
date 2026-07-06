-- Migration: Fix agent onboarding completion flags and sync mismatched profiles.
-- Description:
-- 1. Resets onboarding_complete = false for any approved/activated agents who do not have a valid store name or slug.
-- 2. Synchronizes store name, slug, logo url, and color from reseller_stores to profiles to heal out-of-sync/mismatched records.

-- 1. Reset onboarding completion flag for agents with missing store details
UPDATE public.profiles
SET onboarding_complete = false
WHERE (is_agent = true OR is_sub_agent = true)
  AND (agent_approved = true OR sub_agent_approved = true)
  AND (store_name IS NULL OR store_name = '' OR slug IS NULL OR slug = '');

-- 2. Sync profiles metadata from reseller_stores to heal mismatches and ensure onboarding_complete is set
UPDATE public.profiles p
SET store_name = s.store_name,
    slug = s.slug,
    store_logo_url = s.store_logo_url,
    store_primary_color = s.store_primary_color,
    onboarding_complete = true
FROM public.reseller_stores s
WHERE p.user_id = s.user_id
  AND (p.is_agent = true OR p.is_sub_agent = true)
  AND (p.store_name IS NULL OR p.store_name = '' OR p.slug IS NULL OR p.slug = '' OR p.slug <> s.slug);
