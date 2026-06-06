-- Migration: Atomic profile metadata creation on user signup
-- Description: Updates handle_new_user trigger to parse metadata fields during insert to avoid post-signup client-side RLS updates.

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
    is_agent
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
    COALESCE((NEW.raw_user_meta_data ->> 'is_agent')::boolean, false)
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
