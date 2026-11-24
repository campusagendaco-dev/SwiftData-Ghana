-- Approved-Admin SMS OTP Verification (Alternative Second Factor to TOTP 2FA)
-- Strictly restricted to users in public.user_roles with role = 'admin' AND otp_login_approved = true.
-- Each verified OTP is cryptographically bound to the caller's exact JWT session_id (12h validity).

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS otp_login_approved BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.admin_otp_sessions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id     TEXT        NOT NULL,
  phone          TEXT        NOT NULL,
  otp_hash       TEXT,
  otp_expires_at TIMESTAMPTZ,
  otp_attempts   INT         NOT NULL DEFAULT 0,
  verified_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_otp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read own otp sessions" ON public.admin_otp_sessions;
CREATE POLICY "Admins read own otp sessions"
  ON public.admin_otp_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manage admin_otp_sessions" ON public.admin_otp_sessions;
CREATE POLICY "Service role manage admin_otp_sessions"
  ON public.admin_otp_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_admin_otp_sessions_lookup
  ON public.admin_otp_sessions (user_id, session_id, expires_at DESC);

-- Helper: true ONLY for an approved admin whose current JWT session_id completed SMS OTP
CREATE OR REPLACE FUNCTION public.has_valid_admin_otp_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.admin_otp_sessions s
      ON s.user_id = ur.user_id
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'admin'
      AND ur.otp_login_approved = true
      AND s.session_id = coalesce(auth.jwt() ->> 'session_id', '')
      AND s.session_id <> ''
      AND s.verified_at IS NOT NULL
      AND s.expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION public.has_valid_admin_otp_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_valid_admin_otp_session() TO authenticated, service_role;

-- Update public.is_admin() and public.has_role() to accept EITHER TOTP aal2 OR a valid approved-admin SMS OTP session
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  AND (
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    OR public.has_valid_admin_otp_session()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
  AND (
    _role <> 'admin'
    OR _user_id IS DISTINCT FROM auth.uid()
    OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    OR public.has_valid_admin_otp_session()
  );
$$;
