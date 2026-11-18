-- ============================================================================================
-- Security & Notification Hardening (2026-11-19)
--
-- 1. Harden `public.protect_profile_privileged_fields()` (preserving all 20261118080000 guards,
--    restoring `markups`, `api_secret_key_hash`, and `app.api_key_rotation_allowed` GUC from
--    20261115100000, and protecting gamification/accounting/referral/admin columns).
--    Update `claim_daily_check_in` and `spin_the_wheel` to use `app.gamification_update_allowed`
--    GUC with explicit `SET search_path = public` and ownership guards.
-- 2. Fix `public.push_subscriptions` schema, RLS, and `register_push_subscription` /
--    `unregister_push_subscription` RPCs (resolve overload collision, add `updated_at`, stop
--    trusting client-supplied `p_user_id`, restrict `anon` deletes to `user_id IS NULL`, and
--    remove `OR user_id IS NULL` from `authenticated` RLS).
-- 3. Harden `settle_gateway_collection` (require `m.status = 'active'` for instant settlement)
--    and `check_gateway_volume_limits` (lock `gateway_merchants` row `FOR UPDATE`).
-- 4. Update `get_inactive_winback_sms_users()` to respect `sms_opt_out = false`.
-- 5. Idempotently add `public.withdrawals` to `supabase_realtime` publication.
-- 6. Safely set `search_path = public` on remaining client-callable `SECURITY DEFINER` RPCs.
-- ============================================================================================

-- --------------------------------------------------------------------------------------------
-- 1. Harden `public.protect_profile_privileged_fields()` + gamification RPCs
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow platform admins, service_role, and internal/owner execution contexts
  -- (where auth.uid() is NULL and caller is not anon/authenticated).
  IF public.has_role(auth.uid(), 'admin')
     OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
     OR COALESCE(auth.role(), '') = 'service_role'
     OR (auth.uid() IS NULL AND COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated'))
  THEN
    RETURN NEW;
  END IF;

  -- 0. Protect Suspension & Swift Vendor Terminal Status
  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    NEW.is_suspended := OLD.is_suspended;
  END IF;

  IF NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
    NEW.suspended_until := OLD.suspended_until;
  END IF;

  IF NEW.terminal_locked IS DISTINCT FROM OLD.terminal_locked THEN
    NEW.terminal_locked := OLD.terminal_locked;
  END IF;

  IF NEW.vendor_status IS DISTINCT FROM OLD.vendor_status THEN
    NEW.vendor_status := OLD.vendor_status;
  END IF;

  IF NEW.vendor_activated_at IS DISTINCT FROM OLD.vendor_activated_at THEN
    NEW.vendor_activated_at := OLD.vendor_activated_at;
  END IF;

  -- 1. Protect Agent/Sub-Agent Status, Approval & Admin Metadata
  IF NEW.is_agent IS DISTINCT FROM OLD.is_agent THEN
    NEW.is_agent := OLD.is_agent;
  END IF;

  IF NEW.agent_approved IS DISTINCT FROM OLD.agent_approved THEN
    NEW.agent_approved := OLD.agent_approved;
  END IF;

  IF NEW.sub_agent_approved IS DISTINCT FROM OLD.sub_agent_approved THEN
    NEW.sub_agent_approved := OLD.sub_agent_approved;
  END IF;

  -- Allow setting is_sub_agent to TRUE during onboarding, but block un-setting it later.
  IF NEW.is_sub_agent IS DISTINCT FROM OLD.is_sub_agent THEN
    IF OLD.is_sub_agent = true OR OLD.sub_agent_approved = true THEN
      NEW.is_sub_agent := OLD.is_sub_agent;
    END IF;
  END IF;

  IF NEW.markups IS DISTINCT FROM OLD.markups THEN
    NEW.markups := OLD.markups;
  END IF;

  IF NEW.admin_notes IS DISTINCT FROM OLD.admin_notes THEN
    NEW.admin_notes := OLD.admin_notes;
  END IF;

  -- 2. Protect API-Related Fields (Prevent self-enablement, key tampering, and quota resets)
  IF NEW.api_access_enabled IS DISTINCT FROM OLD.api_access_enabled THEN
    NEW.api_access_enabled := OLD.api_access_enabled;
  END IF;

  IF NEW.api_key IS DISTINCT FROM OLD.api_key THEN
    NEW.api_key := OLD.api_key;
  END IF;

  IF current_setting('app.api_key_rotation_allowed', true) = 'true' THEN
    -- Allowed via api.rotate_api_key() for users with api_access_enabled = true
    NULL;
  ELSE
    IF NEW.api_key_hash IS DISTINCT FROM OLD.api_key_hash THEN
      NEW.api_key_hash := OLD.api_key_hash;
    END IF;

    IF NEW.api_key_prefix IS DISTINCT FROM OLD.api_key_prefix THEN
      NEW.api_key_prefix := OLD.api_key_prefix;
    END IF;

    IF NEW.api_secret_key_hash IS DISTINCT FROM OLD.api_secret_key_hash THEN
      NEW.api_secret_key_hash := OLD.api_secret_key_hash;
    END IF;
  END IF;

  IF NEW.api_rate_limit IS DISTINCT FROM OLD.api_rate_limit THEN
    NEW.api_rate_limit := OLD.api_rate_limit;
  END IF;

  IF NEW.api_allowed_actions IS DISTINCT FROM OLD.api_allowed_actions THEN
    NEW.api_allowed_actions := OLD.api_allowed_actions;
  END IF;

  IF NEW.api_requests_today IS DISTINCT FROM OLD.api_requests_today THEN
    NEW.api_requests_today := OLD.api_requests_today;
  END IF;

  IF NEW.api_requests_total IS DISTINCT FROM OLD.api_requests_total THEN
    NEW.api_requests_total := OLD.api_requests_total;
  END IF;

  IF NEW.api_requests_reset_at IS DISTINCT FROM OLD.api_requests_reset_at THEN
    NEW.api_requests_reset_at := OLD.api_requests_reset_at;
  END IF;

  -- 2.1 API pricing is admin-only
  IF NEW.api_custom_prices IS DISTINCT FROM OLD.api_custom_prices THEN
    NEW.api_custom_prices := OLD.api_custom_prices;
  END IF;

  -- 2.2 Protect API Request Flow (Allow self-submit to 'pending' from NULL/rejected, block self-approval/rejection)
  IF NEW.api_request_status IS DISTINCT FROM OLD.api_request_status THEN
    IF NEW.api_request_status = 'pending' AND (OLD.api_request_status IS NULL OR OLD.api_request_status = 'rejected') THEN
      NEW.api_requested_at := NOW();
    ELSE
      NEW.api_request_status := OLD.api_request_status;
    END IF;
  END IF;

  IF NEW.api_requested_at IS DISTINCT FROM OLD.api_requested_at AND NEW.api_request_status IS NOT DISTINCT FROM OLD.api_request_status THEN
    NEW.api_requested_at := OLD.api_requested_at;
  END IF;

  -- 3. Protect Referral, Bonus & Gamification Cooldown Metadata
  IF NEW.parent_agent_id IS DISTINCT FROM OLD.parent_agent_id THEN
    NEW.parent_agent_id := OLD.parent_agent_id;
  END IF;

  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    NEW.referred_by := OLD.referred_by;
  END IF;

  IF NEW.first_purchase_bonus_claimed IS DISTINCT FROM OLD.first_purchase_bonus_claimed THEN
    NEW.first_purchase_bonus_claimed := OLD.first_purchase_bonus_claimed;
  END IF;

  IF current_setting('app.gamification_update_allowed', true) = 'true' THEN
    -- Allowed via claim_daily_check_in() / spin_the_wheel()
    NULL;
  ELSE
    IF NEW.last_check_in IS DISTINCT FROM OLD.last_check_in THEN
      NEW.last_check_in := OLD.last_check_in;
    END IF;

    IF NEW.check_in_streak IS DISTINCT FROM OLD.check_in_streak THEN
      NEW.check_in_streak := OLD.check_in_streak;
    END IF;

    IF NEW.last_spin_at IS DISTINCT FROM OLD.last_spin_at THEN
      NEW.last_spin_at := OLD.last_spin_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Update gamification RPCs to set the local GUC, enforce caller ownership, and lock search_path
CREATE OR REPLACE FUNCTION public.claim_daily_check_in(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_check_in TIMESTAMP WITH TIME ZONE;
  v_streak INTEGER;
  v_points_to_award INTEGER;
  v_now TIMESTAMP WITH TIME ZONE := now();
BEGIN
  -- [wallet-guard 2026-11-04]
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'claim_daily_check_in: not authorized for this account' USING ERRCODE = '42501';
  END IF;

  SELECT last_check_in, check_in_streak INTO v_last_check_in, v_streak
  FROM public.profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_last_check_in IS NOT NULL AND v_last_check_in::date = v_now::date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already checked in today. Come back tomorrow!');
  END IF;

  IF v_last_check_in IS NOT NULL AND v_last_check_in::date = (v_now - INTERVAL '1 day')::date THEN
    v_streak := COALESCE(v_streak, 0) + 1;
  ELSE
    v_streak := 1;
  END IF;

  v_points_to_award := LEAST(5 + (v_streak - 1) * 5, 50);

  PERFORM set_config('app.gamification_update_allowed', 'true', true);
  UPDATE public.profiles
  SET
    last_check_in = v_now,
    check_in_streak = v_streak
  WHERE user_id = p_user_id;
  PERFORM set_config('app.gamification_update_allowed', '', true);

  UPDATE public.wallets
  SET loyalty_balance = loyalty_balance + v_points_to_award
  WHERE agent_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'streak', v_streak,
    'points_awarded', v_points_to_award,
    'next_check_in', (v_now::date + INTERVAL '1 day')::timestamp with time zone
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_daily_check_in(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_check_in(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.spin_the_wheel(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_spin TIMESTAMP WITH TIME ZONE;
  v_points_to_award INTEGER;
  v_now TIMESTAMP WITH TIME ZONE := now();
  v_random FLOAT;
BEGIN
  -- [wallet-guard 2026-11-04]
  IF pg_trigger_depth() = 0 AND COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'spin_the_wheel: not authorized for this account' USING ERRCODE = '42501';
  END IF;

  SELECT last_spin_at INTO v_last_spin
  FROM public.profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_last_spin IS NOT NULL AND v_last_spin::date = v_now::date THEN
    RETURN jsonb_build_object('success', false, 'error', 'You have already spun the wheel today! Come back tomorrow.');
  END IF;

  v_random := random();

  IF v_random < 0.05 THEN
    v_points_to_award := 100;
  ELSIF v_random < 0.15 THEN
    v_points_to_award := 50;
  ELSIF v_random < 0.40 THEN
    v_points_to_award := 20;
  ELSIF v_random < 0.70 THEN
    v_points_to_award := 10;
  ELSE
    v_points_to_award := 5;
  END IF;

  PERFORM set_config('app.gamification_update_allowed', 'true', true);
  UPDATE public.profiles
  SET last_spin_at = v_now
  WHERE user_id = p_user_id;
  PERFORM set_config('app.gamification_update_allowed', '', true);

  UPDATE public.wallets
  SET loyalty_balance = loyalty_balance + v_points_to_award
  WHERE agent_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'points_awarded', v_points_to_award,
    'random_seed', v_random
  );
END;
$$;

REVOKE ALL ON FUNCTION public.spin_the_wheel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spin_the_wheel(UUID) TO authenticated, service_role;

-- --------------------------------------------------------------------------------------------
-- 2. Fix `public.push_subscriptions` schema, RLS, and canonical registration RPCs
-- --------------------------------------------------------------------------------------------
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON public.push_subscriptions (endpoint);

-- Tighten authenticated RLS policy (remove `OR user_id IS NULL`)
DROP POLICY IF EXISTS "Users manage own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Drop conflicting overloads before recreating canonical signatures
DROP FUNCTION IF EXISTS public.register_push_subscription(TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.register_push_subscription(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.unregister_push_subscription(TEXT);

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_endpoint TEXT := trim(COALESCE(p_endpoint, ''));
  v_p256dh TEXT := trim(COALESCE(p_p256dh, ''));
  v_auth TEXT := trim(COALESCE(p_auth, ''));
BEGIN
  IF v_endpoint = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Endpoint is required');
  END IF;

  IF v_uid IS NULL THEN
    -- Guest (anon) registration: never hijack an endpoint already owned by an authenticated user
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
    VALUES (NULL, v_endpoint, v_p256dh, v_auth, now())
    ON CONFLICT (endpoint) DO UPDATE
    SET
      p256dh = CASE WHEN length(v_p256dh) > 0 THEN v_p256dh ELSE public.push_subscriptions.p256dh END,
      auth = CASE WHEN length(v_auth) > 0 THEN v_auth ELSE public.push_subscriptions.auth END,
      updated_at = now()
    WHERE public.push_subscriptions.user_id IS NULL;
  ELSE
    -- Authenticated registration: bind endpoint strictly to auth.uid()
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
    VALUES (v_uid, v_endpoint, v_p256dh, v_auth, now())
    ON CONFLICT (endpoint) DO UPDATE
    SET
      user_id = v_uid,
      p256dh = CASE WHEN length(v_p256dh) > 0 THEN v_p256dh ELSE public.push_subscriptions.p256dh END,
      auth = CASE WHEN length(v_auth) > 0 THEN v_auth ELSE public.push_subscriptions.auth END,
      updated_at = now();
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unregister_push_subscription(
  p_endpoint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_endpoint TEXT := trim(COALESCE(p_endpoint, ''));
BEGIN
  IF v_endpoint = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Endpoint is required');
  END IF;

  IF v_uid IS NULL THEN
    -- Anonymous callers may only remove guest (user_id IS NULL) subscriptions
    DELETE FROM public.push_subscriptions
    WHERE endpoint = v_endpoint
      AND user_id IS NULL;
  ELSE
    DELETE FROM public.push_subscriptions
    WHERE endpoint = v_endpoint
      AND (user_id = v_uid OR public.is_admin());
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.unregister_push_subscription(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_subscription(TEXT) TO anon, authenticated, service_role;

-- --------------------------------------------------------------------------------------------
-- 3. Harden Payment Gateway RPCs (`check_gateway_volume_limits`, `settle_gateway_collection`)
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_gateway_volume_limits(
  p_merchant_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  v_daily numeric(14,2);
  v_monthly numeric(14,2);
BEGIN
  -- Serialize concurrent volume-limit checks per merchant
  SELECT id, max_tx_amount, daily_limit, monthly_limit, status
    INTO m
    FROM public.gateway_merchants
   WHERE id = p_merchant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Merchant not found');
  END IF;

  IF m.status <> 'active' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Merchant gateway is not active');
  END IF;

  IF p_amount > m.max_tx_amount THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Amount exceeds per-transaction limit of GHS ' || m.max_tx_amount::text
    );
  END IF;

  SELECT COALESCE(SUM(base_amount), 0)
    INTO v_daily
    FROM public.gateway_collections
   WHERE merchant_id = p_merchant_id
     AND status IN ('pending', 'paid', 'settled')
     AND created_at >= date_trunc('day', now());

  IF (v_daily + p_amount) > m.daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Daily collection volume limit exceeded',
      'daily_used', v_daily,
      'daily_limit', m.daily_limit
    );
  END IF;

  SELECT COALESCE(SUM(base_amount), 0)
    INTO v_monthly
    FROM public.gateway_collections
   WHERE merchant_id = p_merchant_id
     AND status IN ('pending', 'paid', 'settled')
     AND created_at >= date_trunc('month', now());

  IF (v_monthly + p_amount) > m.monthly_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Monthly collection volume limit exceeded',
      'monthly_used', v_monthly,
      'monthly_limit', m.monthly_limit
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'daily_used', v_daily,
    'daily_limit', m.daily_limit,
    'monthly_used', v_monthly,
    'monthly_limit', m.monthly_limit
  );
END;
$$;
REVOKE ALL ON FUNCTION public.check_gateway_volume_limits(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_gateway_volume_limits(uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_gateway_collection(
  p_reference text,
  p_paid_amount numeric,
  p_paystack_fee numeric DEFAULT NULL,
  p_channel text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  m record;
  v_res jsonb;
  v_settle_after timestamptz;
BEGIN
  SELECT * INTO c
    FROM public.gateway_collections
   WHERE reference = p_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Collection not found');
  END IF;

  IF c.status IN ('paid', 'settled') THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'status', c.status,
      'collection_id', c.id
    );
  END IF;

  IF c.status IN ('disputed', 'reversed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Collection is ' || c.status);
  END IF;

  IF p_paid_amount IS NULL OR p_paid_amount < (c.total_charged - 0.01) THEN
    UPDATE public.gateway_collections
       SET status = 'failed',
           failure_reason = 'Underpayment detected: paid ' || COALESCE(p_paid_amount::text, '0') || ' < expected ' || c.total_charged::text,
           updated_at = now()
     WHERE id = c.id;
    RETURN jsonb_build_object('success', false, 'error', 'Underpayment detected');
  END IF;

  SELECT * INTO m
    FROM public.gateway_merchants
   WHERE id = c.merchant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Merchant not found');
  END IF;

  -- Instant settlement only if merchant is active, hold_hours = 0, and not frozen
  IF m.status = 'active'
     AND COALESCE(m.settlement_hold_hours, 24) = 0
     AND NOT COALESCE(m.settlement_frozen, false) THEN
    v_res := public.wallet_post(
      c.user_id,
      m.settlement_wallet,
      c.net_settlement,
      'gateway_collection',
      'gateway_collection',
      c.id::text,
      'gw_col:' || c.id::text,
      'Gateway collection ' || c.client_reference
    );

    IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_res->>'error', 'Wallet settlement failed'));
    END IF;

    UPDATE public.gateway_collections
       SET status = 'settled',
           paystack_actual_fee = COALESCE(p_paystack_fee, paystack_actual_fee),
           channel = COALESCE(p_channel, channel),
           failure_reason = NULL,
           paid_at = COALESCE(paid_at, now()),
           settle_after = now(),
           settled_at = now(),
           updated_at = now()
     WHERE id = c.id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'settled',
      'collection_id', c.id,
      'merchant_id', c.merchant_id,
      'wallet', m.settlement_wallet,
      'net_settlement', c.net_settlement
    );
  ELSE
    v_settle_after := now() + make_interval(hours => GREATEST(COALESCE(m.settlement_hold_hours, 24), 1));
    UPDATE public.gateway_collections
       SET status = 'paid',
           paystack_actual_fee = COALESCE(p_paystack_fee, paystack_actual_fee),
           channel = COALESCE(p_channel, channel),
           failure_reason = NULL,
           paid_at = COALESCE(paid_at, now()),
           settle_after = v_settle_after,
           updated_at = now()
     WHERE id = c.id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'paid',
      'collection_id', c.id,
      'merchant_id', c.merchant_id,
      'wallet', m.settlement_wallet,
      'net_settlement', c.net_settlement,
      'settle_after', v_settle_after,
      'frozen', COALESCE(m.settlement_frozen, false)
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_gateway_collection(text, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_gateway_collection(text, numeric, numeric, text) TO service_role;

-- --------------------------------------------------------------------------------------------
-- 4. Update `get_inactive_winback_sms_users()` to respect `sms_opt_out`
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_inactive_winback_sms_users(
  p_inactive_hours integer DEFAULT 24,
  p_limit integer DEFAULT 25,
  p_cooldown_hours integer DEFAULT 48
)
RETURNS TABLE(user_id uuid, full_name text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.full_name,
    p.phone
  FROM public.profiles p
  WHERE (p.is_suspended IS FALSE OR p.is_suspended IS NULL)
    AND COALESCE(p.api_access_enabled, false) = false
    AND COALESCE(p.sms_opt_out, false) = false
    AND p.phone IS NOT NULL
    AND LENGTH(TRIM(p.phone)) >= 9
    AND (p.missed_you_sms_sent_at IS NULL OR p.missed_you_sms_sent_at <= (NOW() - (p_cooldown_hours || ' hours')::INTERVAL))
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.agent_id = p.user_id
        AND o.created_at >= (NOW() - (p_inactive_hours || ' hours')::INTERVAL)
    )
  ORDER BY p.missed_you_sms_sent_at ASC NULLS FIRST, p.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_inactive_winback_sms_users(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_inactive_winback_sms_users(integer, integer, integer) TO service_role;

-- --------------------------------------------------------------------------------------------
-- 5. Idempotently add `public.withdrawals` to `supabase_realtime` publication
-- --------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'withdrawals')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'withdrawals'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawals;
  END IF;
END $$;

-- --------------------------------------------------------------------------------------------
-- 6. Safely set `search_path = public` on remaining client-callable SECURITY DEFINER RPCs
-- --------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_sig text;
  v_sigs text[] := ARRAY[
    'public.claim_daily_check_in(uuid)',
    'public.spin_the_wheel(uuid)',
    'public.convert_loyalty_points(uuid, numeric)',
    'public.redeem_swift_points(integer)',
    'public.approve_store_deposit(uuid)',
    'public.purchase_sms_credits(integer)',
    'public.reset_promo_claims(uuid)'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_sig);
    END IF;
  END LOOP;
END $$;
