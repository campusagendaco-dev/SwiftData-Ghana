-- promo_claims: one claim per phone per code, enforced by unique constraint
CREATE TABLE IF NOT EXISTS promo_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  claimed_by_phone TEXT NOT NULL,
  order_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(promo_code_id, claimed_by_phone)
);

ALTER TABLE promo_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_promo_claims" ON promo_claims
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "admins_read_promo_claims" ON promo_claims
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Track which promo code was used on an order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0;

-- API role & security columns on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_allowed_actions TEXT[] DEFAULT ARRAY['balance', 'plans'];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_ip_whitelist TEXT[];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_webhook_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_last_used_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_requests_today INT DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_requests_total INT DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_requests_reset_at DATE DEFAULT CURRENT_DATE;

-- RPC: atomically claim a promo code (increment uses, check limit)
-- Returns the promo row if claim succeeded, NULL if exhausted or already claimed.
CREATE OR REPLACE FUNCTION claim_promo_code(
  p_code TEXT,
  p_phone TEXT,
  p_order_id UUID DEFAULT NULL
)
RETURNS TABLE(
  promo_id UUID,
  discount_percentage DECIMAL,
  is_free BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promo promo_codes%ROWTYPE;
  v_phone TEXT := regexp_replace(p_phone, '[^0-9]', '', 'g');
BEGIN
  -- Lock the promo row
  SELECT * INTO v_promo
  FROM promo_codes
  WHERE code = UPPER(TRIM(p_code))
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at < NOW() THEN
    RETURN;
  END IF;

  IF v_promo.current_uses >= v_promo.max_uses THEN
    RETURN;
  END IF;

  -- Check if this phone already claimed
  IF EXISTS (
    SELECT 1 FROM promo_claims
    WHERE promo_code_id = v_promo.id AND claimed_by_phone = v_phone
  ) THEN
    RETURN;
  END IF;

  -- Atomically increment
  UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo.id;

  -- Record claim
  INSERT INTO promo_claims(promo_code_id, claimed_by_phone, order_id)
  VALUES (v_promo.id, v_phone, p_order_id)
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT v_promo.id, v_promo.discount_percentage, (v_promo.discount_percentage >= 100);
END;
$$;

-- RPC: increment api request counters and update last_used_at
CREATE OR REPLACE FUNCTION increment_api_usage(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET
    api_last_used_at = NOW(),
    api_requests_total = COALESCE(api_requests_total, 0) + 1,
    api_requests_today = CASE
      WHEN COALESCE(api_requests_reset_at, CURRENT_DATE) < CURRENT_DATE
      THEN 1
      ELSE COALESCE(api_requests_today, 0) + 1
    END,
    api_requests_reset_at = CURRENT_DATE
  WHERE user_id = p_user_id;
END;
$$;
