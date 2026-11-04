-- ═══════════════════════════════════════════════════════════════════════════
-- Wallet Phase 3: verification (check, never auto-correct) + top-up cap.
--
-- verify_wallet_ledger(): read-only. For every wallet and account, the stored
-- balance must equal the sum of its ledger entries; every ledger hash must
-- recompute and link to the previous entry; and recent unlabelled movements
-- are counted. Results go to wallet_reconciliation_runs and admins are
-- notified when anything is wrong. It never changes a balance.
--
-- Top-up cap: wallet/store top-up orders above wallet_controls.max_topup_amount
-- are rejected at insert time (admin credits excepted), which also stops the
-- junk "GH₵ millions" top-up orders seen in the audit.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wallet_reconciliation_runs (
  id bigserial PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('ledger', 'paystack')),
  ok boolean NOT NULL,
  wallets_checked int,
  balance_mismatches int,
  chain_breaks int,
  unattributed_24h int,
  issues int,
  details jsonb
);
CREATE INDEX IF NOT EXISTS wallet_reconciliation_runs_idx ON public.wallet_reconciliation_runs (kind, run_at DESC);
ALTER TABLE public.wallet_reconciliation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read reconciliation runs" ON public.wallet_reconciliation_runs;
CREATE POLICY "Admins read reconciliation runs" ON public.wallet_reconciliation_runs FOR SELECT TO authenticated USING (public.is_admin());
REVOKE INSERT, UPDATE, DELETE ON public.wallet_reconciliation_runs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_admins(p_title text, p_message text, p_link text DEFAULT '/admin/wallet-ledger')
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.user_notifications (user_id, title, message, type, link, data)
  SELECT DISTINCT ur.user_id, p_title, p_message, 'warning', p_link, jsonb_build_object('type', 'wallet_reconciliation')
  FROM public.user_roles ur WHERE ur.role::text = 'admin';
$$;
REVOKE ALL ON FUNCTION public.notify_admins(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_wallet_ledger()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallets int;
  v_mismatch jsonb;
  v_mismatch_n int;
  v_breaks jsonb;
  v_breaks_n int;
  v_unattr int;
  v_ok boolean;
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'verify_wallet_ledger: admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_wallets FROM public.wallets;

  WITH sums AS (
    SELECT agent_id, account, sum(amount) AS total FROM public.wallet_ledger GROUP BY 1, 2
  ), cur AS (
    SELECT agent_id, 'main'::text AS account, round(coalesce(balance, 0), 2) AS bal FROM public.wallets
    UNION ALL SELECT agent_id, 'api', round(coalesce(api_balance, 0), 2) FROM public.wallets
    UNION ALL SELECT agent_id, 'loyalty', round(coalesce(loyalty_balance, 0), 2) FROM public.wallets
  ), diff AS (
    SELECT c.agent_id, c.account, c.bal, coalesce(s.total, 0) AS ledger
    FROM cur c LEFT JOIN sums s USING (agent_id, account)
    WHERE abs(c.bal - coalesce(s.total, 0)) >= 0.01
  )
  SELECT count(*), coalesce(jsonb_agg(jsonb_build_object('agent_id', agent_id, 'account', account, 'balance', bal, 'ledger', ledger)) FILTER (WHERE rn <= 50), '[]'::jsonb)
    INTO v_mismatch_n, v_mismatch
    FROM (SELECT *, row_number() OVER () rn FROM diff) d;

  WITH l AS (
    SELECT id, agent_id, hash, prev_hash,
           lag(hash) OVER (PARTITION BY agent_id ORDER BY id) AS expected_prev,
           public.wallet_ledger_hash(prev_hash, agent_id, account, amount, balance_before, balance_after,
                                     reason, reference_type, reference_id, created_at) AS recomputed
    FROM public.wallet_ledger
  ), bad AS (
    SELECT id, agent_id FROM l
    WHERE hash <> recomputed OR prev_hash IS DISTINCT FROM expected_prev
  )
  SELECT count(*), coalesce(jsonb_agg(jsonb_build_object('ledger_id', id, 'agent_id', agent_id)) FILTER (WHERE rn <= 50), '[]'::jsonb)
    INTO v_breaks_n, v_breaks
    FROM (SELECT *, row_number() OVER () rn FROM bad) b;

  SELECT count(*) INTO v_unattr FROM public.wallet_ledger
   WHERE created_at > now() - interval '24 hours' AND reason LIKE 'unattributed_%';

  v_ok := v_mismatch_n = 0 AND v_breaks_n = 0;
  v_result := jsonb_build_object('ok', v_ok, 'wallets_checked', v_wallets, 'balance_mismatches', v_mismatch_n,
                                 'chain_breaks', v_breaks_n, 'unattributed_24h', v_unattr,
                                 'mismatch_sample', v_mismatch, 'chain_break_sample', v_breaks);

  INSERT INTO public.wallet_reconciliation_runs (kind, ok, wallets_checked, balance_mismatches, chain_breaks, unattributed_24h, issues, details)
  VALUES ('ledger', v_ok, v_wallets, v_mismatch_n, v_breaks_n, v_unattr, v_mismatch_n + v_breaks_n, v_result);

  IF NOT v_ok THEN
    PERFORM public.notify_admins('Wallet ledger check failed',
      format('%s balance mismatch(es) and %s ledger chain break(s) found. Open Wallet ledger to review.', v_mismatch_n, v_breaks_n));
  END IF;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_wallet_ledger() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_wallet_ledger() TO authenticated, service_role;

-- Top-up cap at the database level.
CREATE OR REPLACE FUNCTION public.enforce_topup_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cap numeric := coalesce((SELECT value FROM public.wallet_controls WHERE key = 'max_topup_amount'), 5000);
BEGIN
  IF NEW.order_type IN ('wallet_topup', 'store_wallet_topup')
     AND coalesce(NEW.payment_method, '') <> 'admin'
     AND coalesce(NEW.amount, 0) > v_cap THEN
    RAISE EXCEPTION 'Top-up amount exceeds the GH₵% limit', v_cap USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_topup_cap ON public.orders;
CREATE TRIGGER trg_enforce_topup_cap BEFORE INSERT ON public.orders
  FOR EACH ROW WHEN (NEW.order_type IN ('wallet_topup', 'store_wallet_topup'))
  EXECUTE FUNCTION public.enforce_topup_cap();

-- Nightly ledger verification (02:30 UTC). Read-only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'wallet-ledger-verify';
    PERFORM cron.schedule('wallet-ledger-verify', '30 2 * * *', 'SELECT public.verify_wallet_ledger();');
  END IF;
END $$;
