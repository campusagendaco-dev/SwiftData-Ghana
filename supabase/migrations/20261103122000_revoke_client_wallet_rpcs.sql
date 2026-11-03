-- Security: money-moving SECURITY DEFINER functions must not be callable by clients.
--
-- Earlier migrations ran `REVOKE EXECUTE ... FROM PUBLIC` on these, but on
-- Supabase the anon and authenticated roles receive their own direct EXECUTE
-- grant through the schema's default privileges, which a PUBLIC revoke does
-- not remove. credit_wallet has no caller check of its own, so any signed-in
-- user could call `rpc('credit_wallet', { p_agent_id: <self>, p_amount: 1e6 })`
-- (repay_credit and fulfill_store_wallet_topup likewise add any amount).
--
-- None of these are called from the frontend (src/); edge functions call them
-- with the service role, and other SECURITY DEFINER functions call them as
-- their owner, so both keep working.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        -- add/remove wallet money with no caller check (server-side callers only)
        'credit_wallet', 'repay_credit', 'fulfill_store_wallet_topup',
        'finalize_withdrawal', 'request_withdrawal', 'draw_agent_credit',
        'refund_sms_credit', 'charge_sms_credit', 'redeem_loyalty_points_to_wallet',
        -- admin maintenance / investigation RPCs with no is_admin() check and no callers
        'purge_test_accounts', 'admin_restore_sentinel_deductions', 'audit_and_reconcile_wallets',
        'admin_inspect_order_by_phone', 'admin_investigate_deductions',
        'admin_investigate_deductions_v2', 'admin_get_sentinel_affected_agents'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    RAISE NOTICE 'locked down %', r.sig;
  END LOOP;
END $$;
