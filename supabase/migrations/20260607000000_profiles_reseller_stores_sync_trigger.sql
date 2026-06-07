-- Migration: Create a sync trigger to ensure profiles table updates populate reseller_stores automatically.
-- Description: Creates a trigger function to keep profiles and reseller_stores in sync when onboarding is completed.

CREATE OR REPLACE FUNCTION public.sync_profile_to_reseller_store()
RETURNS TRIGGER AS $$
DECLARE
  v_store_exists BOOLEAN;
BEGIN
  -- Check if a store already exists for this user_id or slug to prevent duplicate key violations
  SELECT EXISTS(
    SELECT 1 FROM public.reseller_stores 
    WHERE user_id = NEW.user_id OR slug = NEW.slug
  ) INTO v_store_exists;

  IF (NEW.is_agent = true OR NEW.is_sub_agent = true) 
     AND NEW.store_name IS NOT NULL AND NEW.store_name <> '' 
     AND NEW.slug IS NOT NULL AND NEW.slug <> '' 
     AND NOT v_store_exists THEN
    
    INSERT INTO public.reseller_stores (
      user_id, 
      store_name, 
      slug, 
      store_logo_url, 
      store_primary_color
    )
    VALUES (
      NEW.user_id, 
      NEW.store_name, 
      NEW.slug, 
      NEW.store_logo_url, 
      COALESCE(NEW.store_primary_color, '#fbbf24')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on profiles table
DROP TRIGGER IF EXISTS trigger_sync_profile_to_reseller_store ON public.profiles;
CREATE TRIGGER trigger_sync_profile_to_reseller_store
AFTER INSERT OR UPDATE OF is_agent, is_sub_agent, store_name, slug ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_to_reseller_store();

-- Backfill any missing reseller_stores for existing onboarded agents/sub-agents
INSERT INTO public.reseller_stores (
  user_id, 
  store_name, 
  slug, 
  store_logo_url, 
  store_primary_color
)
SELECT 
  p.user_id, 
  p.store_name, 
  p.slug, 
  p.store_logo_url, 
  COALESCE(p.store_primary_color, '#fbbf24')
FROM public.profiles p
WHERE (p.is_agent = true OR p.is_sub_agent = true)
  AND p.store_name IS NOT NULL AND p.store_name <> ''
  AND p.slug IS NOT NULL AND p.slug <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.reseller_stores s 
    WHERE s.user_id = p.user_id OR s.slug = p.slug
  )
ON CONFLICT (slug) DO NOTHING;
