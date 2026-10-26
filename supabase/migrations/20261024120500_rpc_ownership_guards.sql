-- ============================================================================================
-- Ownership / admin guards for RPCs that logged-in browsers can call.
-- GENERATED from the LIVE definitions (pg_get_functiondef, 2026-10-24); the only change to each body
-- is the guard block inserted right after the first BEGIN. Without these, any registered user could
-- e.g. debit_wallet(<someone else>), transfer another master's float, credit their own wallet via
-- repay_agent_credit, or delete providers.
-- Callers using the service-role key, pg_cron jobs and triggers are unaffected
-- (auth.role() is 'service_role' / NULL for them, and pg_trigger_depth() > 0 inside triggers).
-- ============================================================================================

-- ----- debit_wallet
CREATE OR REPLACE FUNCTION public.debit_wallet(p_agent_id uuid, p_amount numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    current_balance NUMERIC;
    current_limit NUMERIC;
BEGIN

  -- [security 2026-10-24] browser callers may only act on their own account (admins exempt)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_agent_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'debit_wallet: not authorized for this account' USING ERRCODE = '42501';
  END IF;

    IF p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'Amount must be greater than zero');
    END IF;

    SELECT balance, COALESCE(credit_limit, 0) INTO current_balance, current_limit 
    FROM wallets 
    WHERE agent_id = p_agent_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO wallets (agent_id, balance, loyalty_balance, api_balance, created_at, updated_at)
        VALUES (p_agent_id, 0.00, 0, 0.00, NOW(), NOW())
        ON CONFLICT (agent_id) DO NOTHING;

        RETURN json_build_object(
            'success', false, 
            'error', 'Insufficient wallet balance',
            'balance', 0.00,
            'credit_limit', 0.00
        );
    END IF;

    IF (current_balance - p_amount) < (-current_limit) THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Insufficient wallet balance',
            'balance', current_balance,
            'credit_limit', current_limit
        );
    END IF;

    UPDATE wallets 
    SET balance = balance - p_amount,
        updated_at = NOW()
    WHERE agent_id = p_agent_id;

    RETURN json_build_object('success', true, 'new_balance', current_balance - p_amount);
END;
$function$;

-- ----- transfer_float_to_subagent
CREATE OR REPLACE FUNCTION public.transfer_float_to_subagent(p_master_id uuid, p_sub_id uuid, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_master_balance NUMERIC;
    v_is_valid_sub BOOLEAN;
BEGIN

  -- [security 2026-10-24] browser callers may only act on their own account (admins exempt)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_master_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'transfer_float_to_subagent: not authorized for this account' USING ERRCODE = '42501';
  END IF;

    IF p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
    END IF;

    -- Verify sub-agent belongs to master
    SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE user_id = p_sub_id AND parent_agent_id = p_master_id
    ) INTO v_is_valid_sub;

    IF NOT v_is_valid_sub THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid sub-agent');
    END IF;

    -- Check master balance
    SELECT balance INTO v_master_balance FROM public.wallets WHERE agent_id = p_master_id FOR UPDATE;
    
    IF v_master_balance IS NULL OR v_master_balance < p_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient master float balance');
    END IF;

    -- Debit Master
    UPDATE public.wallets SET balance = balance - p_amount WHERE agent_id = p_master_id;
    
    -- Credit Sub-agent
    UPDATE public.wallets SET balance = balance + p_amount WHERE agent_id = p_sub_id;

    -- Log transaction
    INSERT INTO public.orders (agent_id, parent_agent_id, order_type, amount, status, metadata)
    VALUES (p_sub_id, p_master_id, 'float_bridge', p_amount, 'fulfilled', jsonb_build_object('description', 'Float bridge from master agent'));

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- ----- get_sub_agents_status
CREATE OR REPLACE FUNCTION public.get_sub_agents_status(p_master_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, momo_number text, wallet_balance numeric, total_sales_today numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN

  -- [security 2026-10-24] browser callers may only act on their own account (admins exempt)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_master_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'get_sub_agents_status: not authorized for this account' USING ERRCODE = '42501';
  END IF;

    RETURN QUERY
    SELECT 
        p.user_id,
        p.full_name,
        p.momo_number,
        COALESCE(w.balance, 0) AS wallet_balance,
        COALESCE((
            SELECT SUM(amount)
            FROM public.orders o
            WHERE o.agent_id = p.user_id 
              AND DATE(o.created_at) = CURRENT_DATE
              AND o.status = 'fulfilled'
        ), 0) AS total_sales_today
    FROM public.profiles p
    LEFT JOIN public.wallets w ON w.agent_id = p.user_id
    WHERE p.parent_agent_id = p_master_id;
END;
$function$;

-- ----- get_agent_churn_insights
CREATE OR REPLACE FUNCTION public.get_agent_churn_insights(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
BEGIN

  -- [security 2026-10-24] browser callers may only act on their own account (admins exempt)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_agent_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'get_agent_churn_insights: not authorized for this account' USING ERRCODE = '42501';
  END IF;

  WITH customer_stats AS (
    SELECT 
      customer_phone,
      network,
      COUNT(*) as total_orders,
      MAX(created_at) as last_purchase_date,
      MODE() WITHIN GROUP (ORDER BY package_size) as favorite_package
    FROM public.orders
    WHERE agent_id = p_agent_id 
      AND status = 'completed' 
      AND customer_phone IS NOT NULL
      AND customer_phone != ''
      AND customer_phone != 'N/A'
    GROUP BY customer_phone, network
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'phone', customer_phone,
      'network', network,
      'total_orders', total_orders,
      'last_purchase_date', last_purchase_date,
      'favorite_package', favorite_package,
      'days_since_last_purchase', EXTRACT(DAY FROM (now() - last_purchase_date))
    ) ORDER BY last_purchase_date ASC
  ), '[]'::jsonb) INTO v_result
  FROM customer_stats
  WHERE total_orders >= 2 
    AND last_purchase_date < now() - INTERVAL '7 days'
  LIMIT 5;

  RETURN v_result;
END;
$function$;

-- ----- get_agent_financial_stats
CREATE OR REPLACE FUNCTION public.get_agent_financial_stats(p_agent_id uuid)
 RETURNS TABLE(lifetime_profit numeric, completed_withdrawals numeric, pending_withdrawals numeric, available_balance numeric, completed_order_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_own_profit NUMERIC;
  v_parent_profit NUMERIC;
  v_completed_wds NUMERIC;
  v_pending_wds NUMERIC;
  v_order_count BIGINT;
BEGIN

  -- [security 2026-10-24] browser callers may only act on their own account (admins exempt)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_agent_id IS DISTINCT FROM auth.uid()
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_agent_id AND parent_agent_id = auth.uid()) THEN
    RAISE EXCEPTION 'get_agent_financial_stats: not authorized for this account' USING ERRCODE = '42501';
  END IF;

  -- Total profit from own fulfilled sales
  SELECT COALESCE(SUM(profit), 0), COUNT(*)
  INTO v_own_profit, v_order_count
  FROM public.orders
  WHERE agent_id = p_agent_id AND status IN ('fulfilled', 'completed');

  -- Total profit from sub-agent fulfilled sales
  SELECT COALESCE(SUM(parent_profit), 0)
  INTO v_parent_profit
  FROM public.orders
  WHERE parent_agent_id = p_agent_id AND status IN ('fulfilled', 'completed');

  -- Completed withdrawals
  SELECT COALESCE(SUM(amount), 0)
  INTO v_completed_wds
  FROM public.withdrawals
  WHERE agent_id = p_agent_id AND status = 'completed';

  -- Pending withdrawals
  SELECT COALESCE(SUM(amount), 0)
  INTO v_pending_wds
  FROM public.withdrawals
  WHERE agent_id = p_agent_id AND status IN ('pending', 'processing');

  lifetime_profit := ROUND(COALESCE(v_own_profit + v_parent_profit, 0), 2);
  completed_withdrawals := ROUND(COALESCE(v_completed_wds, 0), 2);
  pending_withdrawals := ROUND(COALESCE(v_pending_wds, 0), 2);
  available_balance := ROUND(lifetime_profit - (v_completed_wds + v_pending_wds), 2);
  completed_order_count := COALESCE(v_order_count, 0);

  RETURN NEXT;
END;
$function$;

-- ----- delete_provider_safe
CREATE OR REPLACE FUNCTION public.delete_provider_safe(p_provider_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name TEXT;
BEGIN

  -- [security 2026-10-24] browser callers must be admins (service_role / cron / triggers unaffected)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'delete_provider_safe: admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- Check if provider exists
  SELECT name INTO v_name FROM public.providers WHERE id = p_provider_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider not found.');
  END IF;

  -- 1. Unlink provider from orders by setting provider_id to NULL
  UPDATE public.orders
  SET provider_id = NULL
  WHERE provider_id = p_provider_id;

  -- 2. Clean up associated provider_packages
  DELETE FROM public.provider_packages
  WHERE provider_id = p_provider_id;

  -- 3. Clean up associated provider errors if table exists
  BEGIN
    DELETE FROM public.provider_errors WHERE provider_id = p_provider_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 4. Delete the provider row
  DELETE FROM public.providers
  WHERE id = p_provider_id;

  RETURN jsonb_build_object('success', true, 'message', 'Provider ' || v_name || ' deleted successfully.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ----- repay_agent_credit
CREATE OR REPLACE FUNCTION public.repay_agent_credit(p_agent_id uuid, p_amount numeric, p_note text DEFAULT 'Manual repayment'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_used numeric;
  v_balance numeric;
BEGIN

  -- [security 2026-10-24] browser callers must be admins (service_role / cron / triggers unaffected)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'repay_agent_credit: admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- 1. Get exclusive lock on native wallet
  SELECT balance INTO v_balance FROM public.wallets WHERE agent_id = p_agent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  -- 2. Repay the credit by crediting the native wallet balance
  UPDATE public.wallets
    SET balance = balance + p_amount, updated_at = now()
  WHERE agent_id = p_agent_id;

  -- 3. Sync legacy profiles.credit_used dynamically
  SELECT CASE WHEN balance < 0 THEN -balance ELSE 0 END INTO v_used 
  FROM public.wallets WHERE agent_id = p_agent_id;

  UPDATE public.profiles
    SET credit_used = v_used, updated_at = now()
  WHERE user_id = p_agent_id;

  -- 4. Audit trail
  INSERT INTO public.credit_transactions (agent_id, type, amount, balance_after, note)
  VALUES (p_agent_id, 'repay', p_amount, v_used, p_note);

  RETURN true;
END;
$function$;

-- ----- purge_old_system_logs
CREATE OR REPLACE FUNCTION public.purge_old_system_logs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN

  -- [security 2026-10-24] browser callers must be admins (service_role / cron / triggers unaffected)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'purge_old_system_logs: admin privileges required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.system_logs WHERE ts < now() - interval '30 days';
END;
$function$;

-- ----- get_admin_sales_stats_v2
CREATE OR REPLACE FUNCTION public.get_admin_sales_stats_v2(p_start_date timestamp with time zone)
 RETURNS TABLE(bucket_date text, customer_sales numeric, agent_sales numeric, sub_agent_sales numeric, deposit_volume numeric, order_count bigint, data_volume_gb numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN

  -- [security 2026-10-24] browser callers must be admins (service_role / cron / triggers unaffected)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'get_admin_sales_stats_v2: admin privileges required' USING ERRCODE = '42501';
  END IF;

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
$function$;

-- ----- dispatch_missed_you_push_broadcast
CREATE OR REPLACE FUNCTION public.dispatch_missed_you_push_broadcast(p_title text DEFAULT 'We Missed You! 👋'::text, p_body text DEFAULT 'We missed you! Good news: all your data, airtime, and order payments can now go through smoothly. Place your order now! 🚀'::text, p_link text DEFAULT '/dashboard/buy-data'::text, p_inactive_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_ids UUID[];
  v_count INT := 0;
  v_push_count INT := 0;
  v_service_key TEXT;
  r RECORD;
BEGIN

  -- [security 2026-10-24] browser callers must be admins (service_role / cron / triggers unaffected)
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'dispatch_missed_you_push_broadcast: admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- 1. Fetch eligible inactive user IDs
  SELECT ARRAY_AGG(user_id) INTO v_user_ids
  FROM public.get_inactive_winback_users(p_inactive_hours, 500);

  IF v_user_ids IS NULL OR ARRAY_LENGTH(v_user_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'targeted_users', 0,
      'push_tokens_notified', 0,
      'message', 'No inactive users eligible for winback notification at this time.'
    );
  END IF;

  v_count := ARRAY_LENGTH(v_user_ids, 1);

  -- 2. Insert in-app notifications (trg_user_notification_push will automatically trigger web push via send-push-notification)
  INSERT INTO public.user_notifications (user_id, title, message, type, link, data)
  SELECT 
    uid,
    p_title,
    p_body,
    'winback',
    p_link,
    '{"winback": true, "automated": true, "campaign": "we_missed_you"}'::jsonb
  FROM UNNEST(v_user_ids) AS uid;

  -- 3. Update missed_you_push_sent_at on profiles to prevent re-blasting within 12 hours
  UPDATE public.profiles
  SET missed_you_push_sent_at = NOW()
  WHERE user_id = ANY(v_user_ids);

  -- 4. Count total push subscriptions targeted
  SELECT COUNT(DISTINCT id) INTO v_push_count
  FROM public.push_subscriptions
  WHERE user_id = ANY(v_user_ids);

  -- 5. Also dispatch directly to push_subscriptions for offline browser/PWA tokens via pg_net if service key available
  BEGIN
    SELECT decrypted_secret INTO v_service_key 
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    BEGIN
      SELECT current_setting('app.settings.service_role_key', true) INTO v_service_key;
    EXCEPTION WHEN OTHERS THEN
      v_service_key := NULL;
    END;
  END IF;

  IF v_service_key IS NOT NULL AND v_service_key != '' THEN
    FOR r IN 
      SELECT DISTINCT user_id 
      FROM public.push_subscriptions
      WHERE user_id = ANY(v_user_ids)
    LOOP
      PERFORM net.http_post(
        url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object(
          'user_id', r.user_id,
          'title', p_title,
          'body', p_body,
          'url', p_link
        )
      );
    END LOOP;
  END IF;

  -- 6. Log entry into push_notification_logs
  INSERT INTO public.push_notification_logs (
    user_id, title, body, url, device_count, success_count, failure_count, status, error_details
  ) VALUES (
    NULL,
    p_title,
    p_body,
    p_link,
    v_push_count,
    v_count,
    0,
    'delivered',
    'Automated twice-daily winback push blast dispatched to ' || v_count || ' inactive users.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'targeted_users', v_count,
    'push_tokens_notified', v_push_count,
    'message', 'Successfully dispatched "We Missed You" notification blast.'
  );
END;
$function$;
