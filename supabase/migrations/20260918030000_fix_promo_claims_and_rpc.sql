-- Migration: 20260918030000_fix_promo_claims_and_rpc.sql
-- Fix promo claims phone number normalization & atomic claim execution

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
  v_raw_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_phone TEXT;
BEGIN
  -- Normalize Ghana phone numbers (233... -> 0..., 9 digits -> 0...)
  IF length(v_raw_phone) = 12 AND v_raw_phone LIKE '233%' THEN
    v_phone := '0' || substring(v_raw_phone from 4);
  ELSIF length(v_raw_phone) = 9 THEN
    v_phone := '0' || v_raw_phone;
  ELSE
    v_phone := v_raw_phone;
  END IF;

  -- Lock the promo row
  SELECT * INTO v_promo
  FROM promo_codes
  WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code))
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

  -- Check if this phone already claimed (checking 0..., 233..., and 9-digit formats)
  IF v_phone IS NOT NULL AND v_phone <> '' AND EXISTS (
    SELECT 1 FROM promo_claims
    WHERE promo_code_id = v_promo.id AND (
      claimed_by_phone = v_phone 
      OR (length(v_phone) = 10 AND claimed_by_phone = '233' || substring(v_phone from 2))
      OR (length(v_phone) = 10 AND claimed_by_phone = substring(v_phone from 2))
    )
  ) THEN
    RETURN;
  END IF;

  -- Atomically increment current_uses
  UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo.id;

  -- Record claim
  INSERT INTO promo_claims(promo_code_id, claimed_by_phone, order_id)
  VALUES (v_promo.id, v_phone, p_order_id)
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT v_promo.id, v_promo.discount_percentage, (v_promo.discount_percentage >= 100);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_promo_code(TEXT, TEXT, UUID) TO authenticated, anon, service_role;
