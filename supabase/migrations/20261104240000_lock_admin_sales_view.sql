-- Security: admin_sales_stats_summary (daily sales by segment, deposit volume, order counts, GB sold)
-- was readable by anyone holding the public anon key. It is only meant to be read inside
-- get_admin_sales_stats_v2(), a SECURITY DEFINER function that checks is_admin(), which keeps working.
REVOKE ALL ON public.admin_sales_stats_summary FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.admin_sales_stats_summary TO service_role;
