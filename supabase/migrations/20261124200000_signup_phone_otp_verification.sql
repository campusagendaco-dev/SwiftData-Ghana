-- Signup Phone Number SMS OTP Verification

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.signup_phone_otps (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone              TEXT        NOT NULL,
  otp_hash           TEXT        NOT NULL,
  verification_token TEXT,
  otp_expires_at     TIMESTAMPTZ NOT NULL,
  otp_attempts       INT         NOT NULL DEFAULT 0,
  verified_at        TIMESTAMPTZ,
  ip_address         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.signup_phone_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access signup_phone_otps" ON public.signup_phone_otps;
CREATE POLICY "Service role full access signup_phone_otps"
  ON public.signup_phone_otps FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_signup_phone_otps_phone_created
  ON public.signup_phone_otps (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_phone_otps_ip_created
  ON public.signup_phone_otps (ip_address, created_at DESC);
