-- Wallet Phase 3b:
-- 1. Ledger entries from known database functions use the function name as the
--    reason, so 'unattributed_*' only flags genuinely unknown movements.
-- 2. Nightly Paystack ↔ wallet reconciliation (read-only edge function).

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
  -- Known database function: its name is the reason.
  IF v_reason IS NULL AND v_src NOT IN ('unknown', 'direct_update', 'wallet_created') THEN
    v_reason := v_src;
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
      v_idem := NULL;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'wallet-paystack-reconcile';
    PERFORM cron.schedule('wallet-paystack-reconcile', '0 3 * * *', $cmd$
      SELECT net.http_post(
        url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/wallet-reconcile',
        headers := json_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1)
        )::jsonb,
        body := '{}'::jsonb
      );
    $cmd$);
  END IF;
END $$;
