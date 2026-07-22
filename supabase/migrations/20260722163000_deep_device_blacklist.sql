-- Migration: Deep Device Blacklist and Fingerprinting
-- Description: Adds browser_fingerprint column to profiles, updates handle_new_user to capture it, and updates check_device_blocked to verify both device_id and browser_fingerprint, returning the blocked device ID for self-healing block sync.

-- 1. Add browser_fingerprint column to public.profiles if it doesn't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS browser_fingerprint TEXT;

-- 2. Create index on browser_fingerprint for lookups
CREATE INDEX IF NOT EXISTS profiles_browser_fingerprint_idx ON public.profiles(browser_fingerprint);

-- 3. Update check_device_blocked to support both device ID and browser fingerprint, returning TEXT instead of BOOLEAN
CREATE OR REPLACE FUNCTION public.check_device_blocked(
    p_device_id TEXT,
    p_browser_fingerprint TEXT DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
    v_blocked_device_id TEXT;
    v_within_limit BOOLEAN;
BEGIN
    IF (p_device_id IS NULL OR p_device_id = '') AND (p_browser_fingerprint IS NULL OR p_browser_fingerprint = '') THEN
        RETURN NULL;
    END IF;
    
    -- Rate limit check based on device_id (if provided)
    IF p_device_id IS NOT NULL AND p_device_id != '' THEN
        v_within_limit := public.check_generic_rate_limit(
            'device_block_check:' || p_device_id,
            15
        );
        IF NOT v_within_limit THEN
            RETURN NULL;
        END IF;
    END IF;

    -- Query to find a suspended profile's device_id matching either parameter
    SELECT COALESCE(device_id, p_device_id) INTO v_blocked_device_id
    FROM public.profiles 
    WHERE 
        ((device_id = p_device_id AND p_device_id IS NOT NULL AND p_device_id != '')
         OR 
         (browser_fingerprint = p_browser_fingerprint AND p_browser_fingerprint IS NOT NULL AND p_browser_fingerprint != ''))
        AND is_suspended = true
    LIMIT 1;
    
    RETURN v_blocked_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Update check_device_blocked function permissions
GRANT EXECUTE ON FUNCTION public.check_device_blocked(TEXT, TEXT) TO anon, authenticated;

-- 5. Update handle_new_user to insert browser_fingerprint from raw_user_meta_data
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;
  v_parent_id UUID;
BEGIN
  -- 1. Resolve referrer id from referral code metadata
  IF NEW.raw_user_meta_data ->> 'referral_code' IS NOT NULL AND (NEW.raw_user_meta_data ->> 'referral_code') <> '' THEN
    SELECT user_id INTO v_referrer_id 
    FROM public.profiles 
    WHERE referral_code = (NEW.raw_user_meta_data ->> 'referral_code');
  END IF;

  -- 2. Resolve parent agent id with safe uuid cast
  IF NEW.raw_user_meta_data ->> 'parent_agent_id' IS NOT NULL AND (NEW.raw_user_meta_data ->> 'parent_agent_id') <> '' THEN
    v_parent_id := (NEW.raw_user_meta_data ->> 'parent_agent_id')::uuid;
  END IF;

  -- 3. Insert user profile atomically
  INSERT INTO public.profiles (
    user_id, 
    full_name, 
    email,
    phone,
    whatsapp_number,
    store_name,
    slug,
    is_sub_agent,
    parent_agent_id,
    referred_by,
    is_agent,
    device_id,
    browser_fingerprint
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data ->> 'phone', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'phone', ''), -- default whatsapp to phone
    COALESCE(NEW.raw_user_meta_data ->> 'store_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'slug', NULL),
    COALESCE((NEW.raw_user_meta_data ->> 'is_sub_agent')::boolean, false),
    v_parent_id,
    v_referrer_id,
    COALESCE((NEW.raw_user_meta_data ->> 'is_agent')::boolean, false),
    COALESCE(NEW.raw_user_meta_data ->> 'device_id', NULL),
    COALESCE(NEW.raw_user_meta_data ->> 'browser_fingerprint', NULL)
  );

  -- 4. If referred, insert into referrals ledger
  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referee_id, credited, credit_amount, created_at)
    VALUES (v_referrer_id, NEW.id, false, 2.00, NOW())
    ON CONFLICT (referee_id) DO NOTHING;
  END IF;

  -- 5. Atomically insert native wallet for the new user
  INSERT INTO public.wallets (agent_id, balance, loyalty_balance, api_balance, created_at, updated_at)
  VALUES (NEW.id, 0.00, 0, 0.00, NOW(), NOW())
  ON CONFLICT (agent_id) DO NOTHING;

  RETURN NEW;
END;
$$;
