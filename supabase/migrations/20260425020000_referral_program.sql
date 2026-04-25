-- Referral program
-- Each profile gets a unique referral_code; referrals table tracks who referred whom
-- and whether the first-purchase credit has been paid out.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL;

-- Auto-generate a short referral code for every existing profile that lacks one
UPDATE public.profiles
SET referral_code = LOWER(SUBSTRING(MD5(user_id::text || 'swiftref'), 1, 8))
WHERE referral_code IS NULL;

-- Ensure new profiles always get a code via trigger
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := LOWER(SUBSTRING(MD5(NEW.user_id::text || 'swiftref'), 1, 8));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_referral_code ON public.profiles;
CREATE TRIGGER trg_generate_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_referral_code();

-- Referrals ledger
CREATE TABLE IF NOT EXISTS public.referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  referee_id    UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  credited      BOOLEAN NOT NULL DEFAULT false,
  credit_amount NUMERIC(10,2) NOT NULL DEFAULT 2.00,  -- GHS 2 per successful referral
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credited_at   TIMESTAMPTZ,
  UNIQUE (referee_id)  -- each person can only be referred once
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Referrers can see their own referrals
CREATE POLICY "referrer_select" ON public.referrals
  FOR SELECT USING (referrer_id = auth.uid());

-- Service role can do everything (edge functions use service role)
CREATE POLICY "service_all" ON public.referrals
  FOR ALL USING (auth.role() = 'service_role');

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id);
