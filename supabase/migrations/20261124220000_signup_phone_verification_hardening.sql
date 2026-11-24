-- Signup phone verification hardening (2026-11-24).
-- Tokens are claimed once, by the signed-in user, so profiles.phone_verified is set only on
-- the server (verify-signup-phone-otp claim_token). Users can't set phone_verified themselves.
-- Apply in the SQL editor (never db push), then run
-- supabase/tests/signup_phone_checks.sql (no error = passed).

ALTER TABLE public.signup_phone_otps ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE public.signup_phone_otps ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_signup_phone_otps_token ON public.signup_phone_otps (verification_token) WHERE verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signup_phone_otps_created ON public.signup_phone_otps (created_at DESC);
REVOKE ALL ON public.signup_phone_otps FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_profiles_phone_verified ON public.profiles (phone) WHERE phone_verified = true;

-- Only the server may mark a phone verified: a user editing their own profile can't set it.
CREATE OR REPLACE FUNCTION public.guard_phone_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.phone_verified := false;
    ELSIF NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
       OR (OLD.phone_verified AND NEW.phone IS DISTINCT FROM OLD.phone) THEN
      -- changing the flag, or changing a verified phone, resets it until verified again
      NEW.phone_verified := CASE WHEN NEW.phone IS DISTINCT FROM OLD.phone THEN false ELSE OLD.phone_verified END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_phone_verified ON public.profiles;
CREATE TRIGGER trg_guard_phone_verified
  BEFORE INSERT OR UPDATE OF phone, phone_verified ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_phone_verified();
