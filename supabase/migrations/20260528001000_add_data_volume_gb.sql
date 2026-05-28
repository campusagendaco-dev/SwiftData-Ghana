CREATE OR REPLACE FUNCTION public.parse_capacity_sql(package_size text)
RETURNS numeric AS $$
DECLARE
    clean_str text;
    val numeric;
    unit text;
BEGIN
    IF package_size IS NULL OR package_size = '' THEN RETURN 0; END IF;
    clean_str := upper(regexp_replace(package_size, '\s+', '', 'g'));
    
    -- Extract numeric part
    BEGIN
        val := substring(clean_str from '([0-9.]+)')::numeric;
    EXCEPTION WHEN OTHERS THEN
        val := 0;
    END;
    
    -- Extract unit
    unit := substring(clean_str from '(MB|GB|TB)');
    
    IF unit = 'MB' THEN
        RETURN val / 1024.0;
    ELSIF unit = 'TB' THEN
        RETURN val * 1024.0;
    ELSIF unit = 'GB' THEN
        RETURN val;
    END IF;
    
    RETURN val; -- default to GB if no unit
EXCEPTION
    WHEN OTHERS THEN
        RETURN 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update Materialized View to include data_volume_gb
DROP MATERIALIZED VIEW IF EXISTS public.admin_sales_stats_summary;

CREATE MATERIALIZED VIEW public.admin_sales_stats_summary AS
SELECT 
    (o.created_at AT TIME ZONE 'UTC')::date as bucket_date,
    COALESCE(SUM(COALESCE(o.paystack_verified_amount, o.amount)) FILTER (WHERE o.order_type IN ('data', 'airtime', 'utility', 'afa', 'api') AND (NOT p.is_agent OR NOT p.agent_approved) AND NOT p.is_sub_agent), 0) as customer_sales,
    COALESCE(SUM(COALESCE(o.paystack_verified_amount, o.amount)) FILTER (WHERE o.order_type IN ('data', 'airtime', 'utility', 'afa', 'api') AND p.is_agent AND p.agent_approved AND NOT p.is_sub_agent), 0) as agent_sales,
    COALESCE(SUM(COALESCE(o.paystack_verified_amount, o.amount)) FILTER (WHERE o.order_type IN ('data', 'airtime', 'utility', 'afa', 'api') AND p.is_sub_agent AND p.sub_agent_approved), 0) as sub_agent_sales,
    COALESCE(SUM(COALESCE(o.paystack_verified_amount, o.amount)) FILTER (WHERE o.order_type IN ('wallet_topup', 'agent_activation', 'sub_agent_activation')), 0) as deposit_volume,
    COUNT(*) FILTER (WHERE o.order_type IN ('data', 'airtime', 'utility', 'afa', 'api')) as order_count,
    COALESCE(SUM(public.parse_capacity_sql(o.package_size)) FILTER (WHERE o.order_type IN ('data', 'api')), 0) as data_volume_gb
FROM public.orders o
LEFT JOIN public.profiles p ON o.agent_id = p.user_id
WHERE o.status = 'fulfilled'
GROUP BY 1
ORDER BY 1 ASC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_sales_stats_summary_date ON public.admin_sales_stats_summary (bucket_date);

-- Update the RPC to include data_volume_gb
DROP FUNCTION IF EXISTS public.get_admin_sales_stats_v2(TIMESTAMP WITH TIME ZONE);

CREATE OR REPLACE FUNCTION public.get_admin_sales_stats_v2(p_start_date TIMESTAMP WITH TIME ZONE)
RETURNS TABLE (
    bucket_date TEXT,
    customer_sales NUMERIC,
    agent_sales NUMERIC,
    sub_agent_sales NUMERIC,
    deposit_volume NUMERIC,
    order_count BIGINT,
    data_volume_gb NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            p_start_date::date, 
            CURRENT_DATE, 
            '1 day'::interval
        )::date as d
    ),
    live_today AS (
        SELECT 
            (o.created_at AT TIME ZONE 'UTC')::date as d,
            COALESCE(SUM(COALESCE(o.paystack_verified_amount, o.amount)) FILTER (WHERE o.order_type IN ('data', 'airtime', 'utility', 'afa', 'api') AND (NOT p.is_agent OR NOT p.agent_approved) AND NOT p.is_sub_agent), 0) as customer_sales,
            COALESCE(SUM(COALESCE(o.paystack_verified_amount, o.amount)) FILTER (WHERE o.order_type IN ('data', 'airtime', 'utility', 'afa', 'api') AND p.is_agent AND p.agent_approved AND NOT p.is_sub_agent), 0) as agent_sales,
            COALESCE(SUM(COALESCE(o.paystack_verified_amount, o.amount)) FILTER (WHERE o.order_type IN ('data', 'airtime', 'utility', 'afa', 'api') AND p.is_sub_agent AND p.sub_agent_approved), 0) as sub_agent_sales,
            COALESCE(SUM(COALESCE(o.paystack_verified_amount, o.amount)) FILTER (WHERE o.order_type IN ('wallet_topup', 'agent_activation', 'sub_agent_activation')), 0) as deposit_volume,
            COUNT(*) FILTER (WHERE o.order_type IN ('data', 'airtime', 'utility', 'afa', 'api'))::bigint as order_count,
            COALESCE(SUM(public.parse_capacity_sql(o.package_size)) FILTER (WHERE o.order_type IN ('data', 'api')), 0) as data_volume_gb
        FROM public.orders o
        LEFT JOIN public.profiles p ON o.agent_id = p.user_id
        WHERE o.status = 'fulfilled'
          AND o.created_at >= CURRENT_DATE
        GROUP BY 1
    ),
    combined_stats AS (
        SELECT 
            m.bucket_date as d,
            m.customer_sales,
            m.agent_sales,
            m.sub_agent_sales,
            m.deposit_volume,
            m.order_count,
            m.data_volume_gb
        FROM public.admin_sales_stats_summary m
        WHERE m.bucket_date < CURRENT_DATE
        
        UNION ALL
        
        SELECT 
            lt.d,
            lt.customer_sales,
            lt.agent_sales,
            lt.sub_agent_sales,
            lt.deposit_volume,
            lt.order_count,
            lt.data_volume_gb
        FROM live_today lt
    )
    SELECT 
        ds.d::text as bucket_date,
        COALESCE(cs.customer_sales, 0) as customer_sales,
        COALESCE(cs.agent_sales, 0) as agent_sales,
        COALESCE(cs.sub_agent_sales, 0) as sub_agent_sales,
        COALESCE(cs.deposit_volume, 0) as deposit_volume,
        COALESCE(cs.order_count, 0) as order_count,
        COALESCE(cs.data_volume_gb, 0) as data_volume_gb
    FROM date_series ds
    LEFT JOIN combined_stats cs ON ds.d = cs.d
    ORDER BY ds.d ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
