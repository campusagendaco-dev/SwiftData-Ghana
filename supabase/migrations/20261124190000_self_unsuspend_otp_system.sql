-- Self-Service OTP Unsuspend & Admin Security Breach Approval Queue

CREATE TABLE IF NOT EXISTS public.account_unsuspend_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name          TEXT,
  user_email         TEXT,
  phone              TEXT        NOT NULL,
  suspension_reason  TEXT        NOT NULL,
  is_security_breach BOOLEAN     NOT NULL DEFAULT false,
  otp_hash           TEXT,
  otp_expires_at     TIMESTAMPTZ,
  otp_verified_at    TIMESTAMPTZ,
  otp_attempts       INT         NOT NULL DEFAULT 0,
  status             TEXT        NOT NULL DEFAULT 'otp_sent'
    CHECK (status IN ('otp_sent', 'auto_unsuspended', 'pending_admin_approval', 'approved', 'rejected', 'expired')),
  admin_note         TEXT,
  reviewed_by        UUID        REFERENCES auth.users(id),
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_unsuspend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own unsuspend requests" ON public.account_unsuspend_requests;
CREATE POLICY "Users can view own unsuspend requests"
  ON public.account_unsuspend_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage unsuspend requests" ON public.account_unsuspend_requests;
CREATE POLICY "Admins can manage unsuspend requests"
  ON public.account_unsuspend_requests FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Service role full access unsuspend requests" ON public.account_unsuspend_requests;
CREATE POLICY "Service role full access unsuspend requests"
  ON public.account_unsuspend_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_unsuspend_req_user_created ON public.account_unsuspend_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unsuspend_req_status ON public.account_unsuspend_requests (status, created_at DESC);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.account_unsuspend_requests;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
