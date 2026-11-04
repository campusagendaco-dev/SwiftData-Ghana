-- Reverse the duplicate credits from the 15 Aug 2026 "sentinel restoration".
--
-- admin_restore_sentinel_deductions() refunds every wallet.audit_auto_corrected
-- deduction but has no run-once guard, and it was executed three times, so each
-- affected wallet received its restoration up to three times. Over-credit per
-- wallet = total restored - total originally deducted.
--
-- Approved by the owner on 2026-11-04 (option 2): take back only what is still
-- in the wallet, never below GH₵0. Amounts already spent are recorded in
-- wallet_corrections.owed_remaining for follow-up, not deducted.
-- Idempotent: one row per (agent_id, correction_code); re-running does nothing.

CREATE TABLE IF NOT EXISTS public.wallet_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  correction_code text NOT NULL,
  overcredit numeric(12,2) NOT NULL,
  amount_reversed numeric(12,2) NOT NULL,
  owed_remaining numeric(12,2) NOT NULL,
  balance_before numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, correction_code)
);

ALTER TABLE public.wallet_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read wallet corrections" ON public.wallet_corrections;
CREATE POLICY "Admins read wallet corrections" ON public.wallet_corrections
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Users read own wallet corrections" ON public.wallet_corrections;
CREATE POLICY "Users read own wallet corrections" ON public.wallet_corrections
  FOR SELECT TO authenticated USING (agent_id = auth.uid());
REVOKE ALL ON public.wallet_corrections FROM anon;

DO $$
DECLARE
  r record;
  v_code constant text := 'sentinel_restoration_duplicate_2026_08_15';
  v_balance numeric;
  v_take numeric;
  v_inserted uuid;
  v_count int := 0;
  v_total numeric := 0;
BEGIN
  FOR r IN
    WITH d AS (
      SELECT agent_id, SUM((data->>'deducted')::numeric) AS deducted
      FROM public.system_logs
      WHERE event = 'wallet.audit_auto_corrected' AND agent_id IS NOT NULL AND (data->>'deducted')::numeric > 0
      GROUP BY agent_id
    ), x AS (
      SELECT agent_id, SUM((data->>'restored_amount')::numeric) AS restored
      FROM public.system_logs
      WHERE event = 'wallet.sentinel_deduction_refunded' AND agent_id IS NOT NULL
      GROUP BY agent_id
    )
    SELECT d.agent_id, ROUND(x.restored - d.deducted, 2) AS overcredit
    FROM d JOIN x USING (agent_id)
    WHERE x.restored > d.deducted
  LOOP
    -- lock the wallet row so a concurrent purchase can't interleave
    SELECT balance INTO v_balance FROM public.wallets WHERE agent_id = r.agent_id FOR UPDATE;
    IF v_balance IS NULL THEN
      CONTINUE;
    END IF;
    v_take := GREATEST(0, LEAST(v_balance, r.overcredit));

    INSERT INTO public.wallet_corrections (agent_id, correction_code, overcredit, amount_reversed, owed_remaining, balance_before, balance_after)
    VALUES (r.agent_id, v_code, r.overcredit, v_take, r.overcredit - v_take, v_balance, v_balance - v_take)
    ON CONFLICT (agent_id, correction_code) DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NULL THEN
      CONTINUE; -- already corrected
    END IF;

    IF v_take > 0 THEN
      UPDATE public.wallets SET balance = balance - v_take, updated_at = now() WHERE agent_id = r.agent_id;

      INSERT INTO public.user_notifications (user_id, title, message, type, data)
      VALUES (
        r.agent_id,
        'Wallet correction',
        format('On 15 Aug a system error added the same restoration to your wallet more than once. We have reversed the duplicate amount of GH₵%s. Contact support if you have any questions.', TRIM(TO_CHAR(v_take, '999990.00'))),
        'info',
        jsonb_build_object('type', 'wallet_correction', 'correction_code', v_code, 'amount', v_take)
      );
    END IF;

    INSERT INTO public.audit_logs (action, target_id, details)
    VALUES (
      'wallet_correction_duplicate_restoration',
      r.agent_id,
      jsonb_build_object('correction_code', v_code, 'overcredit', r.overcredit, 'amount_reversed', v_take,
                         'owed_remaining', r.overcredit - v_take, 'balance_before', v_balance, 'balance_after', v_balance - v_take)
    );

    v_count := v_count + 1;
    v_total := v_total + v_take;
  END LOOP;

  RAISE NOTICE 'wallet corrections applied: % wallets, GH₵% reversed', v_count, v_total;
END $$;

-- Close the original bug: the restoration function must never run again.
REVOKE ALL ON FUNCTION public.admin_restore_sentinel_deductions() FROM PUBLIC, anon, authenticated;
