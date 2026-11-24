-- MoMo receipt checker for support staff (verify-momo-receipt).
--   momo_receiving_accounts: SwiftData's own MoMo numbers. A receipt only passes when the
--                            money went to one of these.
--   momo_receipt_checks:     every check, so a reused transaction ID is spotted, and a
--                            transaction ID can be ACCEPTED only once (unique index below).
-- Admins who completed 2FA (is_admin()) can read both and manage the numbers; checks are
-- written only by the function. Accepting a receipt credits nothing.
-- Apply by pasting into the Supabase SQL editor (never db push), then run
-- supabase/tests/momo_receipt_checks.sql (no error = passed).

CREATE TABLE IF NOT EXISTS public.momo_receiving_accounts (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         TEXT        NOT NULL UNIQUE CHECK (phone ~ '^233[0-9]{9}$'),
  account_name  TEXT,
  network       TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_by    UUID        REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.momo_receipt_checks (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  checked_by      UUID         REFERENCES auth.users(id),
  order_id        UUID,
  transaction_id  TEXT,
  amount          NUMERIC(14,2),
  recipient_phone TEXT,
  verdict         TEXT         NOT NULL CHECK (verdict IN ('no_red_flags', 'flagged')),
  risk_level      TEXT         NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  flags           JSONB        NOT NULL DEFAULT '[]'::jsonb,
  extracted       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  ai_model        TEXT,
  decision        TEXT         CHECK (decision IN ('accepted', 'rejected')),
  decided_by      UUID         REFERENCES auth.users(id),
  decided_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_momo_receipt_checks_tx ON public.momo_receipt_checks (transaction_id);
CREATE INDEX IF NOT EXISTS idx_momo_receipt_checks_by_time ON public.momo_receipt_checks (checked_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_momo_receipt_checks_created ON public.momo_receipt_checks (created_at DESC);
-- One accepted receipt per transaction ID, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS uq_momo_receipt_checks_accepted_tx
  ON public.momo_receipt_checks (transaction_id) WHERE decision = 'accepted' AND transaction_id IS NOT NULL;

ALTER TABLE public.momo_receiving_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.momo_receipt_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage momo_receiving_accounts" ON public.momo_receiving_accounts;
DROP POLICY IF EXISTS "Service role full access momo_receiving_accounts" ON public.momo_receiving_accounts;
DROP POLICY IF EXISTS "Admins read momo_receipt_checks" ON public.momo_receipt_checks;
DROP POLICY IF EXISTS "Service role full access momo_receipt_checks" ON public.momo_receipt_checks;

CREATE POLICY "Admins manage momo_receiving_accounts" ON public.momo_receiving_accounts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Service role full access momo_receiving_accounts" ON public.momo_receiving_accounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Admins read momo_receipt_checks" ON public.momo_receipt_checks FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "Service role full access momo_receipt_checks" ON public.momo_receipt_checks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.momo_receipt_checks FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.momo_receipt_checks FROM authenticated;
GRANT SELECT ON public.momo_receipt_checks TO authenticated;
REVOKE ALL ON public.momo_receiving_accounts FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.momo_receiving_accounts TO authenticated;
