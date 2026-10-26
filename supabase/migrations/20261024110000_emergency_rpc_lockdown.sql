-- ============================================================================================
-- EMERGENCY CONTAINMENT: lock down RPC functions exposed to anonymous / any logged-in user.
--
-- Audit (2026-10-24) proved, by calling each function as the public `anon` role inside a READ-ONLY
-- transaction, that 71 SECURITY DEFINER functions were executable WITHOUT LOGIN, including:
--   credit_wallet / repay_credit / fulfill_store_wallet_topup  -> mint balance into any wallet
--   debit_wallet                                               -> drain any wallet
--   exec_http_request_via_db                                   -> arbitrary HTTP from the DB's IP
--   delete_provider_safe / bulk_suspend_users                  -> delete providers / suspend users
--   broadcast + SMS functions                                  -> spam users at our SMS cost
--   admin_* investigation / stats functions                    -> leak financial data
-- Root cause: Supabase's default privileges grant EXECUTE on every new public function to anon and
-- authenticated. "REVOKE ... FROM PUBLIC" (used in older migrations) does NOT remove those grants.
--
-- This migration ONLY changes privileges (no function bodies, no data). Fully reversible with GRANT.
-- Every server-side caller was verified to use the service-role key (unaffected).
-- ============================================================================================

-- Helper: apply to every overload of each named function, so it works regardless of signature drift.
CREATE OR REPLACE FUNCTION pg_temp.lock_functions(p_names text[], p_keep_authenticated boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (p_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF p_keep_authenticated THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    RAISE NOTICE 'locked % (authenticated=%)', r.sig, p_keep_authenticated;
  END LOOP;
END $$;

-- TIER 1: server-only (edge functions with service role, cron, triggers). No browser caller exists.
SELECT pg_temp.lock_functions(ARRAY[
  'credit_wallet', 'repay_credit', 'fulfill_store_wallet_topup', 'draw_agent_credit',
  'redeem_loyalty_points_to_wallet', 'exec_http_request_via_db', 'invoke_edge_function',
  'admin_restore_sentinel_deductions', 'audit_and_reconcile_wallets', 'auto_reset_stuck_orders',
  'blacklist_suspicious_accounts', 'release_expired_suspensions', 'charge_sms_credit', 'refund_sms_credit',
  'increment_sentinel_cost', 'claim_promo_code', 'claim_whatsapp_webhook_message',
  'fetch_next_whatsapp_broadcast_batch', 'get_dormant_wallet_recipients', 'get_inactive_winback_sms_users',
  'get_inactive_winback_users', 'mark_missed_you_sms_sent', 'run_daily_smooth_broadcast',
  'dispatch_system_upgrade_broadcast', 'broadcast_push_notification', 'cleanup_rate_limit_counters',
  'reset_agent_api_daily_spend', 'log_security_violation', 'admin_investigate_deductions',
  'admin_investigate_deductions_v2', 'admin_inspect_order_by_phone', 'admin_get_sentinel_affected_agents',
  'get_whatsapp_broadcast_queue_stats', 'should_auto_approve_withdrawal', 'check_error_spike',
  'log_failed_login'
], false);

-- TIER 2: called from logged-in dashboard/admin pages. Remove anonymous access now.
-- (Ownership/admin checks inside these bodies are a follow-up: see audit report.)
SELECT pg_temp.lock_functions(ARRAY[
  'debit_wallet', 'delete_provider_safe', 'bulk_suspend_users', 'approve_store_deposit',
  'get_admin_sales_stats_v2', 'get_agent_churn_insights', 'get_agent_financial_stats', 'get_sub_agents_status',
  'transfer_float_to_subagent', 'user_transfer_to_api', 'claim_free_agent_promo', 'increment_data_promo_claim',
  'purge_old_system_logs', 'dispatch_missed_you_push_broadcast', 'repay_agent_credit', 'refund_failed_order',
  'calculate_next_run', 'get_agent_leaderboard', 'purchase_sms_credits', 'redeem_swift_points',
  'reset_promo_claims', 'submit_world_cup_prediction', 'settle_world_cup_match'
], true);

-- Intentionally still public (needed before login / by RLS policies, read-only or self-guarded):
--   get_public_stats, get_public_order_status, check_device_blocked, is_admin, has_role,
--   check_current_user_mfa, normalize_phone_sql, parse_capacity_sql, calculate_loyalty_points,
--   calculate_terminal_risk, is_whatsapp_opted_out, check_generic_rate_limit

-- ROOT CAUSE: stop future functions from being anon-executable by default.
-- New functions that genuinely need public access must now GRANT it explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
