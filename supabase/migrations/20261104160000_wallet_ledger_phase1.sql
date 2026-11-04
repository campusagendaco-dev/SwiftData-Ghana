-- ═══════════════════════════════════════════════════════════════════════════
-- Wallet ledger, Phase 1: every balance change is recorded, permanently.
--
-- * wallet_ledger is append-only (updates/deletes/truncate are rejected).
-- * Each row carries a SHA-256 hash of the previous row for the same user, so
--   any tampering breaks the chain and is detectable (verify_wallet_ledger()).
-- * A trigger on wallets records every change to balance / api_balance /
--   loyalty_balance automatically, whoever made it. Callers can label the
--   entry with set_config('wallet.reason'|'wallet.ref_type'|'wallet.ref_id'|
--   'wallet.note'|'wallet.idempotency_key', ..., true); otherwise the source
--   function is derived from the calling statement and the entry is marked
--   'unattributed_*' for review.
-- * Opening-balance entries start every chain at today's balances.
-- Behaviour of existing wallet functions is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id              bigserial PRIMARY KEY,
  agent_id        uuid NOT NULL,
  account         text NOT NULL CHECK (account IN ('main', 'api', 'loyalty')),
  amount          numeric(14,2) NOT NULL,
  balance_before  numeric(14,2) NOT NULL,
  balance_after   numeric(14,2) NOT NULL,
  reason          text NOT NULL,
  reference_type  text,
  reference_id    text,
  idempotency_key text UNIQUE,
  source          text,
  actor_id        uuid,
  actor_role      text,
  note            text,
  context         text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash       text,
  hash            text NOT NULL,
  CONSTRAINT wallet_ledger_math CHECK (balance_after = balance_before + amount)
);

CREATE INDEX IF NOT EXISTS wallet_ledger_agent_idx ON public.wallet_ledger (agent_id, id DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_created_idx ON public.wallet_ledger (created_at);
CREATE INDEX IF NOT EXISTS wallet_ledger_ref_idx ON public.wallet_ledger (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS wallet_ledger_reason_idx ON public.wallet_ledger (reason);

-- Deterministic hash of one entry, chained to the previous entry's hash.
CREATE OR REPLACE FUNCTION public.wallet_ledger_hash(
  p_prev text, p_agent uuid, p_account text, p_amount numeric, p_before numeric, p_after numeric,
  p_reason text, p_ref_type text, p_ref_id text, p_created timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    coalesce(p_prev, 'GENESIS'), p_agent::text, p_account,
    round(p_amount, 2)::text, round(p_before, 2)::text, round(p_after, 2)::text,
    p_reason, coalesce(p_ref_type, ''), coalesce(p_ref_id, ''),
    to_char(p_created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ), 'UTF8')), 'hex');
$$;

-- Append one ledger entry (used by the trigger and, in Phase 2, by wallet_post).
CREATE OR REPLACE FUNCTION public.wallet_ledger_append(
  p_agent uuid, p_account text, p_before numeric, p_after numeric,
  p_reason text, p_ref_type text, p_ref_id text, p_idem text, p_source text, p_note text, p_context text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
  v_ts timestamptz := clock_timestamp();
  v_amount numeric(14,2) := round(p_after, 2) - round(p_before, 2);
  v_id bigint;
BEGIN
  SELECT hash INTO v_prev FROM public.wallet_ledger WHERE agent_id = p_agent ORDER BY id DESC LIMIT 1;
  INSERT INTO public.wallet_ledger (agent_id, account, amount, balance_before, balance_after, reason,
                                    reference_type, reference_id, idempotency_key, source, actor_id, actor_role,
                                    note, context, created_at, prev_hash, hash)
  VALUES (p_agent, p_account, v_amount, round(p_before, 2), round(p_after, 2), p_reason,
          p_ref_type, p_ref_id, p_idem, p_source, auth.uid(), coalesce(auth.role(), current_user),
          p_note, p_context, v_ts, v_prev,
          public.wallet_ledger_hash(v_prev, p_agent, p_account, v_amount, round(p_before, 2), round(p_after, 2),
                                    p_reason, p_ref_type, p_ref_id, v_ts))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Trigger: record every balance change on wallets.
CREATE OR REPLACE FUNCTION public.wallet_ledger_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := nullif(current_setting('wallet.reason', true), '');
  v_ref_type text := nullif(current_setting('wallet.ref_type', true), '');
  v_ref_id text := nullif(current_setting('wallet.ref_id', true), '');
  v_note text := nullif(current_setting('wallet.note', true), '');
  v_idem text := nullif(current_setting('wallet.idempotency_key', true), '');
  v_ctx text := left(regexp_replace(coalesce(current_query(), ''), '\s+', ' ', 'g'), 400);
  v_src text;
  v_old numeric; v_new numeric; v_acct text;
  i int;
BEGIN
  v_src := nullif(current_setting('wallet.source', true), '');
  IF v_src IS NULL THEN
    v_src := substring(v_ctx from '"?public"?\."?([a-z0-9_]+)"?\s*\(');
  END IF;
  IF v_src IS NULL THEN
    v_src := CASE
      WHEN v_ctx ~* 'update\s+"?public"?\."?wallets' THEN 'direct_update'
      WHEN v_ctx ~* 'insert\s+into\s+"?public"?\."?wallets' THEN 'wallet_created'
      ELSE 'unknown' END;
  END IF;

  FOR i IN 1..3 LOOP
    IF i = 1 THEN
      v_acct := 'main';
      v_new := coalesce(NEW.balance, 0);
      v_old := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE coalesce(OLD.balance, 0) END;
    ELSIF i = 2 THEN
      v_acct := 'api';
      v_new := coalesce(NEW.api_balance, 0);
      v_old := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE coalesce(OLD.api_balance, 0) END;
    ELSE
      v_acct := 'loyalty';
      v_new := coalesce(NEW.loyalty_balance, 0);
      v_old := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE coalesce(OLD.loyalty_balance, 0) END;
    END IF;

    IF round(v_new, 2) <> round(v_old, 2) THEN
      PERFORM public.wallet_ledger_append(
        NEW.agent_id, v_acct, v_old, v_new,
        coalesce(v_reason, CASE WHEN v_new > v_old THEN 'unattributed_credit' ELSE 'unattributed_debit' END),
        v_ref_type, v_ref_id, v_idem, v_src, v_note, v_ctx);
      v_idem := NULL; -- an idempotency key applies to a single entry
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Writes only to wallet_ledger (never back to wallets), so it cannot recurse.
DROP TRIGGER IF EXISTS trg_wallet_ledger_capture ON public.wallets;
DROP TRIGGER IF EXISTS trg_wallet_ledger_capture_ins ON public.wallets;
DROP TRIGGER IF EXISTS trg_wallet_ledger_capture_upd ON public.wallets;
CREATE TRIGGER trg_wallet_ledger_capture_ins
  AFTER INSERT ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.wallet_ledger_capture();
CREATE TRIGGER trg_wallet_ledger_capture_upd
  AFTER UPDATE OF balance, api_balance, loyalty_balance ON public.wallets
  FOR EACH ROW
  WHEN (OLD.balance IS DISTINCT FROM NEW.balance
        OR OLD.api_balance IS DISTINCT FROM NEW.api_balance
        OR OLD.loyalty_balance IS DISTINCT FROM NEW.loyalty_balance)
  EXECUTE FUNCTION public.wallet_ledger_capture();

-- Append-only: no updates, deletes or truncates, ever.
CREATE OR REPLACE FUNCTION public.wallet_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger is append-only: % is not allowed', TG_OP USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_ledger_no_update ON public.wallet_ledger;
CREATE TRIGGER trg_wallet_ledger_no_update BEFORE UPDATE OR DELETE ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.wallet_ledger_immutable();
DROP TRIGGER IF EXISTS trg_wallet_ledger_no_truncate ON public.wallet_ledger;
CREATE TRIGGER trg_wallet_ledger_no_truncate BEFORE TRUNCATE ON public.wallet_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.wallet_ledger_immutable();

-- Access: users see their own history, admins see everything, nobody writes directly.
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own ledger" ON public.wallet_ledger;
CREATE POLICY "Users read own ledger" ON public.wallet_ledger FOR SELECT TO authenticated USING (agent_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all ledger" ON public.wallet_ledger;
CREATE POLICY "Admins read all ledger" ON public.wallet_ledger FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.wallet_ledger FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.wallet_ledger FROM authenticated;
GRANT SELECT ON public.wallet_ledger TO authenticated;
REVOKE ALL ON FUNCTION public.wallet_ledger_append(uuid, text, numeric, numeric, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_ledger_capture() FROM PUBLIC, anon, authenticated;

-- Opening balances: start every chain at today's balance (only once).
DO $$
DECLARE
  w record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wallet_ledger WHERE reason = 'opening_balance') THEN
    RETURN;
  END IF;
  FOR w IN SELECT agent_id, coalesce(balance, 0) b, coalesce(api_balance, 0) a, coalesce(loyalty_balance, 0) l FROM public.wallets ORDER BY agent_id LOOP
    IF round(w.b, 2) <> 0 THEN
      PERFORM public.wallet_ledger_append(w.agent_id, 'main', 0, w.b, 'opening_balance', 'migration', '20261104160000', NULL, 'migration', 'Balance carried forward when the ledger started', NULL);
    END IF;
    IF round(w.a, 2) <> 0 THEN
      PERFORM public.wallet_ledger_append(w.agent_id, 'api', 0, w.a, 'opening_balance', 'migration', '20261104160000', NULL, 'migration', 'Balance carried forward when the ledger started', NULL);
    END IF;
    IF round(w.l, 2) <> 0 THEN
      PERFORM public.wallet_ledger_append(w.agent_id, 'loyalty', 0, w.l, 'opening_balance', 'migration', '20261104160000', NULL, 'migration', 'Balance carried forward when the ledger started', NULL);
    END IF;
  END LOOP;
END $$;
