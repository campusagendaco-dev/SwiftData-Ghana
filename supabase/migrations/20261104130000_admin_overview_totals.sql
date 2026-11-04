-- Exact all-time totals for the admin Overview, computed in the database.
-- The page used to sum rows in the browser, which PostgREST caps at 1,000 rows
-- per request (max_rows), so totals were understated once the platform grew.
-- Formulas mirror src/pages/AdminOverview.tsx exactly.
CREATE OR REPLACE FUNCTION public.get_admin_overview_totals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallets jsonb;
  v_sales jsonb;
  v_orders jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'get_admin_overview_totals: admin privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'wallet_balance_total', COALESCE(SUM(COALESCE(balance, 0)), 0),
           'wallet_count', COUNT(*)
         )
    INTO v_wallets
    FROM public.wallets;

  SELECT jsonb_build_object(
           'sales_volume_total', COALESCE(SUM(COALESCE(total_sales_volume, 0)), 0),
           'agent_profit_total', COALESCE(SUM(COALESCE(total_own_profit, 0)), 0),
           'sub_agent_profit_total', COALESCE(SUM(COALESCE(total_commissions_paid, 0)), 0)
         )
    INTO v_sales
    FROM public.user_sales_stats;

  WITH f AS (
    SELECT
      order_type,
      COALESCE(amount, 0) AS amt_raw,
      COALESCE(NULLIF(paystack_verified_amount, 0), amount, 0) AS amt_verified,
      COALESCE(paystack_fee, 0) AS fee,
      COALESCE(profit, 0) AS prof,
      COALESCE(parent_profit, 0) AS pprof,
      COALESCE(cost_price, 0) AS cost,
      regexp_match(upper(replace(COALESCE(package_size, ''), ' ', '')), '([0-9]+(\.[0-9]+)?)(MB|GB|TB)') AS cap
    FROM public.orders
    WHERE status = 'fulfilled'
  )
  SELECT jsonb_build_object(
           'fulfilled_count', COUNT(*),
           'total_revenue', COALESCE(SUM(amt_verified) FILTER (
               WHERE order_type IN ('wallet_topup', 'agent_activation', 'sub_agent_activation') AND amt_raw > 0), 0),
           'total_purchases', COALESCE(SUM(CASE WHEN order_type = 'api' THEN amt_raw ELSE amt_verified END) FILTER (
               WHERE order_type IN ('data', 'airtime', 'utility', 'afa', 'api')), 0),
           'api_volume', COALESCE(SUM(amt_raw) FILTER (WHERE order_type = 'api'), 0),
           'paystack_volume', COALESCE(SUM(amt_verified) FILTER (WHERE order_type IN ('data', 'airtime', 'utility', 'afa')), 0),
           'net_admin_profit', COALESCE(SUM(
               CASE
                 WHEN order_type = 'api' THEN prof
                 WHEN order_type IN ('data', 'airtime', 'utility', 'afa') THEN amt_verified - fee - prof - pprof - cost
                 WHEN order_type IN ('agent_activation', 'sub_agent_activation') THEN amt_verified - fee
                 WHEN order_type = 'wallet_topup' AND amt_raw > 0 THEN amt_verified - fee - amt_raw
                 ELSE 0
               END), 0),
           'total_gb', COALESCE(SUM(
               CASE
                 WHEN cap IS NULL THEN 0
                 WHEN cap[3] = 'MB' THEN cap[1]::numeric / 1024
                 WHEN cap[3] = 'TB' THEN cap[1]::numeric * 1024
                 ELSE cap[1]::numeric
               END) FILTER (WHERE order_type IN ('data', 'airtime', 'utility', 'afa', 'api')), 0)
         )
    INTO v_orders
    FROM f;

  RETURN jsonb_build_object('success', true) || v_wallets || v_sales || v_orders;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_overview_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_overview_totals() TO authenticated, service_role;
