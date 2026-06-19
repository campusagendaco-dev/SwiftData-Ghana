-- RPC to reset claims for a specific promo code
CREATE OR REPLACE FUNCTION reset_promo_claims(p_promo_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify the caller is an admin
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Delete all claim history for this promo code
  DELETE FROM promo_claims WHERE promo_code_id = p_promo_id;

  -- Reset the usage counter back to 0
  UPDATE promo_codes SET current_uses = 0 WHERE id = p_promo_id;
END;
$$;
