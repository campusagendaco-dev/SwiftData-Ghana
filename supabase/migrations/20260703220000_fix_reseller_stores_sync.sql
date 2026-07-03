-- Upgrades profiles to reseller_stores sync trigger to handle updates as well as inserts.
-- Updates any existing reseller_stores rows to ensure their slugs, names, and color settings are fully in sync with profiles.

CREATE OR REPLACE FUNCTION public.sync_profile_to_reseller_store()
RETURNS TRIGGER AS $$
DECLARE
  v_store_exists BOOLEAN;
BEGIN
  -- Check if a store already exists for this user_id
  SELECT EXISTS(
    SELECT 1 FROM public.reseller_stores 
    WHERE user_id = NEW.user_id
  ) INTO v_store_exists;

  IF (NEW.is_agent = true OR NEW.is_sub_agent = true) 
     AND NEW.store_name IS NOT NULL AND NEW.store_name <> '' 
     AND NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    
    IF v_store_exists THEN
      UPDATE public.reseller_stores
      SET store_name = NEW.store_name,
          slug = NEW.slug,
          store_logo_url = NEW.store_logo_url,
          store_primary_color = COALESCE(NEW.store_primary_color, '#fbbf24')
      WHERE user_id = NEW.user_id;
    ELSE
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sync existing profiles to reseller_stores
-- 1. Update existing rows in reseller_stores to match profiles
UPDATE public.reseller_stores s
SET store_name = p.store_name,
    slug = p.slug,
    store_logo_url = p.store_logo_url,
    store_primary_color = COALESCE(p.store_primary_color, '#fbbf24')
FROM public.profiles p
WHERE s.user_id = p.user_id
  AND (p.is_agent = true OR p.is_sub_agent = true)
  AND p.store_name IS NOT NULL AND p.store_name <> ''
  AND p.slug IS NOT NULL AND p.slug <> '';

-- 2. Insert missing rows into reseller_stores
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
    SELECT 1 FROM public.reseller_stores s WHERE s.user_id = p.user_id
  );
