-- ═══════════════════════════════════════════════════════════════════════════
-- Wallet Phase 2a: one secure door for money + ownership guards.
--
-- wallet_post(): the official way to move money. Locks the wallet row,
-- refuses to overdraw, labels the ledger entry (reason + reference), and is
-- idempotent: a repeated idempotency key returns the original result instead
-- of moving money twice. Server-only (service_role / database owner).
--
-- Guards: spin_the_wheel, claim_daily_check_in and convert_loyalty_points
-- accepted any user id from any signed-in caller. Browser callers are now
-- limited to their own account (admins excepted).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wallet_post(
  p_agent_id uuid,
  p_account text,
  p_amount numeric,
  p_reason text,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric(14,2) := round(p_amount, 2);
  v_bal numeric;
  v_new numeric(14,2);
  v_prior record;
  v_ledger_id bigint;
BEGIN
  IF p_agent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing account');
  END IF;
  IF p_account NOT IN ('main', 'api') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid wallet account');
  END IF;
  IF v_amount IS NULL OR v_amount = 0 OR abs(v_amount) > 100000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A reason is required');
  END IF;

  INSERT INTO public.wallets (agent_id, balance) VALUES (p_agent_id, 0) ON CONFLICT (agent_id) DO NOTHING;

  -- Lock first, then check idempotency, so concurrent duplicates serialise.
  SELECT CASE WHEN p_account = 'main' THEN coalesce(balance, 0) ELSE coalesce(api_balance, 0) END
    INTO v_bal FROM public.wallets WHERE agent_id = p_agent_id FOR UPDATE;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, balance_after INTO v_prior FROM public.wallet_ledger WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'ledger_id', v_prior.id, 'balance', v_prior.balance_after);
    END IF;
  END IF;

  v_new := round(v_bal + v_amount, 2);
  IF v_new < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance', 'balance', v_bal);
  END IF;

  PERFORM set_config('wallet.reason', p_reason, true);
  PERFORM set_config('wallet.ref_type', coalesce(p_reference_type, ''), true);
  PERFORM set_config('wallet.ref_id', coalesce(p_reference_id, ''), true);
  PERFORM set_config('wallet.note', coalesce(p_note, ''), true);
  PERFORM set_config('wallet.idempotency_key', coalesce(p_idempotency_key, ''), true);
  PERFORM set_config('wallet.source', 'wallet_post', true);

  IF p_account = 'main' THEN
    UPDATE public.wallets SET balance = v_new, updated_at = now() WHERE agent_id = p_agent_id;
  ELSE
    UPDATE public.wallets SET api_balance = v_new, updated_at = now() WHERE agent_id = p_agent_id;
  END IF;

  -- Clear labels so later changes in the same transaction are not mislabelled.
  PERFORM set_config('wallet.reason', '', true);
  PERFORM set_config('wallet.ref_type', '', true);
  PERFORM set_config('wallet.ref_id', '', true);
  PERFORM set_config('wallet.note', '', true);
  PERFORM set_config('wallet.idempotency_key', '', true);
  PERFORM set_config('wallet.source', '', true);

  SELECT id INTO v_ledger_id FROM public.wallet_ledger WHERE agent_id = p_agent_id ORDER BY id DESC LIMIT 1;
  RETURN jsonb_build_object('success', true, 'duplicate', false, 'ledger_id', v_ledger_id, 'balance', v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_post(uuid, text, numeric, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_post(uuid, text, numeric, text, text, text, text, text) TO service_role;

-- Inject an ownership / admin guard at the top of an existing function body.
CREATE OR REPLACE FUNCTION pg_temp.add_wallet_guard(p_sig regprocedure, p_guard text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_pos int;
BEGIN
  IF position('[wallet-guard 2026-11-04]' in v_def) > 0 THEN
    RETURN; -- already guarded
  END IF;
  v_pos := position(E'\nBEGIN' in v_def);
  IF v_pos = 0 THEN
    RAISE EXCEPTION 'Could not find BEGIN in %', p_sig;
  END IF;
  v_def := substr(v_def, 1, v_pos + 5) || E'\n  -- [wallet-guard 2026-11-04]\n  ' || p_guard || E'\n' || substr(v_def, v_pos + 6);
  EXECUTE v_def;
END;
$$;

SELECT pg_temp.add_wallet_guard('public.spin_the_wheel(uuid)'::regprocedure,
  $g$IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'spin_the_wheel: not authorized for this account' USING ERRCODE = '42501'; END IF;$g$);

SELECT pg_temp.add_wallet_guard('public.claim_daily_check_in(uuid)'::regprocedure,
  $g$IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'claim_daily_check_in: not authorized for this account' USING ERRCODE = '42501'; END IF;$g$);

SELECT pg_temp.add_wallet_guard('public.convert_loyalty_points(uuid, numeric)'::regprocedure,
  $g$IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND convert_loyalty_points.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'convert_loyalty_points: not authorized for this account' USING ERRCODE = '42501'; END IF;$g$);

-- settle_world_cup_match already rejects non-admins (has_role check), no guard needed.
