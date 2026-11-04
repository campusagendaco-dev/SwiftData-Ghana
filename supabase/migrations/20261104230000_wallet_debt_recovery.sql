-- ═══════════════════════════════════════════════════════════════════════════
-- Recover the spent duplicate credits (August sentinel restoration) from
-- future wallet top-ups. Owner-approved 2026-11-04.
--
-- * wallet_debts: one row per user, opened from wallet_corrections.owed_remaining.
-- * On every successful main-wallet top-up (credit_topup_order), up to
--   wallet_controls.debt_recovery_max_share (default 50%) of the top-up is
--   applied to outstanding debt via wallet_post (ledgered, idempotent per
--   top-up, never below zero). The user is notified each time.
-- * Affected users are notified once now, before anything is recovered.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wallet_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  code text NOT NULL,
  description text NOT NULL,
  original_amount numeric(14,2) NOT NULL CHECK (original_amount > 0),
  outstanding numeric(14,2) NOT NULL CHECK (outstanding >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, code)
);
CREATE INDEX IF NOT EXISTS wallet_debts_open_idx ON public.wallet_debts (agent_id) WHERE outstanding > 0;
ALTER TABLE public.wallet_debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own debts" ON public.wallet_debts;
CREATE POLICY "Users read own debts" ON public.wallet_debts FOR SELECT TO authenticated USING (agent_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all debts" ON public.wallet_debts;
CREATE POLICY "Admins read all debts" ON public.wallet_debts FOR SELECT TO authenticated USING (public.is_admin());
REVOKE INSERT, UPDATE, DELETE ON public.wallet_debts FROM anon, authenticated;

INSERT INTO public.wallet_controls (key, value, description)
VALUES ('debt_recovery_max_share', 0.5, 'Largest share of each top-up applied to outstanding wallet debt (0-1)')
ON CONFLICT (key) DO NOTHING;

-- Open the debts from the August correction (only once).
INSERT INTO public.wallet_debts (agent_id, code, description, original_amount, outstanding)
SELECT agent_id, correction_code,
       'Duplicate credit from the 15 Aug 2026 wallet restoration that was already spent',
       owed_remaining, owed_remaining
FROM public.wallet_corrections
WHERE correction_code = 'sentinel_restoration_duplicate_2026_08_15' AND owed_remaining > 0
ON CONFLICT (agent_id, code) DO NOTHING;

-- Apply part of a credit to outstanding debts.
CREATE OR REPLACE FUNCTION public.recover_wallet_debts(p_agent_id uuid, p_source_amount numeric, p_source_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share numeric := LEAST(1, GREATEST(0, coalesce((SELECT value FROM public.wallet_controls WHERE key = 'debt_recovery_max_share'), 0.5)));
  v_avail numeric(14,2) := round(coalesce(p_source_amount, 0) * v_share, 2);
  v_total numeric(14,2) := 0;
  v_take numeric(14,2);
  v_bal numeric;
  v_res jsonb;
  d record;
BEGIN
  IF v_avail <= 0 THEN
    RETURN jsonb_build_object('recovered', 0);
  END IF;
  FOR d IN SELECT * FROM public.wallet_debts WHERE agent_id = p_agent_id AND outstanding > 0 ORDER BY created_at FOR UPDATE LOOP
    EXIT WHEN v_avail <= 0;
    SELECT coalesce(balance, 0) INTO v_bal FROM public.wallets WHERE agent_id = p_agent_id;
    v_take := round(LEAST(d.outstanding, v_avail, coalesce(v_bal, 0)), 2);
    EXIT WHEN v_take <= 0;
    v_res := public.wallet_post(p_agent_id, 'main', -v_take, 'debt_recovery', 'wallet_debt', d.id::text,
                                'recovery:' || p_source_ref || ':' || d.id::text, d.description);
    IF coalesce((v_res->>'success')::boolean, false) AND NOT coalesce((v_res->>'duplicate')::boolean, false) THEN
      UPDATE public.wallet_debts SET outstanding = outstanding - v_take, updated_at = now() WHERE id = d.id;
      v_total := v_total + v_take;
      v_avail := v_avail - v_take;
      INSERT INTO public.user_notifications (user_id, title, message, type, data)
      VALUES (p_agent_id, 'Part of your top-up was applied to a balance owed',
              format('GH₵%s of your top-up went towards the duplicate credit from 15 Aug. Remaining: GH₵%s.',
                     TRIM(TO_CHAR(v_take, '999990.00')), TRIM(TO_CHAR(d.outstanding - v_take, '999990.00'))),
              'info', jsonb_build_object('type', 'debt_recovery', 'debt_id', d.id, 'amount', v_take));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('recovered', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.recover_wallet_debts(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_wallet_debts(uuid, numeric, text) TO service_role;

-- credit_topup_order now applies debt recovery after a successful main-wallet credit.
CREATE OR REPLACE FUNCTION public.credit_topup_order(p_order_id uuid, p_paid_amount numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  v_account text;
  v_amount numeric(14,2);
  v_res jsonb;
  v_rec jsonb := jsonb_build_object('recovered', 0);
BEGIN
  SELECT id, agent_id, amount, order_type, status, metadata
    INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;
  IF o.order_type <> 'wallet_topup' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a wallet top-up order');
  END IF;
  IF o.agent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Top-up has no wallet owner');
  END IF;
  IF o.status = 'fulfilled' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'reason', 'Order already fulfilled');
  END IF;
  IF o.status IN ('refunded', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order is ' || o.status);
  END IF;

  v_account := CASE WHEN o.metadata->>'wallet_type' = 'api' THEN 'api' ELSE 'main' END;
  v_amount := round(CASE WHEN p_paid_amount IS NULL OR p_paid_amount <= 0 THEN o.amount
                         ELSE LEAST(p_paid_amount, o.amount) END, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid top-up amount');
  END IF;

  v_res := public.wallet_post(o.agent_id, v_account, v_amount, 'wallet_topup', 'order', p_order_id::text,
                              'topup:' || p_order_id::text, 'Wallet top-up');

  IF coalesce((v_res->>'success')::boolean, false) THEN
    UPDATE public.orders SET status = 'fulfilled', failure_reason = NULL, updated_at = now()
     WHERE id = p_order_id AND status <> 'fulfilled';
    IF v_account = 'main' AND NOT coalesce((v_res->>'duplicate')::boolean, false) THEN
      v_rec := public.recover_wallet_debts(o.agent_id, v_amount, 'topup:' || p_order_id::text);
    END IF;
  END IF;

  RETURN v_res || jsonb_build_object('account', v_account, 'amount', v_amount, 'debt_recovered', v_rec->'recovered');
END;
$$;
REVOKE ALL ON FUNCTION public.credit_topup_order(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_topup_order(uuid, numeric) TO service_role;

-- Tell affected users now, before anything is recovered (only once).
INSERT INTO public.user_notifications (user_id, title, message, type, data)
SELECT d.agent_id, 'About a duplicate credit on your wallet',
       format('On 15 Aug a system error credited your wallet more than once, and GH₵%s of that duplicate was already spent. From your next top-up, up to half of each top-up will go towards it until it is cleared. Contact support with any questions.',
              TRIM(TO_CHAR(d.outstanding, '999990.00'))),
       'info', jsonb_build_object('type', 'debt_notice', 'debt_id', d.id, 'amount', d.outstanding)
FROM public.wallet_debts d
WHERE d.code = 'sentinel_restoration_duplicate_2026_08_15' AND d.outstanding > 0
  AND NOT EXISTS (SELECT 1 FROM public.user_notifications n WHERE n.user_id = d.agent_id AND n.data->>'type' = 'debt_notice');
