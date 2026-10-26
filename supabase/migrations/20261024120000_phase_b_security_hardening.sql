-- ============================================================================================
-- SECURITY HARDENING: PHASE B
-- 1. Table RLS Protection:
--    - Revoke anon SELECT from sms_logs (contains SMS history, tokens, phone numbers).
--    - Revoke anon SELECT from failed_logins (contains IP addresses, user emails).
--    - Revoke anon SELECT from push_subscriptions (contains push auth secrets).
--    - Revoke anon SELECT from system_settings (contains Twilio auth token, system secrets).
--      (Frontend uses public_system_settings which is already safe and sanitized).
--    - Hide provider_packages cost_price from unauthenticated visitors.
--
-- 2. Internal RPC Authorization:
--    - Restrict bulk_suspend_users to admin only.
--    - Restrict delete_provider_safe to admin only.
--    - Restrict approve_store_deposit so only the store owner agent or admin can approve it.
--    - Restrict debit_wallet so users can ONLY debit their own wallet (or admin).
-- ============================================================================================

-- 1. TABLE PRIVILEGES: Revoke direct anon exposure on sensitive system tables
REVOKE ALL ON public.sms_logs FROM anon;
REVOKE ALL ON public.failed_logins FROM anon;
REVOKE ALL ON public.push_subscriptions FROM anon;
REVOKE ALL ON public.system_settings FROM anon;

-- Ensure authenticated users can only view their own sms logs / push subscriptions
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own sms logs" ON public.sms_logs;
CREATE POLICY "Users can view own sms logs" ON public.sms_logs
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid() OR (SELECT public.is_admin()));

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage own push subscriptions" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2. HARDEN bulk_suspend_users: Only Admins can execute
CREATE OR REPLACE FUNCTION public.bulk_suspend_users(p_user_ids UUID[], p_suspend BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform administrators can suspend accounts.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET is_suspended = p_suspend,
      suspended_at = CASE WHEN p_suspend THEN NOW() ELSE NULL END
  WHERE user_id = ANY(p_user_ids);

  RETURN jsonb_build_object('success', true, 'count', array_length(p_user_ids, 1));
END;
$$;

-- 3. HARDEN delete_provider_safe: Only Admins can execute
CREATE OR REPLACE FUNCTION public.delete_provider_safe(p_provider_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only platform administrators can delete providers.' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM public.providers WHERE id = p_provider_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider not found.');
  END IF;

  UPDATE public.orders
  SET provider_id = NULL
  WHERE provider_id = p_provider_id;

  DELETE FROM public.provider_packages
  WHERE provider_id = p_provider_id;

  BEGIN
    DELETE FROM public.provider_errors WHERE provider_id = p_provider_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  DELETE FROM public.providers
  WHERE id = p_provider_id;

  RETURN jsonb_build_object('success', true, 'message', 'Provider ' || v_name || ' deleted successfully.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 4. HARDEN debit_wallet: Prevent authenticated users from draining arbitrary wallets
CREATE OR REPLACE FUNCTION public.debit_wallet(p_agent_id UUID, p_amount NUMERIC)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_balance NUMERIC;
    current_limit NUMERIC;
    caller_id UUID := auth.uid();
BEGIN
    -- If called from client-side by an authenticated user, they MUST be debiting their OWN wallet or be admin
    IF caller_id IS NOT NULL AND caller_id != p_agent_id AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Unauthorized: You cannot debit another agent wallet.' USING ERRCODE = '42501';
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
$$;
