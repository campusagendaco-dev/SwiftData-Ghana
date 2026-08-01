-- Migration: Automated Ledger Audit Sentinel & Daily Reconciler v4
-- Creates public.audit_and_reconcile_wallets() to run inside Postgres automatically

CREATE OR REPLACE FUNCTION public.audit_and_reconcile_wallets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec RECORD;
  v_db_bal NUMERIC;
  v_topups NUMERIC;
  v_admin_creds NUMERIC;
  v_spent NUMERIC;
  v_valid_refunds NUMERIC;
  v_inflow NUMERIC;
  v_expected NUMERIC;
  v_diff NUMERIC;
  v_corrected_count INT := 0;
  v_total_adjusted NUMERIC := 0;
BEGIN
  -- 1. Clear auto_refunded status on any order that was not paid via wallet or balance
  UPDATE public.orders
  SET auto_refunded = false
  WHERE auto_refunded = true
    AND (payment_method IS NULL OR payment_method NOT IN ('wallet', 'balance'));

  -- Loop through all user wallets
  FOR v_rec IN SELECT agent_id, balance FROM public.wallets LOOP
    v_db_bal := COALESCE(v_rec.balance, 0);

    -- 1. Topup Orders
    SELECT COALESCE(SUM(amount), 0) INTO v_topups
    FROM public.orders
    WHERE agent_id = v_rec.agent_id
      AND order_type IN ('wallet_topup', 'store_wallet_topup')
      AND status IN ('fulfilled', 'paid');

    -- 2. Admin Credits
    SELECT COALESCE(SUM((data->>'amount')::numeric), 0) INTO v_admin_creds
    FROM public.system_logs
    WHERE agent_id = v_rec.agent_id
      AND event IN ('wallet.credit', 'wallet.funded', 'admin.credit');

    -- Total Inflow
    v_inflow := v_topups + v_admin_creds;

    -- 3. Outflow (Wallet Purchases)
    SELECT COALESCE(SUM(amount), 0) INTO v_spent
    FROM public.orders
    WHERE agent_id = v_rec.agent_id
      AND order_type NOT IN ('wallet_topup', 'store_wallet_topup')
      AND payment_method IN ('wallet', 'balance')
      AND status IN ('fulfilled', 'processing', 'paid', 'fulfillment_failed');

    -- 4. Valid Refunds
    SELECT COALESCE(SUM(amount), 0) INTO v_valid_refunds
    FROM public.orders
    WHERE agent_id = v_rec.agent_id
      AND order_type NOT IN ('wallet_topup', 'store_wallet_topup')
      AND payment_method IN ('wallet', 'balance')
      AND auto_refunded = true
      AND status = 'fulfillment_failed';

    -- Calculate expected balance
    v_expected := GREATEST(0, v_inflow - v_spent + v_valid_refunds);
    v_diff := v_db_bal - v_expected;

    IF v_diff > 0.05 THEN
      UPDATE public.wallets
      SET balance = v_expected, updated_at = now()
      WHERE agent_id = v_rec.agent_id;

      v_corrected_count := v_corrected_count + 1;
      v_total_adjusted := v_total_adjusted + v_diff;

      INSERT INTO public.system_logs (level, source, event, message, agent_id, data)
      VALUES (
        'warning', 'sentinel', 'wallet.audit_auto_corrected',
        format('Sentinel auto-corrected wallet balance from GHS %s to GHS %s (Deducted GHS %s unearned credit)', v_db_bal, v_expected, v_diff),
        v_rec.agent_id,
        jsonb_build_object('old_balance', v_db_bal, 'new_balance', v_expected, 'deducted', v_diff)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'wallets_corrected', v_corrected_count,
    'total_amount_adjusted', v_total_adjusted
  );
END;
$$;

-- Schedule job to run every night at 2:00 AM UTC
SELECT cron.unschedule('cron-wallet-ledger-sentinel') FROM cron.job WHERE jobname = 'cron-wallet-ledger-sentinel';

SELECT cron.schedule(
  'cron-wallet-ledger-sentinel',
  '0 2 * * *',
  $$ SELECT public.audit_and_reconcile_wallets(); $$
);
