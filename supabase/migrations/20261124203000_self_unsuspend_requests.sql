-- Self-unsuspend requests (rebuilt safely 2026-11-24; replaces the never-applied
-- 20261124190000_self_unsuspend_otp_system.sql, which clashed with the receipt checker's
-- version and let users read their own code's hash).
--   route = 'self_release' : the system's own timed hold; a correct code lifts it early
--   route = 'admin_review' : anything else; an admin with 2FA decides once
-- Users can read only safe columns of their own requests (never the code digest). Only the
-- self-unsuspend function (service role) writes. Apply in the SQL editor (never db push),
-- then run supabase/tests/self_unsuspend_checks.sql (no error = passed).

CREATE TABLE IF NOT EXISTS public.account_unsuspend_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name          TEXT,
  phone              TEXT        NOT NULL,
  suspension_reason  TEXT        NOT NULL,
  route              TEXT,
  status             TEXT        NOT NULL DEFAULT 'otp_sent',
  otp_digest         TEXT,
  otp_expires_at     TIMESTAMPTZ,
  otp_verified_at    TIMESTAMPTZ,
  otp_attempts       INT         NOT NULL DEFAULT 0,
  admin_note         TEXT,
  reviewed_by        UUID        REFERENCES auth.users(id),
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade the earlier draft's table (it was applied in production on 2026-11-24).
ALTER TABLE public.account_unsuspend_requests ADD COLUMN IF NOT EXISTS route TEXT;
ALTER TABLE public.account_unsuspend_requests ADD COLUMN IF NOT EXISTS otp_digest TEXT;
-- No request from the draft may be used or approved under the new rules.
UPDATE public.account_unsuspend_requests
   SET status = CASE WHEN status IN ('otp_sent', 'pending_admin_approval') THEN 'expired' ELSE status END,
       route  = coalesce(route, 'admin_review')
 WHERE route IS NULL;
-- The draft's readable code hash and unused columns go.
ALTER TABLE public.account_unsuspend_requests DROP COLUMN IF EXISTS otp_hash;
ALTER TABLE public.account_unsuspend_requests DROP COLUMN IF EXISTS user_email;
ALTER TABLE public.account_unsuspend_requests DROP COLUMN IF EXISTS is_security_breach;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.account_unsuspend_requests'::regclass AND contype = 'c'
              AND (pg_get_constraintdef(oid) ILIKE '%status%' OR pg_get_constraintdef(oid) ILIKE '%route%') LOOP
    EXECUTE format('ALTER TABLE public.account_unsuspend_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.account_unsuspend_requests ALTER COLUMN route SET NOT NULL;
ALTER TABLE public.account_unsuspend_requests ADD CONSTRAINT account_unsuspend_requests_route_check
  CHECK (route IN ('self_release', 'admin_review'));
-- 'auto_unsuspended' is kept only as history from the draft.
ALTER TABLE public.account_unsuspend_requests ADD CONSTRAINT account_unsuspend_requests_status_check
  CHECK (status IN ('otp_sent', 'self_released', 'pending_admin_approval', 'approved', 'rejected', 'expired', 'auto_unsuspended'));

CREATE INDEX IF NOT EXISTS idx_unsuspend_req_user_created ON public.account_unsuspend_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unsuspend_req_status ON public.account_unsuspend_requests (status, created_at DESC);

ALTER TABLE public.account_unsuspend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own unsuspend requests" ON public.account_unsuspend_requests;
DROP POLICY IF EXISTS "Admins can manage unsuspend requests" ON public.account_unsuspend_requests;
DROP POLICY IF EXISTS "Users and admins read unsuspend requests" ON public.account_unsuspend_requests;
DROP POLICY IF EXISTS "Service role full access unsuspend requests" ON public.account_unsuspend_requests;

CREATE POLICY "Users and admins read unsuspend requests" ON public.account_unsuspend_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Service role full access unsuspend requests" ON public.account_unsuspend_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Column-level read access only; no writes for signed-in users.
REVOKE ALL ON public.account_unsuspend_requests FROM anon, authenticated;
GRANT SELECT (id, user_id, user_name, phone, suspension_reason, route, status, otp_expires_at, otp_verified_at, admin_note, reviewed_by, reviewed_at, created_at)
  ON public.account_unsuspend_requests TO authenticated;
GRANT ALL ON public.account_unsuspend_requests TO service_role;

-- Kept OUT of realtime: live updates can carry whole rows (including otp_digest) to anyone
-- allowed to see the row. The admin popup checks every 30 seconds instead.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.account_unsuspend_requests;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
