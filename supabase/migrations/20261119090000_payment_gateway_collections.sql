-- High-Security Payment Gateway Collection System
-- Enables approved API users and external site merchants to collect Paystack
-- payments securely with isolated credentials, anti-replay nonces, domain/IP
-- allowlists, daily/monthly volume caps, settlement holds, dispute freezes,
-- and signed webhook delivery logs.

-- 1. Gateway Merchants Table
CREATE TABLE IF NOT EXISTS public.gateway_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  website_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  secret_key_prefix text,
  secret_key_hash text UNIQUE,
  webhook_secret text,
  require_hmac boolean NOT NULL DEFAULT true,
  allowed_domains text[] NOT NULL DEFAULT '{}',
  allowed_ips text[] NOT NULL DEFAULT '{}',
  webhook_url text,
  allowed_channels text[] NOT NULL DEFAULT ARRAY['mobile_money'],
  settlement_wallet text NOT NULL DEFAULT 'api'
    CHECK (settlement_wallet IN ('api', 'main')),
  settlement_hold_hours integer NOT NULL DEFAULT 24
    CHECK (settlement_hold_hours >= 0 AND settlement_hold_hours <= 720),
  settlement_frozen boolean NOT NULL DEFAULT false,
  max_tx_amount numeric(14,2) NOT NULL DEFAULT 2000.00
    CHECK (max_tx_amount >= 1 AND max_tx_amount <= 100000),
  daily_limit numeric(14,2) NOT NULL DEFAULT 10000.00
    CHECK (daily_limit >= 1),
  monthly_limit numeric(14,2) NOT NULL DEFAULT 100000.00
    CHECK (monthly_limit >= 1),
  rate_limit_per_min integer NOT NULL DEFAULT 30
    CHECK (rate_limit_per_min >= 1 AND rate_limit_per_min <= 600),
  fee_percent numeric(5,2)
    CHECK (fee_percent IS NULL OR (fee_percent >= 0 AND fee_percent <= 20)),
  platform_fee_percent numeric(5,2) NOT NULL DEFAULT 0.00
    CHECK (platform_fee_percent >= 0 AND platform_fee_percent <= 20),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gateway_merchants_status ON public.gateway_merchants (status);
CREATE INDEX IF NOT EXISTS idx_gateway_merchants_secret_hash ON public.gateway_merchants (secret_key_hash);

-- 2. Gateway Collections Table
CREATE TABLE IF NOT EXISTS public.gateway_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.gateway_merchants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reference text NOT NULL UNIQUE,
  client_reference text NOT NULL,
  base_amount numeric(14,2) NOT NULL CHECK (base_amount > 0),
  customer_fee numeric(14,2) NOT NULL DEFAULT 0.00 CHECK (customer_fee >= 0),
  platform_fee numeric(14,2) NOT NULL DEFAULT 0.00 CHECK (platform_fee >= 0),
  total_charged numeric(14,2) NOT NULL CHECK (total_charged > 0),
  net_settlement numeric(14,2) NOT NULL CHECK (net_settlement > 0),
  paystack_actual_fee numeric(14,2),
  currency text NOT NULL DEFAULT 'GHS',
  channel text,
  customer_phone text,
  customer_email text,
  description text,
  redirect_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'settled', 'failed', 'expired', 'disputed', 'reversed')),
  failure_reason text,
  paid_at timestamptz,
  settle_after timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gateway_collections_merchant_client_ref UNIQUE (merchant_id, client_reference)
);

CREATE INDEX IF NOT EXISTS idx_gateway_collections_merchant_created
  ON public.gateway_collections (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_collections_user_created
  ON public.gateway_collections (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_collections_settlement_due
  ON public.gateway_collections (status, settle_after)
  WHERE status = 'paid' AND settle_after IS NOT NULL;

-- 3. Gateway Webhook Deliveries Table
CREATE TABLE IF NOT EXISTS public.gateway_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.gateway_collections(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.gateway_merchants(id) ON DELETE CASCADE,
  event text NOT NULL,
  target_url text NOT NULL,
  payload jsonb NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  last_http_status integer,
  last_error text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gateway_webhooks_merchant_created
  ON public.gateway_webhook_deliveries (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_webhooks_due_retries
  ON public.gateway_webhook_deliveries (status, next_retry_at)
  WHERE status = 'pending' AND next_retry_at IS NOT NULL;

-- 4. Gateway Request Nonces (Anti-Replay Protection)
CREATE TABLE IF NOT EXISTS public.gateway_request_nonces (
  merchant_id uuid NOT NULL REFERENCES public.gateway_merchants(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_gateway_nonces_created_at
  ON public.gateway_request_nonces (created_at);

-- 5. Protect Privileged Columns on gateway_merchants from Non-Admin Updates
CREATE OR REPLACE FUNCTION public.protect_gateway_merchant_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' OR public.is_admin() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Regular merchants can only update safe profile/security routing fields
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.secret_key_prefix IS DISTINCT FROM OLD.secret_key_prefix
     OR NEW.secret_key_hash IS DISTINCT FROM OLD.secret_key_hash
     OR NEW.webhook_secret IS DISTINCT FROM OLD.webhook_secret
     OR NEW.require_hmac IS DISTINCT FROM OLD.require_hmac
     OR NEW.allowed_channels IS DISTINCT FROM OLD.allowed_channels
     OR NEW.settlement_wallet IS DISTINCT FROM OLD.settlement_wallet
     OR NEW.settlement_hold_hours IS DISTINCT FROM OLD.settlement_hold_hours
     OR NEW.settlement_frozen IS DISTINCT FROM OLD.settlement_frozen
     OR NEW.max_tx_amount IS DISTINCT FROM OLD.max_tx_amount
     OR NEW.daily_limit IS DISTINCT FROM OLD.daily_limit
     OR NEW.monthly_limit IS DISTINCT FROM OLD.monthly_limit
     OR NEW.rate_limit_per_min IS DISTINCT FROM OLD.rate_limit_per_min
     OR NEW.fee_percent IS DISTINCT FROM OLD.fee_percent
     OR NEW.platform_fee_percent IS DISTINCT FROM OLD.platform_fee_percent
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'Only administrators can modify merchant approval status, settlement, or risk limits.'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_gateway_merchant_privileged_fields ON public.gateway_merchants;
CREATE TRIGGER trg_protect_gateway_merchant_privileged_fields
  BEFORE UPDATE ON public.gateway_merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_gateway_merchant_privileged_fields();

-- 6. Strict Column-Level Grants & Row Level Security
ALTER TABLE public.gateway_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_request_nonces ENABLE ROW LEVEL SECURITY;

-- Revoke all default privileges first
REVOKE ALL ON public.gateway_merchants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.gateway_collections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.gateway_webhook_deliveries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.gateway_request_nonces FROM PUBLIC, anon, authenticated;

-- Grant only non-secret columns of gateway_merchants to authenticated
GRANT SELECT (
  id, user_id, business_name, website_url, status, secret_key_prefix,
  require_hmac, allowed_domains, allowed_ips, webhook_url, allowed_channels,
  settlement_wallet, settlement_hold_hours, settlement_frozen,
  max_tx_amount, daily_limit, monthly_limit, rate_limit_per_min,
  fee_percent, platform_fee_percent, approved_at, approved_by,
  created_at, updated_at
) ON public.gateway_merchants TO authenticated;

GRANT INSERT (
  user_id, business_name, website_url, allowed_domains, allowed_ips, webhook_url
) ON public.gateway_merchants TO authenticated;

GRANT UPDATE (
  business_name, website_url, allowed_domains, allowed_ips, webhook_url,
  status, require_hmac, allowed_channels, settlement_wallet,
  settlement_hold_hours, settlement_frozen, max_tx_amount, daily_limit,
  monthly_limit, rate_limit_per_min, fee_percent, platform_fee_percent,
  approved_at, approved_by, updated_at
) ON public.gateway_merchants TO authenticated;

GRANT SELECT ON public.gateway_collections TO authenticated;
GRANT SELECT ON public.gateway_webhook_deliveries TO authenticated;

-- Service role full access
GRANT ALL ON public.gateway_merchants TO service_role;
GRANT ALL ON public.gateway_collections TO service_role;
GRANT ALL ON public.gateway_webhook_deliveries TO service_role;
GRANT ALL ON public.gateway_request_nonces TO service_role;

-- RLS Policies: gateway_merchants
DROP POLICY IF EXISTS "Merchants can view own gateway profile" ON public.gateway_merchants;
CREATE POLICY "Merchants can view own gateway profile"
  ON public.gateway_merchants FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Users can apply for gateway merchant" ON public.gateway_merchants;
CREATE POLICY "Users can apply for gateway merchant"
  ON public.gateway_merchants FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS "Merchants and admins can update gateway profile" ON public.gateway_merchants;
CREATE POLICY "Merchants and admins can update gateway profile"
  ON public.gateway_merchants FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- RLS Policies: gateway_collections
DROP POLICY IF EXISTS "Merchants and admins can view gateway collections" ON public.gateway_collections;
CREATE POLICY "Merchants and admins can view gateway collections"
  ON public.gateway_collections FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- RLS Policies: gateway_webhook_deliveries
DROP POLICY IF EXISTS "Merchants and admins can view gateway webhooks" ON public.gateway_webhook_deliveries;
CREATE POLICY "Merchants and admins can view gateway webhooks"
  ON public.gateway_webhook_deliveries FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.gateway_merchants gm
      WHERE gm.id = gateway_webhook_deliveries.merchant_id
        AND gm.user_id = auth.uid()
    )
  );

-- 7. Atomic Anti-Replay Nonce Verification RPC
CREATE OR REPLACE FUNCTION public.verify_and_consume_gateway_nonce(
  p_merchant_id uuid,
  p_nonce text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_merchant_id IS NULL OR coalesce(trim(p_nonce), '') = '' THEN
    RETURN false;
  END IF;

  -- Prune expired nonces older than 15 minutes
  DELETE FROM public.gateway_request_nonces
  WHERE created_at < now() - interval '15 minutes';

  INSERT INTO public.gateway_request_nonces (merchant_id, nonce)
  VALUES (p_merchant_id, trim(p_nonce))
  ON CONFLICT (merchant_id, nonce) DO NOTHING;

  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_and_consume_gateway_nonce(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_and_consume_gateway_nonce(uuid, text) TO service_role;

-- 8. Atomic Daily & Monthly Volume Limit Check RPC
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
  SELECT id, max_tx_amount, daily_limit, monthly_limit, status
    INTO m
    FROM public.gateway_merchants
   WHERE id = p_merchant_id;

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

-- 9. Atomic Collection Settlement RPC (FOR UPDATE lock + wallet_post or hold)
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

  -- Allow small 0.02 GHS rounding tolerance only downward? No: require paid >= total_charged - 0.01
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

  -- Instant settlement if hold_hours = 0 and not frozen; otherwise hold until settle_after
  IF COALESCE(m.settlement_hold_hours, 24) = 0 AND NOT COALESCE(m.settlement_frozen, false) THEN
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

-- 10. Release Matured Held Settlements Sweep RPC
CREATE OR REPLACE FUNCTION public.release_matured_gateway_settlements(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_res jsonb;
  v_settled_count integer := 0;
  v_settled_ids uuid[] := '{}';
BEGIN
  FOR rec IN
    SELECT c.id, c.user_id, c.net_settlement, c.client_reference, m.settlement_wallet
      FROM public.gateway_collections c
      JOIN public.gateway_merchants m ON m.id = c.merchant_id
     WHERE c.status = 'paid'
       AND c.settle_after IS NOT NULL
       AND c.settle_after <= now()
       AND m.status = 'active'
       AND NOT COALESCE(m.settlement_frozen, false)
     ORDER BY c.settle_after ASC
     LIMIT GREATEST(1, LEAST(p_limit, 500))
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    v_res := public.wallet_post(
      rec.user_id,
      rec.settlement_wallet,
      rec.net_settlement,
      'gateway_collection',
      'gateway_collection',
      rec.id::text,
      'gw_col:' || rec.id::text,
      'Gateway collection settlement ' || rec.client_reference
    );

    IF COALESCE((v_res->>'success')::boolean, false) THEN
      UPDATE public.gateway_collections
         SET status = 'settled',
             settled_at = now(),
             updated_at = now()
       WHERE id = rec.id;
      v_settled_count := v_settled_count + 1;
      v_settled_ids := array_append(v_settled_ids, rec.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'settled_count', v_settled_count,
    'collection_ids', v_settled_ids
  );
END;
$$;
REVOKE ALL ON FUNCTION public.release_matured_gateway_settlements(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_matured_gateway_settlements(integer) TO service_role;

-- 11. Freeze Disputed Collection & Merchant Settlements RPC
CREATE OR REPLACE FUNCTION public.freeze_disputed_gateway_collection(
  p_reference text,
  p_reason text DEFAULT 'Payment dispute opened'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c
    FROM public.gateway_collections
   WHERE reference = p_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Collection not found');
  END IF;

  UPDATE public.gateway_collections
     SET status = 'disputed',
         failure_reason = LEFT(COALESCE(p_reason, 'Payment dispute opened'), 500),
         updated_at = now()
   WHERE id = c.id;

  UPDATE public.gateway_merchants
     SET settlement_frozen = true,
         updated_at = now()
   WHERE id = c.merchant_id;

  RETURN jsonb_build_object(
    'success', true,
    'collection_id', c.id,
    'merchant_id', c.merchant_id,
    'user_id', c.user_id,
    'was_settled', (c.status = 'settled'),
    'net_settlement', c.net_settlement
  );
END;
$$;
REVOKE ALL ON FUNCTION public.freeze_disputed_gateway_collection(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_disputed_gateway_collection(text, text) TO service_role;
