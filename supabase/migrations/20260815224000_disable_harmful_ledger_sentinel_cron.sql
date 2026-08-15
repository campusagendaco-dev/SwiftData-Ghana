-- Migration: Disable Harmful Wallet Ledger Sentinel Cron Job & Make Audit Read-Only
-- 1. Unschedules the 'cron-wallet-ledger-sentinel' job from Postgres cron
-- 2. Redefines audit_and_reconcile_wallets() so it NEVER mutates or overwrites wallet balances automatically.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cron-wallet-ledger-sentinel')
    FROM cron.job
    WHERE jobname = 'cron-wallet-ledger-sentinel';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available or unschedule skipped: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.audit_and_reconcile_wallets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec RECORD;
  v_db_bal NUMERIC;
  v_topups NUMERIC;
  v_store_deposits NUMERIC;
  v_admin_creds NUMERIC;
  v_spent NUMERIC;
  v_valid_refunds NUMERIC;
  v_inflow NUMERIC;
  v_expected NUMERIC;
  v_diff NUMERIC;
  v_flagged_count INT := 0;
BEGIN
  -- Safe read-only audit: flags discrepancies in system_logs WITHOUT modifying wallets
  FOR v_rec IN SELECT agent_id, balance FROM public.wallets LOOP
    v_db_bal := COALESCE(v_rec.balance, 0);

    -- 1. Orders topups
    SELECT COALESCE(SUM(amount), 0) INTO v_topups
    FROM public.orders
    WHERE agent_id = v_rec.agent_id
      AND order_type IN ('wallet_topup', 'store_wallet_topup')
      AND status IN ('fulfilled', 'paid');

    -- 2. Store deposits (Paystack / Momo)
    SELECT COALESCE(SUM(amount), 0) INTO v_store_deposits
    FROM public.store_deposits
    WHERE user_id = v_rec.agent_id
      AND status = 'completed';

    -- 3. System log funding / admin credits
    SELECT COALESCE(SUM((data->>'amount')::numeric), 0) INTO v_admin_creds
    FROM public.system_logs
    WHERE agent_id = v_rec.agent_id
      AND event IN ('wallet.credit', 'wallet.funded', 'admin.credit', 'wallet_funding', 'manual_credit');

    v_inflow := v_topups + v_store_deposits + v_admin_creds;

    -- 4. Outflow
    SELECT COALESCE(SUM(amount), 0) INTO v_spent
    FROM public.orders
    WHERE agent_id = v_rec.agent_id
      AND order_type NOT IN ('wallet_topup', 'store_wallet_topup')
      AND payment_method IN ('wallet', 'balance')
      AND status IN ('fulfilled', 'processing', 'paid');

    -- 5. Valid Refunds
    SELECT COALESCE(SUM(amount), 0) INTO v_valid_refunds
    FROM public.orders
    WHERE agent_id = v_rec.agent_id
      AND order_type NOT IN ('wallet_topup', 'store_wallet_topup')
      AND payment_method IN ('wallet', 'balance')
      AND auto_refunded = true;

    v_expected := GREATEST(0, v_inflow - v_spent + v_valid_refunds);
    v_diff := v_db_bal - v_expected;

    -- If a significant discrepancy is detected, log it for admin review without changing the balance
    IF ABS(v_diff) > 10.00 THEN
      v_flagged_count := v_flagged_count + 1;
      INSERT INTO public.system_logs (level, source, event, message, agent_id, data)
      VALUES (
        'info', 'sentinel', 'wallet.audit_flagged',
        format('Sentinel audit flagged discrepancy for agent %s (Current: GHS %s, Estimated: GHS %s, Diff: GHS %s)', v_rec.agent_id, v_db_bal, v_expected, v_diff),
        v_rec.agent_id,
        jsonb_build_object('current_balance', v_db_bal, 'estimated_balance', v_expected, 'diff', v_diff)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'wallets_audited', (SELECT COUNT(*) FROM public.wallets),
    'wallets_flagged_for_review', v_flagged_count
  );
END;
$$;
